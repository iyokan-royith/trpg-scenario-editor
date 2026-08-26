/**
 * ⭐⭐ **「md で書き出す」ボタンから、配置階層どおりの見出しが出るところまで**
 *   （DESIGN-v0.md §1-13-1h・移行 P-d2 ／ 台帳 **A105** の閉じる条件）。
 *
 * ⚠⚠ **層のテストが緑でも、App の配線が 1 本抜けていると何も起きない**——
 *   ここでは `docToMd(doc, { parts })` の `parts` がまさにその 1 本である。
 *   渡し忘れると**例外も出さずにコメントが出る**（＝パートの中身が 1 文字も書き出されない）。
 *   → **画面のボタンから触り、テキストエリアの中身で確かめる。**
 *
 * ⚠ 検証データは同梱テンプレ（迷宮マップ）を画面から作ったもの。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { Editor } from '@tiptap/vue-3'
import App from '../App.vue'
import { usePartStore } from '../store/partStore'
import { clearDocument, clearInstances, loadInstances } from '../store/persistence'

let wrapper: VueWrapper | null = null

function editorOf(): Editor {
  const editor = (wrapper!.vm as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

async function mountApp() {
  wrapper = mount(App, { attachTo: document.body })
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((wrapper.vm as unknown as { editor: Editor | null }).editor) return wrapper
  }
  throw new Error('エディタが立ち上がりませんでした')
}

/** 部屋 1 件の迷宮マップを画面から作る。⚠ 保存が IndexedDB へ着地するまで待つ。 */
async function createDungeonWithOneRoom(name: string) {
  const app = wrapper!
  await app
    .findAll('.tpane__item')
    .find((b) => b.text() === '迷宮マップ')!
    .trigger('click')
  await app.find('.field--object .field--string input').setValue(name)
  const rooms = app
    .findAll('.field--array')
    .find((f) => f.find('legend').text().startsWith('部屋'))!
  await rooms.find('.field__add').trigger('click')
  // 部屋の名前（見出しに出る）
  await rooms.findAll('.field--string input')[0]!.setValue('とびら')
  await app.find('form.tform').trigger('submit')
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((await loadInstances()).length > 0) return
  }
  throw new Error('保存が届きませんでした')
}

/** 本文へ「# しょう」を書いてから、部屋シートのパートを挿す。 */
async function placeRoomSheetUnderHeading() {
  const app = wrapper!
  const row = app.findAll('.materials__item').find((r) => r.text().includes('部屋シート'))
  if (!row) throw new Error('部屋シートのパートが素材一覧に出ていません')
  await row
    .findAll('button')
    .find((b) => b.text().startsWith('本文へ挿入'))!
    .trigger('click')
  await flushPromises()
}

async function exportedMd(): Promise<string> {
  await wrapper!
    .findAll('button')
    .find((b) => b.text() === 'md で書き出す')!
    .trigger('click')
  await flushPromises()
  const textarea = wrapper!.find('.app__md textarea')
  if (!textarea.exists()) {
    throw new Error(`md が開いていません: ${wrapper!.find('.app__notice').text()}`)
  }
  return (textarea.element as HTMLTextAreaElement).value
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

describe('md 書き出しの配線（A105）', () => {
  it('⭐⭐ ボタンから書き出すと、パートの中身が展開されて出る（コメントではない）', async () => {
    await mountApp()
    await createDungeonWithOneRoom('ためしの迷宮')
    await placeRoomSheetUnderHeading()

    const md = await exportedMd()
    // ⚠ ここが `parts` を渡し忘れたときに壊れる唯一の場所
    expect(md).not.toContain('<!-- partRef')
    // 同梱テンプレのたたき台が出した見出し（部屋の名前が入っている）
    expect(md).toMatch(/^#+ .*とびら/m)
  })

  it('⭐ 本文の見出しの下に置くと、その 1 つ下の深さで出る（§1-13-1d 決定1b）', async () => {
    await mountApp()
    await createDungeonWithOneRoom('ためしの迷宮')

    // ⚠ 本文に見出しを書いてから挿す（記号は本物のテキスト・CONCEPT Q2）
    const editor = editorOf()
    editor.commands.setContent('<p>## だいにかいそう</p>')
    await flushPromises()
    await placeRoomSheetUnderHeading()
    expect(usePartStore().parts.length).toBeGreaterThan(0)

    const md = await exportedMd()
    // 囲む見出しが `##` なので基準は 3（depthUnder(2)）
    expect(md.match(/^#+ .*とびら.*$/m)![0]).toMatch(/^### /)
  })
})
