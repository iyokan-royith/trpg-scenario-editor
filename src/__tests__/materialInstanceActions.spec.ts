/**
 * 素材一覧の**インスタンス単位の操作**（「消す」「差し替え」）を、
 * **1 インスタンスから複数パートが生まれる素材**で確かめる（DESIGN-v0.md 1-7-4 / S7-2 / S7-3）。
 *
 * ⚠⚠ **ここが今まで空白だった理由**を書いておく。
 *   素材一覧に並ぶのが画像だけだった間は「1 インスタンス＝1 パート」が**事実として**成立しており、
 *   「行＝パート」と「消す＝インスタンスごと」の食い違いが**画面から到達できなかった**。
 *   テンプレのフォームが入って初めて複数パートの素材が作れるようになり、
 *   **1 行も変えていない `MaterialPane.vue` / `onRemoveMaterial` が壊れた**
 *   （＝壊れたのは到達可能性のほうで、`git diff` には映らない）。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import App from '../App.vue'
import { usePartStore } from '../store/partStore'
import { clearDocument, clearInstances, loadInstances } from '../store/persistence'
import { IMAGE_KEY } from '../template/render/image'

let wrapper: VueWrapper | null = null

async function mountApp() {
  wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function rows() {
  return wrapper!.findAll('.materials__item')
}

/** その行に出ているボタンの文字（並びではなく**文字**で見る＝行ごとに違ってよい）。 */
function buttonTextsOf(index: number): string[] {
  return rows()
    [index]!.findAll('button')
    .map((b) => b.text())
}

function buttonIn(index: number, startsWith: string) {
  return rows()
    [index]!.findAll('button')
    .find((b) => b.text().startsWith(startsWith))
}

/** 迷宮マップを 1 件作る（部屋 2 件 → 1＋2＋1 = 4 パート）。 */
async function createDungeonWithTwoRooms(name: string) {
  const app = wrapper!
  await app
    .findAll('.tpane__item')
    .find((b) => b.text() === '迷宮マップ')!
    .trigger('click')
  await app.find('.field--object .field--string input').setValue(name)
  const roomsAdd = app
    .findAll('.field--array')
    .find((f) => f.find('legend').text().startsWith('部屋'))!
    .find('.field__add')
  await roomsAdd.trigger('click')
  await roomsAdd.trigger('click')
  await app.find('form.tform').trigger('submit')
  // ⚠⚠ IndexedDB への書き込みが**落ち着くまで**待つ。待たないと 2 つ壊れる:
  //   ①「素材を作りました」の知らせが後から届いて、消したときの知らせを上書きする
  //   ② 次のテストが `clearInstances()` した**後**に書き込みが着地し、
  //      次の起動でそれが読み戻される（＝前のテストの素材が混ざる）
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if ((await loadInstances()).length > 0) return
  }
  throw new Error('保存が届きませんでした')
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

describe('複数パートの素材で「消す」が嘘をつかない（S7-2）', () => {
  it('⭐ 「消す」は行ごとではなく**素材に 1 つ**出て、消える件数を押す前に言う', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    expect(rows()).toHaveLength(4)

    // 先頭の行だけがインスタンス単位の操作を持つ。⚠ 4 つ並ぶと「押した 1 件が消える」に見える
    const withRemove = [0, 1, 2, 3].filter((i) => buttonTextsOf(i).some((t) => t.includes('消す')))
    expect(withRemove).toEqual([0])
    // 押す前に「4 件まとめて消える」と分かる（消した後では手遅れ）
    expect(buttonIn(0, '素材ごと消す')!.text()).toContain('4 件')
  })

  it('⭐ 消したら、消えた実態（パート 4 件）と本文に残った参照の総数を知らせる', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    const store = usePartStore()

    // 部屋のパート 1 件と、図のパート 1 件を本文へ置く（＝異なるパートが 2 箇所）
    await buttonIn(1, '本文へ挿入')!.trigger('click')
    await buttonIn(3, '本文へ挿入')!.trigger('click')
    await flushPromises()

    await buttonIn(0, '素材ごと消す')!.trigger('click')
    await flushPromises()

    // インスタンスごと消える（これは仕様どおり）
    expect(store.parts).toHaveLength(0)
    expect(await loadInstances()).toEqual([])

    const notice = wrapper!.find('.app__notice').text()
    expect(notice).toContain('ためしの迷宮')
    // ⚠ 押した 1 件の名前しか言わないのが元の欠陥。消えた件数を言う
    expect(notice).toContain('4 件')
    // ⚠ 数え漏らしも元の欠陥（押した行のパートしか数えていなかった）
    expect(notice).toContain('2 箇所')
  })

  /**
   * ⚠⚠ 「素材の 1 行目」に固定すると、**その行が絞り込みで隠れた瞬間に消す手段が消える**。
   *   だから付ける先は「**いま見えている中の 1 行目**」でなければならない。
   *   → この性質は `headKeys` が `visibleParts` を見ているかどうかで決まり、
   *     `props.parts` を見る実装でも**絞り込み無しの検査は全部緑になる**（＝ここでしか捕まらない）。
   */
  it('⭐ 絞り込みで先頭の行が隠れても、消す手段は残る（見えている先頭に付け替わる）', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')

    // 先頭のパートだけを本文へ置く → 「未配置だけ」で先頭の行が消える
    await buttonIn(0, '本文へ挿入')!.trigger('click')
    await flushPromises()
    await wrapper!.find('.materials__filter input').setValue(true)

    expect(rows()).toHaveLength(3)
    expect(buttonTextsOf(0).some((t) => t.includes('消す'))).toBe(true)
    // ⚠ 消えるのは**見えていない先頭も含めた全部**なので、件数は 3 ではなく 4
    expect(buttonIn(0, '素材ごと消す')!.text()).toContain('4 件')
    // ⚠ 増殖もしていない（見えている行すべてに付いたら元の欠陥に戻る）
    expect([0, 1, 2].filter((i) => buttonTextsOf(i).some((t) => t.includes('消す')))).toEqual([0])
  })
})

describe('「差し替え」は画像を持つ素材にしか出ない（S7-3）', () => {
  it('⭐ 画像フィールドを持たない素材の行には出ない（出ると画像でないものに実体を書き込む）', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')

    for (const i of [0, 1, 2, 3]) {
      expect(buttonTextsOf(i).some((t) => t.includes('差し替え'))).toBe(false)
    }
  })

  it('⭐ 万一呼ばれても、画像フィールドが無い素材には書き込まない（下層の歯止め）', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    const store = usePartStore()
    const instance = Object.values(store.instances)[0]!

    expect(store.replaceImage(instance.id, new Blob([new Uint8Array([1])]))).toBeUndefined()
    expect(instance.images[IMAGE_KEY]).toBeUndefined()
    expect(Object.keys(instance.images)).toEqual([])
  })
})
