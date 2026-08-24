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
import type { Editor } from '@tiptap/vue-3'
import App from '../App.vue'
import { collectPlacedRefs } from '../document/partRefExtension'
import { usePartStore } from '../store/partStore'
import { clearDocument, clearInstances, loadInstances } from '../store/persistence'
import { IMAGE_KEY } from '../template/render/image'

let wrapper: VueWrapper | null = null

/**
 * ⚠⚠ **エディタが立ち上がるまで待つ。`flushPromises()` 1 周では足りない。**
 *
 *   `App` の `onMounted` は `loadInstances()` → `loadDocument()` と
 *   **IndexedDB のイベント（マクロタスク）を 2 段またいで**からエディタを作る。
 *   待たずに「本文へ挿入」を押すと `onInsertMaterial` が `if (!ed) return` で
 *   **黙って何もせずに終わる**——押した側からは成功と区別が付かず、
 *   ずっと後の「本文に 2 箇所」の assert が落ちて初めて分かる（＝**原因から遠い所に出る**）。
 *
 * ⚠ これが最初の実装で 10 回に 1〜2 回ほど赤くなっていた真因。
 *   ⚠ **時間で待たない**（遅い機械で破れる）。**条件が満たされるまで回す。**
 */
async function mountApp() {
  wrapper = mount(App, { attachTo: document.body })
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (editorOrNull()) return wrapper
  }
  // ⚠ 黙って先へ進まない。立ち上がらなかったこと自体が不具合である。
  throw new Error('エディタが立ち上がりませんでした')
}

function editorOrNull(): Editor | null {
  return (wrapper!.vm as unknown as { editor: Editor | null }).editor
}

function editorOf(): Editor {
  const editor = editorOrNull()
  if (!editor) throw new Error('エディタが立ち上がっていません')
  return editor
}

/**
 * 「本文へ挿入」を押して、**本文に届いたことまで確かめる**。
 * ⚠ 押しただけでは届いたか分からない（上記のとおり黙って何もしない経路がある）。
 *   ここで数えておくと、届かなかったときに**押した場所で**落ちる。
 */
async function insertFromRow(index: number) {
  const before = collectPlacedRefs(editorOf().state.doc).length
  await buttonIn(index, '本文へ挿入')!.trigger('click')
  await flushPromises()
  const after = collectPlacedRefs(editorOf().state.doc).length
  if (after !== before + 1) {
    throw new Error(`挿入が本文へ届いていません（参照 ${before} → ${after}）`)
  }
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

/**
 * ⚠⚠ **保存（IndexedDB への書き込み）が届くまで待つ。**
 *   押した直後の `flushPromises()` では**まだ着地していない**ことがあり、
 *   その書き込みは**次のテストの `clearInstances()` の後に着地して混ざる**
 *   （＝前のテストの素材が、次のテストの起動時に読み戻される）。
 *   ⚠ このファイルは既に同じ罠を1度踏んでいる（先頭の警告を参照）。**状態でなく遷移で待つ。**
 */
async function waitForSaved(check: (list: Awaited<ReturnType<typeof loadInstances>>) => boolean) {
  for (let i = 0; i < 50; i += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (check(await loadInstances())) return
  }
  throw new Error('保存が届きませんでした')
}

/** その素材の「素材単位の操作」が出ている行（＝いま見えている中の 1 行目・§1-3-2 R2）。 */
function rowIndexOfInstanceHead(nth: number): number {
  const heads = rows()
    .map((row, index) => ({ index, hasEdit: row.findAll('button').some((b) => b.text() === '編集') }))
    .filter((r) => r.hasEdit)
  return heads[nth]!.index
}

function buttonIn(index: number, startsWith: string) {
  return rows()
    [index]!.findAll('button')
    .find((b) => b.text().startsWith(startsWith))
}

/** 迷宮マップを 1 件作る（部屋 2 件 → 1＋2＋1 = 4 パート）。 */
async function createDungeonWithTwoRooms(name: string) {
  const app = wrapper!
  // ⚠⚠ **状態（1 件以上ある）ではなく遷移（1 件増えた）で待つ。**
  //   「0 件より多い」で待つと、**2 件目を作るときに即座に返ってしまい**、
  //   書き込みが次のテストの `clearInstances()` の後に着地する（＝前のテストの素材が混ざる）。
  const before = (await loadInstances()).length
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
    if ((await loadInstances()).length > before) return
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
    await insertFromRow(1)
    await insertFromRow(3)

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
    await insertFromRow(0)
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

/**
 * ⭐ 本文に置いた素材が、**左ツリーで「章として扱う」と見て分かる**（§1-3-3e 要望A）。
 *
 * ⚠⚠ **`OutlinePane` の単体テストだけでは足りない**（`ui/__tests__/outlinePane.spec.ts`）。
 *   あちらは `kind: 'partRef'` を**手で渡している**ので、
 *   **実データの導出（`outline.ts`）からバッジまでの間**が抜けても緑のままになる。
 *   ここは「素材を作る → 本文へ置く → 左ツリーに印が出る」を1本に繋ぐ。
 *
 * ⚠ この spec に置いたのは、**エディタの立ち上がりを待つ `mountApp()` と
 *   「挿入が本文へ届いたことまで確かめる」`insertFromRow()`** がここに在るため
 *   （待たない経路で書くと、届いていないのに緑になる・上の警告を参照）。
 */
describe('左ツリーで「章として扱う素材」が見分けられる（§1-3-3e 要望A）', () => {
  it('⭐ 独立章のパートを置くと、左ツリーにその行が出て「素材の章」の印が付く', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    // 行 1 は部屋のパート（`form: 'section'`）＝ツリーに出るもの
    await insertFromRow(1)

    const partRows = wrapper!.findAll('.outline__item[data-kind="partRef"]')
    expect(partRows).toHaveLength(1)
    expect(partRows[0]!.classes()).toContain('outline__item--part')
    expect(partRows[0]!.find('.outline__badge').text()).toBe('素材の章')
  })

  it('⭐ 図のパート（`form: "figure"`）を置いても左ツリーには出ない（ツリーは章だけ）', async () => {
    // ⚠⚠ 本人が見た「ブロックなのか章なのか分からない」の**前提が違う**ことの述語。
    //   ツリーに出るのは `section` だけなので、**出ているものは例外なく章として扱うもの**。
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    await insertFromRow(3) // 行 3 は図のパート

    expect(wrapper!.findAll('.outline__item[data-kind="partRef"]')).toHaveLength(0)
    // ⚠ 陽性対照: 置いた参照は本文には在る（＝「出ない」が挿入失敗ではない）
    expect(collectPlacedRefs(editorOf().state.doc)).toHaveLength(1)
  })
})

/**
 * ⭐⭐ 生成済み素材の編集（DESIGN-v0.md §1-11・要望B）。
 *
 * ⚠⚠ **本命は「直して保存しても、本文に置いた参照が行方不明にならない」**（合格条件 #2）。
 *   これが破れる壊れ方は**例外を出さない**——画面には「行方不明のパート」が並ぶだけで、
 *   保存も成功したように見える。
 */
describe('生成済み素材を編集できる（§1-11・要望B）', () => {
  /** 素材一覧の「編集」を押す。⚠ 位置ではなく**文字**で探す（素材単位の操作は増える）。 */
  async function clickEdit(row = 0) {
    await buttonIn(row, '編集')!.trigger('click')
    await flushPromises()
  }

  it('⭐ 合格条件#1: 開くと保存された値が入った状態でフォームが出る', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    await clickEdit()

    const form = wrapper!.find('form.tform')
    expect(form.exists()).toBe(true)
    // ⚠ タブ名で「編集中」と分かる（新規と同じ名前だと、どちらを保存するのか分からない）
    expect(wrapper!.find('.tabs').text()).toContain('（編集）')
    // 全体.マップ名（`object` の中の `string`）に、保存された値が入っている
    expect((form.find('.field--object .field--string input').element as HTMLInputElement).value).toBe(
      'ためしの迷宮',
    )
    // 部屋が 2 件ぶん復元されている（空のフォームではない）
    const rooms = form
      .findAll('.field--array')
      .find((f) => f.find('legend').text().startsWith('部屋'))!
    expect(rooms.findAll('.field__item')).toHaveLength(2)
    expect(rooms.find('legend').text()).toContain('2 件')
  })

  it('⭐⭐⭐ 合格条件#2: 直して保存しても、本文に置いた参照が行方不明にならない', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    const store = usePartStore()
    // 部屋のパートを 2 つとも本文へ置く
    await insertFromRow(1)
    await insertFromRow(2)
    const placedBefore = collectPlacedRefs(editorOf().state.doc).map((r) => r.partId)
    const instanceIdBefore = Object.values(store.instances)[0]!.id

    await clickEdit()
    // 名前だけ直す（部屋には触らない）
    await wrapper!.find('form.tform .field--object .field--string input').setValue('なおした迷宮')
    await wrapper!.find('form.tform').trigger('submit')
    await waitForSaved((list) => (list[0]?.data.overview as { name?: string })?.name === 'なおした迷宮')

    // ⚠⚠ ここが本命。id が作り直されていたら、置いた参照が全部「行方不明のパート」になる。
    expect(wrapper!.findAll('.part-ref__missing')).toHaveLength(0)
    const partIds = store.parts.map((p) => p.partId)
    for (const placed of placedBefore) expect(partIds).toContain(placed)
    // インスタンスも増えていない（新規で保存し直していない）
    expect(Object.keys(store.instances)).toHaveLength(1)
    expect(Object.values(store.instances)[0]!.id).toBe(instanceIdBefore)
    // 直した値は保存されている（リロード相当）
    const saved = await loadInstances()
    expect((saved[0]!.data.overview as { name: string }).name).toBe('なおした迷宮')
    // ⚠ 知らせは「作った」ではなく「更新した」（新規と編集は見分けが付かないと上書きの事故になる）
    expect(wrapper!.find('.app__notice').text()).toContain('素材を更新しました')
  })

  it('⭐ 合格条件#4: 編集で配列要素を消すと、置かれていた参照はアラートで見える（既存機構）', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ためしの迷宮')
    await insertFromRow(1) // 1 件目の部屋を本文へ
    await insertFromRow(2) // 2 件目の部屋も本文へ

    await clickEdit()
    const rooms = wrapper!
      .findAll('form.tform .field--array')
      .find((f) => f.find('legend').text().startsWith('部屋'))!
    // 1 件目を消してから保存
    await rooms.findAll('.field__itemHead button')[0]!.trigger('click')
    await wrapper!.find('form.tform').trigger('submit')
    await waitForSaved((list) => ((list[0]?.data.rooms as unknown[]) ?? []).length === 1)

    // ⚠ 消した要素の参照だけが行方不明になる（＝これは**正しい**・§1-11-1）。
    expect(wrapper!.findAll('.part-ref__missing')).toHaveLength(1)
    // ⚠⚠ 残した方は無事（＝「消したから全部消えた」ではない）
    expect(usePartStore().parts.filter((p) => p.partId.startsWith('rooms:'))).toHaveLength(1)
  })

  it('⭐⭐ 別の素材を編集で開くと、その素材の値に入れ替わる（前の中身が残らない）', async () => {
    // ⚠⚠ **フォームは開いた時に 1 度だけ初期値を読む**ので、作り直す単位に編集対象が
    //   入っていないと、**同じ定義の別の素材を開いたときに前の中身が残る**
    //   （画面には「ひとつめ」と出たまま、保存すると「ふたつめ」を上書きする＝最悪の形）。
    await mountApp()
    await createDungeonWithTwoRooms('ひとつめ')
    await createDungeonWithTwoRooms('ふたつめ')

    const nameInForm = () =>
      (wrapper!.find('form.tform .field--object .field--string input').element as HTMLInputElement)
        .value

    await clickEdit(rowIndexOfInstanceHead(0))
    const first = nameInForm()
    await clickEdit(rowIndexOfInstanceHead(1))
    const second = nameInForm()

    expect(new Set([first, second])).toEqual(new Set(['ひとつめ', 'ふたつめ']))
    expect(first).not.toBe(second)
  })

  it('⭐ 合格条件#5: 編集中に別の素材を開こうとすると確認が出る（§1-9-3a の 4 経路目）', async () => {
    await mountApp()
    await createDungeonWithTwoRooms('ひとつめ')
    await createDungeonWithTwoRooms('ふたつめ')

    await clickEdit(0)
    // ⚠ 開いただけでは「打ちかけ」ではない（確認は出ない）
    await buttonIn(rowIndexOfInstanceHead(1), '編集')!.trigger('click')
    await flushPromises()
    expect(wrapper!.find('.app__confirm').exists()).toBe(false)

    // 何か打ってから、もう一度別の素材を開く
    await wrapper!.find('form.tform .field--object .field--string input').setValue('うちかけ')
    await buttonIn(0, '編集')!.trigger('click')
    await flushPromises()
    const confirm = wrapper!.find('.app__confirm')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('別の素材を編集')
  })
})
