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
import { usePartStore, 画像テンプレID } from '../store/partStore'
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
let 作ったURL: string[] = []
let 解放したURL: string[] = []

function object_URL_を差し替える() {
  作ったURL = []
  解放したURL = []
  const url = URL as unknown as {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
  }
  url.createObjectURL = () => {
    const u = `blob:みほん/${作ったURL.length}`
    作ったURL.push(u)
    return u
  }
  url.revokeObjectURL = (u: string) => {
    解放したURL.push(u)
  }
}

function 画像ファイル(名前: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], 名前, { type: 'image/png' })
}

let pinia: Pinia
let wrapper: VueWrapper

async function 起動() {
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

function 本体(): Editor {
  const editor = (wrapper.vm as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

/** 「素材を追加」を押して、ファイルを選ぶところまで（＝利用者がする操作そのもの）。 */
async function 画像を選ぶ(file: File) {
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
async function 保存が届くまで(判定: (list: TemplateInstance[]) => boolean | Promise<boolean>) {
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const list = await loadInstances()
    if (await 判定(list)) return list
  }
  throw new Error('保存が届きませんでした')
}

function 素材の行() {
  return wrapper.findAll('.materials__item')
}

function 素材の一覧() {
  return wrapper.findComponent({ name: 'MaterialPane' })
}

beforeEach(async () => {
  object_URL_を差し替える()
  await clearDocument()
  await clearInstances()
})

afterEach(() => {
  wrapper?.unmount()
})

describe('#1 「素材を追加 → 画像を選ぶ」で素材一覧に出る', () => {
  it('同梱テンプレが loader 経由で読まれていて、選んだ画像が一覧に並ぶ', async () => {
    await 起動()
    // ⭐ 裏で同梱 JSON が読まれている（これが無いとインスタンスを作ってもパートが生まれない）
    const store = usePartStore()
    expect(store.definitions[画像テンプレID]).toBeDefined()

    expect(素材の一覧().text()).toContain('素材はまだありません')

    await 画像を選ぶ(画像ファイル('ねこ.png', [1, 2, 3]))

    expect(素材の行()).toHaveLength(1)
    expect(素材の行()[0]!.text()).toContain('ねこ.png')
    // ⚠ 利用者にテンプレートであることを見せない（1-7-2）
    expect(素材の一覧().text()).not.toContain('テンプレート')
  })

  it('選んだ画像は保存されている（リロードで残る側の実体）', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [7, 7]))

    const 保存されたもの = await 保存が届くまで((list) => list.length === 1)
    expect(保存されたもの[0]!.templateId).toBe(画像テンプレID)
    expect([...new Uint8Array(await 保存されたもの[0]!.images.画像!.arrayBuffer())]).toEqual([7, 7])
  })
})

describe('#5 「未配置 N 件」が動く', () => {
  it('1 個置くと N が 1 減る', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))
    expect(素材の一覧().text()).toContain('未配置 1 件')

    await 素材の行()[0]!.findAll('button')[0]!.trigger('click') // 「本文へ挿入」
    await nextTick()

    expect(素材の一覧().text()).toContain('未配置 0 件')
  })

  it('「未配置だけ」で絞り込める', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))
    await 素材の行()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    await wrapper.find('.materials__filter input').setValue(true)
    expect(素材の行()).toHaveLength(0)
    expect(素材の一覧().text()).toContain('素材はまだありません')
  })
})

describe('#2 本文の任意の位置に差し込める', () => {
  it('カーソルが文の途中にあれば、文の途中へ入る（前後のテキストが割れる）', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))

    // 初期本文は「ここに書きはじめる」。その真ん中にカーソルを置く。
    本体().commands.setTextSelection(5)
    await 素材の行()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    const 段落 = 本体().state.doc.firstChild!
    expect(段落.type.name).toBe('paragraph')
    // ⭐ 完了条件 #2: **文の途中**。block 版ではこの形が作れない
    expect([...Array(段落.childCount).keys()].map((i) => 段落.child(i).type.name)).toEqual([
      'text',
      PART_REF_INLINE_NODE,
      'text',
    ])
    expect(段落.child(0).text).toBe('ここに書')
    expect(段落.child(2).text).toBe('きはじめる')
  })

  it('空の段落に単独で置ける（＝「ブロックの素材」の見え方）', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))

    // 末尾に空の段落を足して、そこへ置く
    const ed = 本体()
    ed.commands.setTextSelection(ed.state.doc.content.size - 1)
    ed.commands.insertContent({ type: 'paragraph' })
    await 素材の行()[0]!.findAll('button')[0]!.trigger('click')
    await nextTick()

    const 最後の段落 = ed.state.doc.child(ed.state.doc.childCount - 1)
    expect(最後の段落.childCount).toBe(1)
    expect(最後の段落.child(0).type.name).toBe(PART_REF_INLINE_NODE)
  })
})

describe('#3 同じ画像を 2 箇所に置ける。差し替えると両方変わる', () => {
  it('画面の「差し替え」で、置かれた 2 箇所とも入れ替わり、保存にも反映される', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))
    const ボタン = () => 素材の行()[0]!.findAll('button')
    await ボタン()[0]!.trigger('click') // 本文へ挿入
    await ボタン()[0]!.trigger('click') // もう 1 箇所（S7-3: 2 箇所配置は正常）
    await nextTick()

    const 画像たち = () => wrapper.findAll('.part-ref__image')
    expect(画像たち()).toHaveLength(2)
    const まえ = 画像たち().map((v) => v.attributes('src'))
    // ⚠ object URL は NodeView ごとに発行するので**同じ文字列にはならない**（同じ Blob を指す別の口）。
    //   「同じものを指しているか」は URL ではなく、差し替えたときに両方が変わるかで見る。
    expect(まえ.every((src) => Boolean(src))).toBe(true)
    expect(作ったURL).toHaveLength(2)

    // ⭐ 利用者の操作で差し替える（本文には一度も触らない）
    await ボタン()[1]!.trigger('click') // 「差し替え」
    await 画像を選ぶ(画像ファイル('いぬ.png', [9, 9]))

    const あと = 画像たち().map((v) => v.attributes('src'))
    expect(あと).toHaveLength(2)
    // ⭐ 2 箇所とも新しい実体を指し直している
    expect(あと[0]).not.toBe(まえ[0])
    expect(あと[1]).not.toBe(まえ[1])
    // ⚠ 古い object URL は捨てる（放っておくとページの寿命まで Blob が残る）
    expect(解放したURL).toEqual(expect.arrayContaining(まえ as string[]))

    // ⚠⚠ 保存まで届いていること。ここが抜けると**画面では差し替わったのにリロードで戻る**
    const 保存されたもの = await 保存が届くまで(async (list) => {
      const blob = list[0]?.images.画像
      return blob ? (await blob.arrayBuffer()).byteLength === 2 : false
    })
    expect(保存されたもの).toHaveLength(1)
    expect([...new Uint8Array(await 保存されたもの[0]!.images.画像!.arrayBuffer())]).toEqual([9, 9])
    // 表示名は差し替えでは変えない（本文中の呼び名が黙って変わらない）
    expect(保存されたもの[0]!.data.表示名).toBe('ねこ.png')
  })

  it('差し替えは本文に触らない（参照の数も位置も変わらない）', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))
    const ボタン = () => 素材の行()[0]!.findAll('button')
    await ボタン()[0]!.trigger('click')
    await nextTick()
    const まえの本文 = JSON.stringify(本体().getJSON())

    await ボタン()[1]!.trigger('click')
    await 画像を選ぶ(画像ファイル('いぬ.png', [9]))

    expect(JSON.stringify(本体().getJSON())).toBe(まえの本文)
  })
})

describe('#4 インスタンスを消すと、置かれていた参照についてアラートが出る', () => {
  it('表示名と、本文に残っている箇所数が出る', async () => {
    await 起動()
    await 画像を選ぶ(画像ファイル('ねこ.png', [1]))
    const ボタン = () => 素材の行()[0]!.findAll('button')
    await ボタン()[0]!.trigger('click') // 挿入
    await ボタン()[0]!.trigger('click') // もう 1 箇所
    await nextTick()

    await ボタン()[2]!.trigger('click') // 「消す」
    await flushPromises()
    await nextTick()

    const しらせ = wrapper.find('.app__notice')
    expect(しらせ.exists()).toBe(true)
    expect(しらせ.text()).toContain('ねこ.png') // ⭐ 何が消えたかが言える（表示名を持つ理由）
    expect(しらせ.text()).toContain('2 箇所')

    // 本文の参照は勝手に消さない。行方不明として見えている（S7-2）
    expect(wrapper.findAll('.part-ref__missing')).toHaveLength(2)
    expect(await loadInstances()).toEqual([])
  })
})

describe('#7 リロードしても画像が残る', () => {
  /**
   * ⚠⚠ **読み込みの経路だけで壊れる**型を押さえる。
   *   起動時の doc は `保存内容の記号を補う()` を通る。そこが段落の中の atom を
   *   素通しできていないと、**保存したはずの参照が開いた瞬間に消えて、自動保存で確定する**
   *   （P1 で実際に起きたのと同じ形）。
   */
  it('保存された本文の inline 参照と、保存された画像が、起動しただけで揃う', async () => {
    await saveInstance({
      id: 'そざい1',
      templateId: 画像テンプレID,
      data: { 表示名: 'ねこ.png' },
      images: { 画像: new Blob([new Uint8Array([4, 2])], { type: 'image/png' }) },
    })
    await saveDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'まえ' },
            { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'そざい1', partId: '画像' } },
            { type: 'text', text: 'あと' },
          ],
        },
      ],
    })

    await 起動()

    // 参照が本文に残っている（開いた瞬間に消えていない）
    const refs = collectPlacedRefs(本体().state.doc)
    expect(refs.map((r) => `${r.instanceId}/${r.partId}`)).toEqual(['そざい1/画像'])
    // 行方不明ではなく、画像として描かれている（＝ Blob が読み戻せている）
    expect(wrapper.findAll('.part-ref__missing')).toHaveLength(0)
    expect(wrapper.findAll('.part-ref__image')).toHaveLength(1)
    expect(wrapper.find('.part-ref__image').attributes('alt')).toBe('ねこ.png')
    // 素材一覧にも並ぶ（配置済みなので未配置は 0 件）
    expect(素材の一覧().text()).toContain('未配置 0 件')
  })
})
