/**
 * 中央ペインのタブ（DESIGN-v0.md §1-9-5 の合格条件 #1〜#5）を、**画面の経路で**通す。
 *
 * ⚠⚠ **この 1 ファイルの本命は「打った値が残っているか」である。**
 *   タブを `v-if` で作り直す実装でも、切り替えて戻れば**空の新しいフォームが出る**ので、
 *   `exists()` だけを見る述語は**緑のまま通ってしまう**（＝この変更の目的そのものを検査できない）。
 *   → 必ず「打った値が round-trip で残っている」ところまで見る。
 *
 * ⚠ 合格条件 #6（ロイスが実ブラウザで触って「編集しやすくなった」と言う）は
 *   jsdom では原理的に観測できない。ここには無い。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import App from '../App.vue'
import { headingMark } from '../document/heading'
import { clearDocument, clearInstances, saveDocument } from '../store/persistence'

let wrapper: VueWrapper | null = null

/**
 * ⚠ 起動時の読み出しは IndexedDB のイベント経由なので microtask 1 周では終わらない。
 *   エディタが立ち上がるまで待つ（本文タブの中身が無いと #4 が観測できない）。
 */
async function mountApp(): Promise<VueWrapper> {
  wrapper = mount(App, { attachTo: document.body })
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((wrapper.vm as unknown as { editor: Editor | null }).editor) break
  }
  await nextTick()
  return wrapper
}

/** タブの見出し（左から）。⚠ 未保存の印は含まない（印は `.tabs__dirty` で別に見る）。 */
function tabLabels(app: VueWrapper): string[] {
  return app.findAll('.tabs__name').map((b) => b.text())
}

/** いま選ばれているタブの見出し。 */
function activeTabLabel(app: VueWrapper): string {
  return app.find('.tabs__tab--active .tabs__name').text()
}

/** 見えているパネルの位置（0 = 本文・1 = フォーム）。⚠ `v-show` の `display: none` を見る。 */
function visiblePanelIndexes(app: VueWrapper): number[] {
  return app
    .findAll('.tabs__panel')
    .map((panel, index) => (panel.isVisible() ? index : -1))
    .filter((index) => index >= 0)
}

async function openDungeonForm(app: VueWrapper) {
  const item = app.findAll('.tpane__item').find((b) => b.text() === '迷宮マップ')
  if (!item) throw new Error('テンプレート一覧に「迷宮マップ」がありません')
  await item.trigger('click')
}

/** 打ちかけの値を 1 つ入れる（`overview.name`）。 */
async function typeDraft(app: VueWrapper, text: string) {
  await app.find('.field--object .field--string input').setValue(text)
}

function draftText(app: VueWrapper): string {
  return (app.find('.field--object .field--string input').element as HTMLInputElement).value
}

async function clickTab(app: VueWrapper, label: string) {
  const index = tabLabels(app).indexOf(label)
  if (index < 0)
    throw new Error(`「${label}」のタブがありません（今あるのは ${tabLabels(app).join('・')}）`)
  await app.findAll('.tabs__label')[index]!.trigger('click')
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await clearInstances()
  await clearDocument()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('#1 テンプレを選ぶと中央にフォームのタブが開く', () => {
  it('起動時は「本文」だけが有り、閉じる ✕ が付いていない', async () => {
    const app = await mountApp()
    expect(tabLabels(app)).toEqual(['本文'])
    expect(activeTabLabel(app)).toBe('本文')
    // ⚠ 「本文」は常にあるタブ（§1-9-2）
    expect(app.find('.tabs__close').exists()).toBe(false)
  })

  it('⭐ 選ぶと中央にタブが増えて開き、**右ペインにはフォームが出ない**', async () => {
    const app = await mountApp()
    await openDungeonForm(app)

    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])
    expect(activeTabLabel(app)).toBe('迷宮マップ')
    // ⚠⚠ ここが今回の変更の外形。フォームは中央（`app__center`）にしか無い。
    expect(app.find('.app__center .tform').exists()).toBe(true)
    expect(app.find('.app__right .tform').exists()).toBe(false)
    // 一覧側は選択が分かる状態で残っている
    expect(app.find('.app__right .tpane__item--selected').text()).toBe('迷宮マップ')
  })
})

describe('#2 ⭐⭐ 本文へ移って戻っても、打ちかけの下書きが残っている（本命）', () => {
  it('文字が残っている（`v-if` で作り直していない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'かきかけの迷宮')

    await clickTab(app, '本文')
    expect(activeTabLabel(app)).toBe('本文')
    // ⚠ 隠れているだけ＝DOM からは消えていない（`v-show`）
    expect(visiblePanelIndexes(app)).toEqual([0])
    expect(app.find('.app__center .tform').exists()).toBe(true)

    await clickTab(app, '迷宮マップ')
    expect(visiblePanelIndexes(app)).toEqual([1])
    // ⚠⚠ **`v-if` への差し替えを殺す述語はここから始まる。**
    //   `v-if` だと空の新しいフォームが出るので、`exists()` は緑のまま通る。
    //   ⚠ 本文側は内容が Editor 実体に残るのでこの形では殺せない → `#2b` が受け持つ。
    expect(draftText(app)).toBe('かきかけの迷宮')
  })

  it('配列に足した要素も残っている（下書きの一部だけが生き残るのでもない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    const roomsAdd = app
      .findAll('.field--array')
      .find((f) => f.find('legend').text().startsWith('部屋'))!
      .find('.field__add')
    await roomsAdd.trigger('click')
    await roomsAdd.trigger('click')
    const before = app.findAll('.field--array .field__item').length
    expect(before).toBeGreaterThan(0)

    await clickTab(app, '本文')
    await clickTab(app, '迷宮マップ')
    expect(app.findAll('.field--array .field__item')).toHaveLength(before)
  })

  /**
   * ⚠⚠ **この 1 本だけでは本文側の根拠にならない**（実測）。
   *   本文の中身（doc）は `App` が持つ `Editor` 実体の中にあり、`EditorContent` を
   *   捨てて作り直しても**内容は残る**ため、`v-if` 変異でもここは緑のまま通る。
   *   → 本文側の `v-show` を守っているのは**次の 1 本（DOM の同一性）**。
   */
  it('本文タブで打った内容も残る（見えている範囲の退行止め）', async () => {
    const app = await mountApp()
    const editor = (wrapper!.vm as unknown as { editor: Editor }).editor
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ほんぶんに打った行' }] }],
    })
    await nextTick()

    await openDungeonForm(app)
    await clickTab(app, '本文')
    // ⚠ Tiptap を作り直していれば、この doc は初期値へ戻る
    expect((wrapper!.vm as unknown as { editor: Editor }).editor.state.doc.textContent).toContain(
      'ほんぶんに打った行',
    )
  })
})

/**
 * ⭐⭐ §1-9-2 の表は「**本文側も同じ**（`v-show` で保持する）」と明記している。
 *
 * ⚠⚠ **私は当初これを「jsdom では観測できない」と申告したが、それは誤りだった**（監査が実測）。
 *   `doc` の中身は Editor 実体の側に残るので確かに観測できないが、
 *   **再アタッチ（DOM が作り直されたこと）は観測できる**——
 *   `v-if` 変異下では `editor.view.dom` の親要素が**別の実体に入れ替わる**。
 *   → **「観測できない」と書く前に、観測できる側面が本当に 1 つも無いかを 1 回試す。**
 */
describe('#2b ⭐ 本文タブも作り直されない（DOM の同一性で見る）', () => {
  it('タブを往復しても、エディタが刺さっている DOM が入れ替わらない', async () => {
    const app = await mountApp()
    const editor = (wrapper!.vm as unknown as { editor: Editor }).editor
    const mountPointBefore = editor.view.dom.parentElement
    const panelBefore = app.find('.app__editor').element
    // ⚠ 両方が null / undefined だと `toBe` は素通りするので、居ることを先に確かめる。
    expect(mountPointBefore).not.toBeNull()
    expect(panelBefore).toBeTruthy()

    await openDungeonForm(app)
    await clickTab(app, '本文')

    // ⚠⚠ ここが本文側の `v-show` を守っている唯一の述語。
    //   `v-if` にすると component が作り直され、Tiptap が別の DOM へ刺さり直す。
    expect(editor.view.dom.parentElement).toBe(mountPointBefore)
    expect(app.find('.app__editor').element).toBe(panelBefore)
  })
})

describe('#3 未保存の印', () => {
  it('開いた直後は印が無く、打つと出る', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    // ⚠ 迷宮マップは配列の欄を持つ。`pruneEmpty` で判定していると、ここで既に点いてしまう。
    expect(app.find('.tabs__dirty').exists()).toBe(false)

    await typeDraft(app, 'し')
    expect(app.find('.tabs__dirty').exists()).toBe(true)
    expect(app.find('.tabs__tab--active').text()).toContain('●')
  })

  it('消すと印も消える（点きっぱなしにならない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'し')
    expect(app.find('.tabs__dirty').exists()).toBe(true)
    await typeDraft(app, '')
    expect(app.find('.tabs__dirty').exists()).toBe(false)
  })

  it('⭐ 保存して閉じたあと選び直すと、前の印が残っていない', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'ほぞんする迷宮')
    await app.find('form.tform').trigger('submit')
    await flushPromises()

    await openDungeonForm(app)
    // ⚠ 閉じるとき component は捨てられる＝`update:dirty` はもう飛んでこない。
    //   受け側で落としていないと、ここに前の印が残る。
    expect(app.find('.tabs__dirty').exists()).toBe(false)
    expect(draftText(app)).toBe('')
  })
})

describe('#4 ⭐ 本文向けの操作は「移るだけ」——フォームのタブは残る', () => {
  async function mountWithHeading() {
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'さいしょのしょう' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'ほんぶん' }] },
      ],
    })
    return mountApp()
  }

  it('⭐⭐ 左ペインの見出しをクリックしても、フォームのタブと下書きが残る', async () => {
    const app = await mountWithHeading()
    await openDungeonForm(app)
    await typeDraft(app, 'きえないで')

    const item = app.findAll('.outline__item').find((i) => i.text().includes('さいしょのしょう'))!
    await item.trigger('click')
    await nextTick()

    // 本文タブへ移った
    expect(activeTabLabel(app)).toBe('本文')
    // ⚠⚠ **閉じていない**（§1-9-2「閉じるのは明示操作のときだけ」）
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])

    await clickTab(app, '迷宮マップ')
    expect(draftText(app)).toBe('きえないで')
  })

  /**
   * ⚠ 本文タブへ移る経路は **4 つ**ある（左ペインのクリック・md の書き出し・md の読み込み・
   *   素材の挿入）。**4 つとも述語を置く**——1 つでも抜けていると、
   *   仕様へ昇格した瞬間に「半分が未検査の仕様」になる（監査 F2）。
   */
  it('⭐ 素材を本文へ挿入しても、フォームのタブと下書きが残る', async () => {
    const app = await mountWithHeading()
    // まず素材を 1 件作る（挿入の対象が要る）
    await openDungeonForm(app)
    await typeDraft(app, 'そざいのもと')
    await app.find('form.tform').trigger('submit')
    await flushPromises()

    // そのうえで別の下書きを打ちかけにしておく
    await openDungeonForm(app)
    await typeDraft(app, 'そうにゅうでものこる')

    const insert = app.findAll('.materials__item button').find((b) => b.text() === '本文へ挿入')
    if (!insert) throw new Error('素材一覧に「本文へ挿入」がありません')
    await insert.trigger('click')
    await nextTick()

    // ⚠ 挿し込む先が隠れていると、挿さったものが見えず `focus()` も当たらない
    expect(activeTabLabel(app)).toBe('本文')
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])

    await clickTab(app, '迷宮マップ')
    expect(draftText(app)).toBe('そうにゅうでものこる')
  })

  it('⭐ md を読み込んでも、フォームのタブと下書きが残る', async () => {
    const app = await mountWithHeading()
    // 「md を読み込む」は書き出すまで押せない（`mdOpen`）ので、先に書き出す
    await app
      .findAll('.app__actions button')
      .find((b) => b.text() === 'md で書き出す')!
      .trigger('click')
    await nextTick()

    await openDungeonForm(app)
    await typeDraft(app, 'よみこんでものこる')

    await app
      .findAll('.app__actions button')
      .find((b) => b.text() === 'md を読み込む')!
      .trigger('click')
    await nextTick()

    expect(activeTabLabel(app)).toBe('本文')
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])

    await clickTab(app, '迷宮マップ')
    expect(draftText(app)).toBe('よみこんでものこる')
  })

  it('md で書き出しても、フォームのタブと下書きが残る', async () => {
    const app = await mountWithHeading()
    await openDungeonForm(app)
    await typeDraft(app, 'これものこる')

    await app
      .findAll('.app__actions button')
      .find((b) => b.text() === 'md で書き出す')!
      .trigger('click')
    await nextTick()

    expect(activeTabLabel(app)).toBe('本文')
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])
    expect(app.find('.app__md').exists()).toBe(true)

    await clickTab(app, '迷宮マップ')
    expect(draftText(app)).toBe('これものこる')
  })
})

describe('#5 閉じるのは明示操作のときだけ', () => {
  it('保存するとタブが閉じて本文へ戻る', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'ほぞんする迷宮')
    await app.find('form.tform').trigger('submit')
    await flushPromises()

    expect(tabLabels(app)).toEqual(['本文'])
    expect(activeTabLabel(app)).toBe('本文')
    expect(app.find('.tform').exists()).toBe(false)
  })

  it('「やめる」でもタブが閉じて本文へ戻る（⚠ ここでは確認しない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'すてる迷宮')
    const cancel = app.findAll('.tform__actions button').find((b) => b.text() === 'やめる')!
    await cancel.trigger('click')

    expect(tabLabels(app)).toEqual(['本文'])
    // ⚠ 確認の帯は出ない（仕様が ✕ にだけ確認を置いている・§1-9-2）
    expect(app.find('.tabs__confirm').exists()).toBe(false)
  })

  it('✕ は下書きが無ければそのまま閉じる（毎回聞かない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await app.find('.tabs__close').trigger('click')

    expect(app.find('.tabs__confirm').exists()).toBe(false)
    expect(tabLabels(app)).toEqual(['本文'])
  })

  it('⭐ ✕ は下書きが残っていれば一度確認する（押した瞬間には消えない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'きえたらこまる')
    await app.find('.tabs__close').trigger('click')

    // まだ閉じていない＝下書きも生きている
    expect(app.find('.tabs__confirm').exists()).toBe(true)
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])
    expect(draftText(app)).toBe('きえたらこまる')

    // 思い直せる
    await app.find('.tabs__confirmNo').trigger('click')
    expect(app.find('.tabs__confirm').exists()).toBe(false)
    expect(tabLabels(app)).toEqual(['本文', '迷宮マップ'])
    expect(draftText(app)).toBe('きえたらこまる')

    // もう一度押して、今度は捨てる
    await app.find('.tabs__close').trigger('click')
    await app.find('.tabs__confirmYes').trigger('click')
    expect(tabLabels(app)).toEqual(['本文'])
    expect(activeTabLabel(app)).toBe('本文')
  })

  it('確認中に下書きが空になったら、問いも畳まれる（押しても何も起きないボタンを残さない）', async () => {
    const app = await mountApp()
    await openDungeonForm(app)
    await typeDraft(app, 'あとで消す')
    await app.find('.tabs__close').trigger('click')
    expect(app.find('.tabs__confirm').exists()).toBe(true)

    await clickTab(app, '迷宮マップ')
    await typeDraft(app, '')
    await nextTick()
    expect(app.find('.tabs__confirm').exists()).toBe(false)
  })
})
