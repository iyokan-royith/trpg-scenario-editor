/**
 * 画面の結線が生きていることの確認（機能の中身は各層のテストが見る）。
 *
 * ⚠ もとの「You did it!」（Vue の雛形）を確かめるテストは、App.vue を実物に
 *   差し替えた時点で意味を失うので、この内容へ**意図的に**書き換えている。
 *
 * ⚠ ここも DOM のキー入力・ドラッグ・実リロードは通していない。
 *   要検証[実際のブラウザで、本文を打つと左ペインが増え、リロードで内容が残ることを目視確認する]
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import App from '../App.vue'
import { headingTitle, headingMark } from '../document/heading'
import {
  clearDocument,
  clearInstances,
  loadDocument,
  saveDocument,
  saveInstance,
} from '../store/persistence'
import { readMayoiParkSample } from '../samples'

async function mountApp() {
  // ⚠ 本物の document に挿さないと `view.hasFocus()` が真にならず、
  //   フォーカス由来の表示（要望1）が 1 度も通らないまま緑になる。
  const wrapper = mount(App, {
    attachTo: document.body,
    global: { plugins: [createPinia()] },
  })
  // ⚠ 起動時の読み出しは IndexedDB のイベント経由なので、microtask 1 周では終わらない。
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((wrapper.vm as unknown as { editor: Editor | null }).editor) break
  }
  await nextTick()
  return wrapper
}

function editorOf(wrapper: Awaited<ReturnType<typeof mountApp>>): Editor {
  const editor = (wrapper.vm as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

beforeEach(async () => {
  await clearDocument()
})

describe('App', () => {
  it('起動すると本文と左ペインが出る', async () => {
    const wrapper = await mountApp()
    expect(wrapper.text()).toContain('シナリオエディタ')
    expect(wrapper.find('.outline').exists()).toBe(true)
    wrapper.unmount()
  })

  it('見出しが無ければ左ペインは空表示', async () => {
    const wrapper = await mountApp()
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain(
      '見出しはまだありません',
    )
    wrapper.unmount()
  })

  it('⭐ 前回の内容が復元され、その見出しが左ペインに出る', async () => {
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'ほぞんした見出し' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'ほぞんした本文' }] },
      ],
    })
    const wrapper = await mountApp()
    expect(editorOf(wrapper).state.doc.textContent).toContain('ほぞんした本文')
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain('ほぞんした見出し')
    wrapper.unmount()
  })

  it('⭐ 本文を編集すると左ペインが追従する（アプリ側の配線ごと）', async () => {
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'あとから足した章' }],
        },
      ],
    })
    await nextTick()

    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain('あとから足した章')
    wrapper.unmount()
  })

  it('⭐ 本文編集だけ（選択を動かさない）でも左ペインが追従する', async () => {
    // ⚠ 判別テスト: setContent は選択も動かすので onSelectionUpdate 側でも追従してしまい、
    //   onUpdate の配線が死んでいても緑になる（陽性対照で実測）。
    //   カーソルから離れた位置への挿入なら選択は動かないので、onUpdate だけが発火する。
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    const selectionBefore = editor.state.selection.from

    const heading = editor.state.schema.node(
      'heading',
      { level: 1 },
      editor.state.schema.text(headingMark(1) + 'カーソルから離れた所に足した章'),
    )
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, heading))
    await nextTick()

    // 選択は動いていない＝onSelectionUpdate は発火していない
    expect(editor.state.selection.from).toBe(selectionBefore)
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain(
      'カーソルから離れた所に足した章',
    )
    wrapper.unmount()
  })

  it('⭐ 画面を閉じるとき、保留中の変更が捨てられずに保存される', async () => {
    const wrapper = await mountApp()
    editorOf(wrapper).commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'とじるまえに書いた行' }] }],
    })
    // ⚠ 自動保存の待ち時間（既定 500ms）より前に閉じる＝いちばん失われやすい瞬間
    wrapper.unmount()

    for (let i = 0; i < 50; i += 1) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const stored = await loadDocument()
      if (JSON.stringify(stored?.doc ?? '').includes('とじるまえに書いた行')) return
    }
    throw new Error('閉じる前の変更が保存されていません')
  })
})

/**
 * ⚠ ここが監査で「テスト 0 件」と指摘された層。
 *   左ペインの DOM イベント → OutlinePane の emit → App のハンドラ →
 *   document 層 → 本文が変わる、までを 1 本で通す。
 */
describe('左ペインの操作が本文に届く（配線ごと）', () => {
  async function mountTwoSections() {
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'あかしょう' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'あかの本文' }] },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'あおしょう' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'あおの本文' }] },
      ],
    })
    return mountApp()
  }

  function sectionTitles(wrapper: Awaited<ReturnType<typeof mountApp>>): string[] {
    const out: string[] = []
    editorOf(wrapper).state.doc.forEach((node) => {
      if (node.type.name === 'heading') out.push(headingTitle(node.textContent))
    })
    return out
  }

  it('⭐ すぐ下の項目へドラッグすると「1 つ下へ」動く（最も自然なジェスチャ）', async () => {
    const wrapper = await mountTwoSections()
    expect(sectionTitles(wrapper)).toEqual(['あかしょう', 'あおしょう'])

    const items = wrapper.findAll('.outline__item')
    expect(items).toHaveLength(2)
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('drop')
    await nextTick()

    expect(sectionTitles(wrapper)).toEqual(['あおしょう', 'あかしょう'])
    // ⚠ 「そこへは移せません」が出ていないこと（欠陥のときはこれが出ていた）
    expect(wrapper.text()).not.toContain('そこへは移せません')
    wrapper.unmount()
  })

  it('すぐ上の項目へドラッグすると「1 つ上へ」動く', async () => {
    const wrapper = await mountTwoSections()
    const items = wrapper.findAll('.outline__item')
    await items[1]!.trigger('dragstart')
    await items[0]!.trigger('drop')
    await nextTick()

    expect(sectionTitles(wrapper)).toEqual(['あおしょう', 'あかしょう'])
    wrapper.unmount()
  })

  it('階層ボタンで見出しのレベルが変わり、ツリーの親子関係も変わる', async () => {
    const wrapper = await mountTwoSections()
    const demoteButton = wrapper.findAll('.outline__item')[1]!.findAll('button')[1]!
    await demoteButton.trigger('click')
    await nextTick()

    const doc = editorOf(wrapper).state.doc
    const levels: number[] = []
    doc.forEach((node) => {
      if (node.type.name === 'heading') levels.push(Number(node.attrs.level))
    })
    expect(levels).toEqual([1, 2])
    // level 2 になった「あおしょう」は「あかしょう」の子になる
    const pane = wrapper.findComponent({ name: 'OutlinePane' })
    expect(pane.findAll('.outline__item--depth2')).toHaveLength(1)
    wrapper.unmount()
  })

  it('自分の配下へ落としたときは、黙って壊さずに知らせを出す', async () => {
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'おやしょう' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: headingMark(2) + 'このせつ' }],
        },
      ],
    })
    const wrapper = await mountApp()
    const items = wrapper.findAll('.outline__item')
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('drop')
    await nextTick()

    expect(wrapper.text()).toContain('そこへは移せません')
    expect(sectionTitles(wrapper)).toEqual(['おやしょう', 'このせつ'])
    wrapper.unmount()
  })
})

/**
 * ロイスが実機を触って出した要望（2026-08-23）。
 */
describe('要望1: フォーカスの所在をブロック単位で示す', () => {
  it('⭐ ブラウザ既定の枠に頼らず、カーソルの居るブロックに印が付く', async () => {
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    // ⚠ jsdom は contenteditable にフォーカスを当てられないので、
    //   ブラウザと同じ DOM イベントを直接起こす（ProseMirror が受ける経路は同じ）。
    editor.view.dom.dispatchEvent(new FocusEvent('focus'))
    await nextTick()

    // 印はブロック単位（ProseMirror の直下の要素）に付く
    expect(wrapper.findAll('.current-block').length).toBe(1)
    wrapper.unmount()
  })

  it('⭐ フォーカスが無いときは印を出さない（＝これがフォーカスの所在を示している）', async () => {
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    editor.view.dom.dispatchEvent(new FocusEvent('focus'))
    await nextTick()
    expect(wrapper.findAll('.current-block').length).toBe(1)

    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(wrapper.findAll('.current-block').length).toBe(0)
    wrapper.unmount()
  })
})

describe('要望3: ドラッグ中に挿入位置のガイドが出る', () => {
  async function mountThreeSections() {
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'いち' }],
        },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'に' }],
        },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: headingMark(1) + 'さん' }],
        },
      ],
    })
    return mountApp()
  }

  it('⭐ ガイドは dropTargetPos と同じ場所を指す（下へ運ぶと、相手の次の項目の手前）', async () => {
    const wrapper = await mountThreeSections()
    const items = wrapper.findAll('.outline__item')
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('dragover')
    await nextTick()

    // 「いち」を「に」の場所へ→「に」のうしろ＝「さん」の手前に線が出る
    const guidedItems = wrapper.findAll('.outline__item--guide')
    expect(guidedItems).toHaveLength(1)
    expect(guidedItems[0]!.text()).toContain('さん')
    wrapper.unmount()
  })

  it('上へ運ぶときは相手の手前に出る', async () => {
    const wrapper = await mountThreeSections()
    const items = wrapper.findAll('.outline__item')
    await items[2]!.trigger('dragstart')
    await items[0]!.trigger('dragover')
    await nextTick()

    const guidedItems = wrapper.findAll('.outline__item--guide')
    expect(guidedItems).toHaveLength(1)
    expect(guidedItems[0]!.text()).toContain('いち')
    wrapper.unmount()
  })

  it('⭐ ガイドが指した場所に、実際に落ちる（見えている線と着地が一致する）', async () => {
    const wrapper = await mountThreeSections()
    const items = wrapper.findAll('.outline__item')
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('dragover')
    await nextTick()
    const guideText = wrapper.findAll('.outline__item--guide')[0]!.text()
    expect(guideText).toContain('さん')

    await items[1]!.trigger('drop')
    await nextTick()
    // 「いち」は「さん」の手前＝2 番目に着地する
    expect(
      wrapper.findAll('.outline__item').map((i) => i.text().replace(/[←→]/g, '').trim()),
    ).toEqual(['に', 'いち', 'さん'])
    wrapper.unmount()
  })

  it('落としたらガイドは消える', async () => {
    const wrapper = await mountThreeSections()
    const items = wrapper.findAll('.outline__item')
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('dragover')
    await nextTick()
    expect(wrapper.findAll('.outline__item--guide')).toHaveLength(1)

    await items[1]!.trigger('drop')
    await nextTick()
    expect(wrapper.findAll('.outline__item--guide')).toHaveLength(0)
    wrapper.unmount()
  })
})

describe('要望4: 「これ以上は変えられません」が出るタイミング', () => {
  async function mountWith(content: unknown) {
    await saveDocument(content)
    return mountApp()
  }
  function heading(level: number, text: string) {
    return {
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text: headingMark(level) + text }],
    }
  }

  it('⭐ 陰性: 上限に「達しただけ」では何も出ない（ボタンが押せないことで示す）', async () => {
    const wrapper = await mountWith({ type: 'doc', content: [heading(6, 'げんかい')] })
    const btns = wrapper.findAll('.outline__item')[0]!.findAll('button')
    // → は押せない＝「達している」ことが見た目で分かる
    expect(btns[1]!.attributes('disabled')).toBeDefined()
    await btns[1]!.trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('これ以上')
    expect(wrapper.text()).not.toContain('ずらせない')
    wrapper.unmount()
  })

  it('⭐ 陰性: 下限でも同じ（← が押せず、知らせも出ない）', async () => {
    const wrapper = await mountWith({ type: 'doc', content: [heading(1, 'いちばんうえ')] })
    const btns = wrapper.findAll('.outline__item')[0]!.findAll('button')
    expect(btns[0]!.attributes('disabled')).toBeDefined()
    await btns[0]!.trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('ずらせない')
    wrapper.unmount()
  })

  it('⭐ 陽性: 見えない理由で断られたときだけ知らせが出る（配下が押し出される）', async () => {
    // 親 5・子 6。親を下げると子が 7 になってしまう＝左ペインからは分からない理由
    const wrapper = await mountWith({
      type: 'doc',
      content: [heading(5, 'おや'), heading(6, 'こ')],
    })
    const btns = wrapper.findAll('.outline__item')[0]!.findAll('button')
    expect(btns[1]!.attributes('disabled')).toBeUndefined() // 親自身は下げられる見た目
    await btns[1]!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('これ以上ずらせない見出しがあります')
    wrapper.unmount()
  })

  it('⭐ そのとき本文は変わっていない（黙って潰さない）', async () => {
    const wrapper = await mountWith({
      type: 'doc',
      content: [heading(5, 'おや'), heading(6, 'こ')],
    })
    await wrapper.findAll('.outline__item')[0]!.findAll('button')[1]!.trigger('click')
    await nextTick()

    const levels: number[] = []
    editorOf(wrapper).state.doc.forEach((n) => {
      if (n.type.name === 'heading') levels.push(Number(n.attrs.level))
    })
    // 以前はここが [6, 6] になって、親子が同じ深さに潰れていた
    expect(levels).toEqual([5, 6])
    wrapper.unmount()
  })

  it('普通に変えられるときは知らせを出さない', async () => {
    const wrapper = await mountWith({ type: 'doc', content: [heading(2, 'ふつう')] })
    await wrapper.findAll('.outline__item')[0]!.findAll('button')[1]!.trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('ずらせない')
    expect(editorOf(wrapper).state.doc.child(0).textContent).toBe('### ふつう')
    wrapper.unmount()
  })
})

/**
 * ⚠⚠ 3巡目監査の差し戻し（2026-08-23）。
 *   旧版（記号を消す方式）が保存した doc を持っている利用者がいて、
 *   新版で開いた瞬間に **見出しが消えて自動保存で確定する**経路が実在した。
 */
describe('旧版形式の doc を開いても、見出しが失われない', () => {
  /** 記号が本文に無く、レベルが attrs にしかない＝旧版が保存していた形。 */
  const legacyContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'まえがき' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'ほんぶんです' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'そのいち' }] },
    ],
  }

  it('⭐ 左ペインに見出しが出る（以前は「見出しはまだありません」だった）', async () => {
    await saveDocument(legacyContent)
    const wrapper = await mountApp()
    const pane = wrapper.findComponent({ name: 'OutlinePane' })
    expect(pane.text()).toContain('まえがき')
    expect(pane.text()).toContain('そのいち')
    wrapper.unmount()
  })

  it('⭐ 記号が本文に補われている（編集できる形で見えている）', async () => {
    await saveDocument(legacyContent)
    const wrapper = await mountApp()
    expect(editorOf(wrapper).state.doc.child(0).textContent).toBe('# まえがき')
    expect(editorOf(wrapper).state.doc.child(2).textContent).toBe('## そのいち')
    wrapper.unmount()
  })

  it('⭐⭐ 1 文字打っても見出しのまま（以前はここで全ブロックが段落へ降格した）', async () => {
    await saveDocument(legacyContent)
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    editor.view.dispatch(editor.state.tr.insertText('。', editor.state.doc.content.size - 1))
    await nextTick()

    const nodeNames: string[] = []
    editor.state.doc.forEach((n) => nodeNames.push(n.type.name))
    expect(nodeNames.slice(0, 3)).toEqual(['heading', 'paragraph', 'heading'])
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain('まえがき')
    wrapper.unmount()
  })

  it('⭐ 打った後に自動保存されても、見出しが残ったまま確定する', async () => {
    await saveDocument(legacyContent)
    const wrapper = await mountApp()
    const editor = editorOf(wrapper)
    editor.view.dispatch(editor.state.tr.insertText('。', editor.state.doc.content.size - 1))
    wrapper.unmount() // 閉じるときに flush される

    for (let i = 0; i < 50; i += 1) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const stored = await loadDocument()
      if (JSON.stringify(stored?.doc ?? '').includes('# まえがき')) return
    }
    throw new Error('保存された内容から見出しが失われています')
  })
})

/**
 * ⭐⭐ liquid の描画が画面まで届いているか（DESIGN-v0.md §1-13-1f 決定1・移行 P-d1）。
 *
 * ⚠ ストア単体のテスト（`store/__tests__/liquidPartsInStore.spec.ts`）とは別物である。
 *   あちらは「合流の機構」を見る。**ここは App がステータスバーと素材一覧へ
 *   実際に繋いでいるか**を見る——結線が抜けていても、ストアのテストは全部緑のままになる。
 */
describe('liquid の描画がステータスバーと素材一覧に出る（P-d1）', () => {
  beforeEach(async () => {
    await clearInstances()
  })

  it('同梱テンプレのたたき台が描かれ、件数がステータスバーに出る', async () => {
    await saveInstance(readMayoiParkSample())
    const wrapper = await mountApp()
    await flushPromises()
    await nextTick()

    const status = wrapper.find('.status')
    expect(status.exists()).toBe(true)
    // ⚠ 9 室ぶんの liquid パートが合流し、同期の 11 件と足して 20 件。
    expect(status.text()).toContain('パート 20 件（うち liquid 9 件）')
    expect(status.text()).toContain('描画済み')
    expect(status.attributes('data-status')).toBe('ready')

    // ⚠ 素材一覧にも出る（＝本文へ挿せる状態にある）。
    expect(wrapper.findComponent({ name: 'MaterialPane' }).text()).toContain(
      '部屋シート（たたき台）',
    )
    wrapper.unmount()
  })
})
