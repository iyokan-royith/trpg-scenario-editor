/**
 * 素材の挿入（DESIGN-v0.md 1-7）の完了条件を、**画面の経路で**確かめる。
 *
 * ここで通すのは 1-7-6 の表のうち #1〜#5 と、object URL の後始末。
 * （#6 は `template/__tests__/loader.spec.ts`、#7 は `store/__tests__/instancePersistence.spec.ts`）
 *
 * ⚠⚠ 各層の単体テストが緑でも、**画面の配線が 1 本抜けていると何も起きない**。
 *   P1 で実際に踏んだ型（左ペインの配線が死んでいても層のテストは緑だった）なので、
 *   ここは必ず「ファイルを選ぶ → ボタンを押す」の側から触る。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import App from '../App.vue'
import { usePartStore, IMAGE_TEMPLATE_ID } from '../store/partStore'
import {
  clearDocument,
  clearInstances,
  loadInstances,
  saveDocument,
  saveInstance,
} from '../store/persistence'
import { collectPlacedRefs, PART_REF_INLINE_NODE } from '../document/partRefExtension'
import type { TemplateInstance } from '../template/model'

/** jsdom には object URL が無いので、生成と解放を数えられる形で置き換える。 */
let createdUrls: string[] = []
let revokedUrls: string[] = []

function stubObjectUrl() {
  createdUrls = []
  revokedUrls = []
  const url = URL as unknown as {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
  }
  url.createObjectURL = () => {
    const u = `blob:みほん/${createdUrls.length}`
    createdUrls.push(u)
    return u
  }
  url.revokeObjectURL = (u: string) => {
    revokedUrls.push(u)
  }
}

function imageFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

let pinia: Pinia
let wrapper: VueWrapper

async function mountApp() {
  pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [pinia] } })
  // ⚠ 起動時の読み出しは IndexedDB のイベント経由なので、microtask 1 周では終わらない。
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((wrapper.vm as unknown as { editor: Editor | null }).editor) break
  }
  await nextTick()
  return wrapper
}

function editorOf(): Editor {
  const editor = (wrapper.vm as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

/** 「素材を追加」を押して、ファイルを選ぶところまで（＝利用者がする操作そのもの）。 */
async function chooseImage(file: File) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
  await nextTick()
}

/**
 * 保存が届くまで待つ。
 * ⚠ 画像の保存は「change ハンドラ → `blob.arrayBuffer()` → IndexedDB のイベント」と
 *   **マクロタスクを2段またぐ**ので、`flushPromises()` 1 周では終わらない。
 *   固定時間の待ちにすると遅い機械で落ちるので、条件が満たされるまで回す。
 */
async function waitForSaved(isReady: (list: TemplateInstance[]) => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const list = await loadInstances()
    if (await isReady(list)) return list
  }
  throw new Error('保存が届きませんでした')
}

function materialRows() {
  return wrapper.findAll('.materials__item')
}

function materialPane() {
  return wrapper.findComponent({ name: 'MaterialPane' })
}

beforeEach(async () => {
  stubObjectUrl()
  await clearDocument()
  await clearInstances()
})

afterEach(() => {
  wrapper?.unmount()
})

describe('#1 「素材を追加 → 画像を選ぶ」で素材一覧に出る', () => {
  it('同梱テンプレが loader 経由で読まれていて、選んだ画像が一覧に並ぶ', async () => {
    await mountApp()
    // ⭐ 裏で同梱 JSON が読まれている（これが無いとインスタンスを作ってもパートが生まれない）
    const store = usePartStore()
    expect(store.definitions[IMAGE_TEMPLATE_ID]).toBeDefined()

    expect(materialPane().text()).toContain('素材はまだありません')

    await chooseImage(imageFile('ねこ.png', [1, 2, 3]))

    expect(materialRows()).toHaveLength(1)
    expect(materialRows()[0]!.text()).toContain('ねこ.png')
    // ⚠ 利用者にテンプレートであることを見せない（1-7-2）
    expect(materialPane().text()).not.toContain('テンプレート')
  })

  it('選んだ画像は保存されている（リロードで残る側の実体）', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [7, 7]))

    const stored = await waitForSaved((list) => list.length === 1)
    expect(stored[0]!.templateId).toBe(IMAGE_TEMPLATE_ID)
    expect([...new Uint8Array(await stored[0]!.images.image!.arrayBuffer())]).toEqual([7, 7])
  })
})

describe('#5 「未配置 N 件」が動く', () => {
  it('1 個置くと N が 1 減る', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))
    expect(materialPane().text()).toContain('未配置 1 件')

    await materialRows()[0]!.findAll('button')[0]!.trigger('click') // 「本文へ挿入」
    await nextTick()

    expect(materialPane().text()).toContain('未配置 0 件')
  })

  it('「未配置だけ」で絞り込める', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))
    await materialRows()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    await wrapper.find('.materials__filter input').setValue(true)
    expect(materialRows()).toHaveLength(0)
    expect(materialPane().text()).toContain('素材はまだありません')
  })
})

describe('#2 本文の任意の位置に差し込める', () => {
  it('カーソルが文の途中にあれば、文の途中へ入る（前後のテキストが割れる）', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))

    // 初期本文は「ここに書きはじめる」。その真ん中にカーソルを置く。
    editorOf().commands.setTextSelection(5)
    await materialRows()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    const paragraph = editorOf().state.doc.firstChild!
    expect(paragraph.type.name).toBe('paragraph')
    // ⭐ 完了条件 #2: **文の途中**。block 版ではこの形が作れない
    expect(
      [...Array(paragraph.childCount).keys()].map((i) => paragraph.child(i).type.name),
    ).toEqual(['text', PART_REF_INLINE_NODE, 'text'])
    expect(paragraph.child(0).text).toBe('ここに書')
    expect(paragraph.child(2).text).toBe('きはじめる')
  })

  it('空の段落に単独で置ける（＝「ブロックの素材」の見え方）', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))

    // 末尾に空の段落を足して、そこへ置く
    const ed = editorOf()
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    ed.commands.insertContent({ type: 'paragraph' })
    await materialRows()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    const lastParagraph = ed.state.doc.child(ed.state.doc.childCount - 1)
    expect(lastParagraph.childCount).toBe(1)
    expect(lastParagraph.child(0).type.name).toBe(PART_REF_INLINE_NODE)
  })
})

describe('#3 同じ画像を 2 箇所に置ける。差し替えると両方変わる', () => {
  it('画面の「差し替え」で、置かれた 2 箇所とも入れ替わり、保存にも反映される', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))
    const buttons = () => materialRows()[0]!.findAll('button')
    await buttons()[0]!.trigger('click') // 本文へ挿入
    await buttons()[0]!.trigger('click') // もう 1 箇所（S7-3: 2 箇所配置は正常）
    await nextTick()

    const imageNodes = () => wrapper.findAll('.part-ref__image')
    expect(imageNodes()).toHaveLength(2)
    const before = imageNodes().map((v) => v.attributes('src'))
    // ⚠ object URL は NodeView ごとに発行するので**同じ文字列にはならない**（同じ Blob を指す別の口）。
    //   「同じものを指しているか」は URL ではなく、差し替えたときに両方が変わるかで見る。
    expect(before.every((src) => Boolean(src))).toBe(true)
    expect(createdUrls).toHaveLength(2)

    // ⭐ 利用者の操作で差し替える（本文には一度も触らない）
    await buttons()
      .find((b) => b.text() === '差し替え')!
      .trigger('click') // ⚠ 位置ではなく文字で（上の注意を参照）
    await chooseImage(imageFile('いぬ.png', [9, 9]))

    const after = imageNodes().map((v) => v.attributes('src'))
    expect(after).toHaveLength(2)
    // ⭐ 2 箇所とも新しい実体を指し直している
    expect(after[0]).not.toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    // ⚠ 古い object URL は捨てる（放っておくとページの寿命まで Blob が残る）
    expect(revokedUrls).toEqual(expect.arrayContaining(before as string[]))

    // ⚠⚠ 保存まで届いていること。ここが抜けると**画面では差し替わったのにリロードで戻る**
    const stored = await waitForSaved(async (list) => {
      const blob = list[0]?.images.image
      return blob ? (await blob.arrayBuffer()).byteLength === 2 : false
    })
    expect(stored).toHaveLength(1)
    expect([...new Uint8Array(await stored[0]!.images.image!.arrayBuffer())]).toEqual([9, 9])
    // 表示名は差し替えでは変えない（本文中の呼び名が黙って変わらない）
    expect(stored[0]!.data.caption).toBe('ねこ.png')
  })

  it('差し替えは本文に触らない（参照の数も位置も変わらない）', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))
    const buttons = () => materialRows()[0]!.findAll('button')
    await buttons()[0]!.trigger('click')
    await nextTick()
    const bodyBefore = JSON.stringify(editorOf().getJSON())

    await buttons()
      .find((b) => b.text() === '差し替え')!
      .trigger('click')
    await chooseImage(imageFile('いぬ.png', [9]))

    expect(JSON.stringify(editorOf().getJSON())).toBe(bodyBefore)
  })
})

describe('#4 インスタンスを消すと、置かれていた参照についてアラートが出る', () => {
  it('表示名と、本文に残っている箇所数が出る', async () => {
    await mountApp()
    await chooseImage(imageFile('ねこ.png', [1]))
    const buttons = () => materialRows()[0]!.findAll('button')
    await buttons()[0]!.trigger('click') // 挿入
    await buttons()[0]!.trigger('click') // もう 1 箇所
    await nextTick()

    // ⚠ **位置で拾わない**（素材単位の操作は増える——実際 §1-11 の「編集」が間に入って
    //   `[2]` が別のボタンを指すようになった）。**文字で探す。**
    await buttons()
      .find((b) => b.text() === '消す')!
      .trigger('click')
    await flushPromises()
    await nextTick()

    const notice = wrapper.find('.app__notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('ねこ.png') // ⭐ 何が消えたかが言える（表示名を持つ理由）
    expect(notice.text()).toContain('2 箇所')

    // 本文の参照は勝手に消さない。行方不明として見えている（S7-2）
    expect(wrapper.findAll('.part-ref__missing')).toHaveLength(2)
    expect(await loadInstances()).toEqual([])
  })
})

describe('#7 リロードしても画像が残る', () => {
  /**
   * ⚠⚠ **読み込みの経路だけで壊れる**型を押さえる。
   *   起動時の doc は `restoreHeadingMarksInJson()` を通る。そこが段落の中の atom を
   *   素通しできていないと、**保存したはずの参照が開いた瞬間に消えて、自動保存で確定する**
   *   （P1 で実際に起きたのと同じ形）。
   */
  it('保存された本文の inline 参照と、保存された画像が、起動しただけで揃う', async () => {
    await saveInstance({
      id: 'そざい1',
      templateId: IMAGE_TEMPLATE_ID,
      data: { caption: 'ねこ.png' },
      images: { image: new Blob([new Uint8Array([4, 2])], { type: 'image/png' }) },
    })
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'まえ' },
            { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'そざい1', partId: 'image' } },
            { type: 'text', text: 'あと' },
          ],
        },
      ],
    })

    await mountApp()

    // 参照が本文に残っている（開いた瞬間に消えていない）
    const refs = collectPlacedRefs(editorOf().state.doc)
    expect(refs.map((r) => `${r.instanceId}/${r.partId}`)).toEqual(['そざい1/image'])
    // 行方不明ではなく、画像として描かれている（＝ Blob が読み戻せている）
    expect(wrapper.findAll('.part-ref__missing')).toHaveLength(0)
    expect(wrapper.findAll('.part-ref__image')).toHaveLength(1)
    expect(wrapper.find('.part-ref__image').attributes('alt')).toBe('ねこ.png')
    // 素材一覧にも並ぶ（配置済みなので未配置は 0 件）
    expect(materialPane().text()).toContain('未配置 0 件')
  })
})

/**
 * ⚠⚠ 識別子の英語化（DESIGN §1-8）より **前に保存された本文と素材** を開く経路。
 *
 *   改名した名前は 2 箇所に保存されている——素材側のキー（`表示名` / `画像`）と、
 *   **本文側の `partRef` の `partId`（`画像`）**。片方だけ直すと、
 *   置いた画像が全部「行方不明のパート」になり「未配置 N 件」も一緒に化ける。
 *   ⚠ これは各層の単体テストでは 1 件も赤くならない（保存済みデータを通らないため）。
 */
describe('英語化する前に保存された本文と素材を開く', () => {
  it('旧 partId・旧キーで保存されていても、画像として描かれ、未配置も正しい', async () => {
    await saveInstance({
      id: 'そざい1',
      templateId: IMAGE_TEMPLATE_ID,
      data: { 表示名: 'ねこ.png' },
      images: { 画像: new Blob([new Uint8Array([4, 2])], { type: 'image/png' }) },
    } as unknown as TemplateInstance)
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'まえ' },
            // ⚠ 旧実装が実際に書いていた形（partId が日本語）
            { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'そざい1', partId: '画像' } },
          ],
        },
      ],
    })

    await mountApp()

    expect(wrapper.findAll('.part-ref__missing')).toHaveLength(0)
    expect(wrapper.findAll('.part-ref__image')).toHaveLength(1)
    expect(wrapper.find('.part-ref__image').attributes('alt')).toBe('ねこ.png')
    expect(materialPane().text()).toContain('未配置 0 件')
    // 参照は現行の partId になっている（旧名は上の層へ流さない）
    expect(collectPlacedRefs(editorOf().state.doc).map((r) => r.partId)).toEqual(['image'])
  })
})
