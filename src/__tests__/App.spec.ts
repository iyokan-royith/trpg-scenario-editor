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
import { clearDocument, loadDocument, saveDocument } from '../store/persistence'

async function 起動() {
  const wrapper = mount(App, { global: { plugins: [createPinia()] } })
  // ⚠ 起動時の読み出しは IndexedDB のイベント経由なので、microtask 1 周では終わらない。
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((wrapper.vm as unknown as { editor: Editor | null }).editor) break
  }
  await nextTick()
  return wrapper
}

function 本体(wrapper: Awaited<ReturnType<typeof 起動>>): Editor {
  const editor = (wrapper.vm as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

beforeEach(async () => {
  await clearDocument()
})

describe('App', () => {
  it('起動すると本文と左ペインが出る', async () => {
    const wrapper = await 起動()
    expect(wrapper.text()).toContain('シナリオエディタ')
    expect(wrapper.find('.outline').exists()).toBe(true)
    wrapper.unmount()
  })

  it('見出しが無ければ左ペインは空表示', async () => {
    const wrapper = await 起動()
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
          content: [{ type: 'text', text: 'ほぞんした見出し' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'ほぞんした本文' }] },
      ],
    })
    const wrapper = await 起動()
    expect(本体(wrapper).state.doc.textContent).toContain('ほぞんした本文')
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain('ほぞんした見出し')
    wrapper.unmount()
  })

  it('⭐ 本文を編集すると左ペインが追従する（アプリ側の配線ごと）', async () => {
    const wrapper = await 起動()
    const editor = 本体(wrapper)
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'あとから足した章' }],
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
    const wrapper = await 起動()
    const editor = 本体(wrapper)
    const 選択前 = editor.state.selection.from

    const 見出し = editor.state.schema.node(
      'heading',
      { level: 1 },
      editor.state.schema.text('カーソルから離れた所に足した章'),
    )
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, 見出し))
    await nextTick()

    // 選択は動いていない＝onSelectionUpdate は発火していない
    expect(editor.state.selection.from).toBe(選択前)
    expect(wrapper.findComponent({ name: 'OutlinePane' }).text()).toContain(
      'カーソルから離れた所に足した章',
    )
    wrapper.unmount()
  })

  it('⭐ 画面を閉じるとき、保留中の変更が捨てられずに保存される', async () => {
    const wrapper = await 起動()
    本体(wrapper).commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'とじるまえに書いた行' }] }],
    })
    // ⚠ 自動保存の待ち時間（既定 500ms）より前に閉じる＝いちばん失われやすい瞬間
    wrapper.unmount()

    for (let i = 0; i < 50; i += 1) {
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const 保存 = await loadDocument()
      if (JSON.stringify(保存?.doc ?? '').includes('とじるまえに書いた行')) return
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
  async function 二章立てで起動() {
    await saveDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'あかしょう' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'あかの本文' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'あおしょう' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'あおの本文' }] },
      ],
    })
    return 起動()
  }

  function 章の並び(wrapper: Awaited<ReturnType<typeof 起動>>): string[] {
    const out: string[] = []
    本体(wrapper).state.doc.forEach((node) => {
      if (node.type.name === 'heading') out.push(node.textContent)
    })
    return out
  }

  it('⭐ すぐ下の項目へドラッグすると「1 つ下へ」動く（最も自然なジェスチャ）', async () => {
    const wrapper = await 二章立てで起動()
    expect(章の並び(wrapper)).toEqual(['あかしょう', 'あおしょう'])

    const items = wrapper.findAll('.outline__item')
    expect(items).toHaveLength(2)
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('drop')
    await nextTick()

    expect(章の並び(wrapper)).toEqual(['あおしょう', 'あかしょう'])
    // ⚠ 「そこへは移せません」が出ていないこと（欠陥のときはこれが出ていた）
    expect(wrapper.text()).not.toContain('そこへは移せません')
    wrapper.unmount()
  })

  it('すぐ上の項目へドラッグすると「1 つ上へ」動く', async () => {
    const wrapper = await 二章立てで起動()
    const items = wrapper.findAll('.outline__item')
    await items[1]!.trigger('dragstart')
    await items[0]!.trigger('drop')
    await nextTick()

    expect(章の並び(wrapper)).toEqual(['あおしょう', 'あかしょう'])
    wrapper.unmount()
  })

  it('階層ボタンで見出しのレベルが変わり、ツリーの親子関係も変わる', async () => {
    const wrapper = await 二章立てで起動()
    const 下げる = wrapper.findAll('.outline__item')[1]!.findAll('button')[1]!
    await 下げる.trigger('click')
    await nextTick()

    const doc = 本体(wrapper).state.doc
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
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'おやしょう' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'このせつ' }] },
      ],
    })
    const wrapper = await 起動()
    const items = wrapper.findAll('.outline__item')
    await items[0]!.trigger('dragstart')
    await items[1]!.trigger('drop')
    await nextTick()

    expect(wrapper.text()).toContain('そこへは移せません')
    expect(章の並び(wrapper)).toEqual(['おやしょう', 'このせつ'])
    wrapper.unmount()
  })
})
