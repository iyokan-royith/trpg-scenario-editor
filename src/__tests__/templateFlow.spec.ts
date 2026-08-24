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
  it('同梱の定義が名前で並ぶ（同梱もユーザー持ち込みも同じ経路・Q6）', async () => {
    const app = await mountApp()
    const names = app.findAll('.tpane__item').map((b) => b.text())
    expect(names).toContain('迷宮マップ')
    // ⚠ 一覧に出るのは定義の**名前**であって id ではない
    expect(names).not.toContain(DUNGEON_MAP_TEMPLATE_ID)
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

  /**
   * ⭐ 台帳 A48 / §1-7-2 の 2026-08-24 決定。
   *
   * ⚠⚠ **この 1 本は、以前は逆のこと（画像も一覧に並ぶ）を確かめていた。**
   *   実測で「一覧から画像を保存すると**画像の付けようがない空パート 1 件**が生まれ、
   *   未配置件数にも入る」と分かり、仕様の側が決着した（衝突していたのは完了条件と §1-7-2）。
   */
  it('⭐ 画像だけは一覧に出さない（素材追加ボタンが画像の唯一の入口・A48）', async () => {
    const app = await mountApp()
    const names = app.findAll('.tpane__item').map((b) => b.text())
    expect(names).not.toContain('画像')

    // ⚠⚠ **除外は UI 層だけ**。定義は今までどおり読み込まれている（下層は画像を知らないまま）
    expect(usePartStore().definitions[IMAGE_TEMPLATE_ID]).toBeTruthy()
    // 唯一の入口は残っている
    expect(app.find('input[type="file"]').exists()).toBe(true)
    expect(app.find('.materials__head').text()).toContain('素材を追加')
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

    // ⚠⚠ **期待値を保存されたデータから作らない**（台帳 A53）。
    //   以前はここで `data.rooms.map(r => r.id)` を期待値にしていたため、
    //   **要素 id を添字にする変異を当てても緑のまま**だった（＝検査になっていない）。
    //   → 仕様（§1-4「配列由来は `<key>:<要素id>`」・`newItemId()` の形・P0 知見 2）から立て直す。
    const roomPartIds = parts.slice(1, 3).map((p) => p.partId)
    roomPartIds.forEach((partId, index) => {
      expect(partId.startsWith('rooms:')).toBe(true)
      const itemId = partId.slice('rooms:'.length)
      // ⭐ 採番された id の形（`form.ts` の `newItemId()` が単一の真実）
      expect(itemId).toMatch(/^item-/)
      // ⭐ 添字ではない。⚠ 上の形の検査だけでは、連番を `item-` 風に見せる実装を通してしまう
      expect(itemId).not.toBe(String(index))
      expect(itemId).not.toBe(String(index + 1))
    })
    // 同じ id が 2 つの部屋に付いていない（付くと 2 件目の配置が 1 件目を指す）
    expect(new Set(roomPartIds).size).toBe(2)
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
