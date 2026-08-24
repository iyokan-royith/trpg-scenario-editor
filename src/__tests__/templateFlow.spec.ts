/**
 * 「テンプレ一覧に出る → 選ぶ → フォーム → 保存 → パートが生まれる」を、**画面の経路で**通す
 * （DESIGN-v0.md §4 の P2 完了条件 #1・#4）。
 *
 * ⚠⚠ 部品ごとの単体テストが緑でも、**App の配線が 1 本抜けていると何も起きない**。
 *   P1 で実際に踏んだ型（左ペインの配線が死んでいても層のテストは緑だった）なので、
 *   ここは必ず一覧のボタンから触り、最後は `store.parts`（＝素材一覧の実体）で確かめる。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../App.vue'
import { usePartStore } from '../store/partStore'
import { clearDocument, clearInstances, loadInstances } from '../store/persistence'
import { DUNGEON_MAP_TEMPLATE_ID } from '../template/render/dungeonMap'
import { IMAGE_TEMPLATE_ID } from '../template/render/image'

let wrapper: VueWrapper | null = null

async function mountApp() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
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

describe('テンプレート一覧（完了条件 #1）', () => {
  it('同梱の 2 件が名前で並ぶ（同梱もユーザー持ち込みも同じ経路・Q6）', async () => {
    const app = await mountApp()
    const names = app.findAll('.tpane__item').map((b) => b.text())
    expect(names).toContain('画像')
    expect(names).toContain('迷宮マップ')
  })

  it('選ぶまでフォームは出ない／選ぶとそのテンプレのフォームが出る', async () => {
    const app = await mountApp()
    expect(app.find('.tform').exists()).toBe(false)

    const dungeon = app.findAll('.tpane__item').find((b) => b.text() === '迷宮マップ')!
    await dungeon.trigger('click')
    expect(app.find('.tform__title').text()).toBe('迷宮マップ')
    // ⚠ 一覧はテンプレの id を知らない（App が突き合わせる）。id は画面に出さない。
    expect(app.find('.tform').text()).not.toContain(DUNGEON_MAP_TEMPLATE_ID)
  })

  it('画像テンプレも同じ一覧に並ぶ（1-7-1: 層は違うが特別扱いはしない）', async () => {
    const app = await mountApp()
    const image = app.findAll('.tpane__item').find((b) => b.text() === '画像')!
    await image.trigger('click')
    // 画像フィールドは未対応（この切れ目の範囲外）。⚠ それでもフォームは開く
    expect(app.find('.tform').exists()).toBe(true)
    expect(app.find('.field__unsupported').text()).toContain('まだ入力できません')
    expect(usePartStore().definitions[IMAGE_TEMPLATE_ID]).toBeTruthy()
  })
})

describe('保存するとインスタンスが増え、パートが生まれる（完了条件 #4）', () => {
  it('⭐ 部屋を 2 件入れて保存すると 1＋2＋1 = 4 パート（derivePartsOf を通っている）', async () => {
    const app = await mountApp()
    const store = usePartStore()
    const before = store.parts.length

    await app.findAll('.tpane__item').find((b) => b.text() === '迷宮マップ')!.trigger('click')

    // overview.name（独立章のタイトルになる）
    await app.find('.field--object .field--string input').setValue('ためしの迷宮')
    // rooms は 4 つ目の配列。⚠ 位置で取らずラベルで探す（欄が増えても壊れない）
    const roomsAdd = app
      .findAll('.field--array')
      .find((f) => f.find('legend').text().startsWith('部屋'))!
      .find('.field__add')
    await roomsAdd.trigger('click')
    await roomsAdd.trigger('click')

    await app.find('form.tform').trigger('submit')
    await flushPromises()

    // インスタンスが 1 件増えた
    const instances = Object.values(store.instances)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.templateId).toBe(DUNGEON_MAP_TEMPLATE_ID)
    expect((instances[0]!.data.rooms as unknown[])).toHaveLength(2)

    // ⚠⚠ パートは保存されない。データが増えた結果として**導出で**生まれる（P0 知見 1）。
    const parts = store.partsOfInstance(instances[0]!.id)
    expect(store.parts.length - before).toBe(4)
    expect(parts.map((p) => p.form)).toEqual(['section', 'section', 'section', 'figure'])
    expect(parts[0]!.title).toBe('ためしの迷宮')
    // 部屋由来の partId は `rooms:<要素id>`（添字ではない・P0 知見 2）
    const roomIds = (instances[0]!.data.rooms as { id: string }[]).map((r) => r.id)
    expect(parts.slice(1, 3).map((p) => p.partId)).toEqual(roomIds.map((id) => `rooms:${id}`))
  })

  it('保存したものはリロードしても残る（IndexedDB へ書かれている）', async () => {
    const app = await mountApp()
    await app.findAll('.tpane__item').find((b) => b.text() === '迷宮マップ')!.trigger('click')
    await app.find('.field--object .field--string input').setValue('のこる迷宮')
    await app.find('form.tform').trigger('submit')
    await flushPromises()

    const saved = await loadInstances()
    expect(saved).toHaveLength(1)
    expect((saved[0]!.data.overview as { name: string }).name).toBe('のこる迷宮')
  })

  it('保存するとフォームが閉じ、生まれた件数を知らせる', async () => {
    const app = await mountApp()
    await app.findAll('.tpane__item').find((b) => b.text() === '迷宮マップ')!.trigger('click')
    await app.find('form.tform').trigger('submit')
    await flushPromises()

    expect(app.find('.tform').exists()).toBe(false)
    // ⚠ 知らせは IndexedDB への書き込みが済んでから出る（マイクロタスクだけでは届かない）。
    await vi.waitFor(() => expect(app.find('.app__notice').exists()).toBe(true))
    // 部屋 0 件なので 1（全体）＋ 0 ＋ 1（図）＝ 2
    expect(app.find('.app__notice').text()).toContain('2 件')
  })
})
