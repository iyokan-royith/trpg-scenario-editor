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
