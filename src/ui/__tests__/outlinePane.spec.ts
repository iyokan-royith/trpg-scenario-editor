/**
 * 左ペインの行の見分け（DESIGN-v0.md §1-3-3e 要望A・2026-08-24 実機フィードバック）。
 *
 * ⚠⚠ **ここで見るのは「章として扱っていることが見て分かるか」**であって、
 *   ツリーに何が出るかではない（それは `document/__tests__/outline.spec.ts`）。
 *
 * ⭐ **前提（実物で確認済み）**: `outline.ts` の `placeRef` は
 *   `part.form !== 'section'` なら即 `return` する。
 *   → **このツリーに出ている `partRef` は例外なく「章として扱うパート」**であり、
 *   ブロック／インラインの素材は**そもそも現れない**。
 *   ⚠ だから**色を2種類作る余地は無い**（本人の案は2色だったが、片方は出番が無い）。
 *
 * ⚠ **色そのものは述語にしない**（jsdom で計算後の背景色を見ても、
 *   scoped CSS が当たっているかまでは確かめられない）。
 *   **見分けの手段を3つ**——**文言・クラス・`data-kind`**——に分けて、それぞれを固定する。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OutlinePane from '../OutlinePane.vue'
import type { OutlineItem } from '../../document/outline'

/** 見出し1つと、その下に置いた素材1つ。⚠ 両方向を1つの木で見る。 */
const ITEMS: OutlineItem[] = [
  {
    kind: 'heading',
    level: 1,
    title: 'まえおき',
    pos: 0,
    children: [{ kind: 'partRef', level: 2, title: 'A1 ほこら', pos: 5, children: [] }],
  },
]

function mountPane(items: OutlineItem[] = ITEMS) {
  return mount(OutlinePane, { props: { items } })
}

/** その行が「章として扱う素材」の印を持っているか（3つの手段のうちクラス）。 */
function rows(wrapper: ReturnType<typeof mountPane>) {
  return wrapper.findAll('.outline__item')
}

describe('章として扱う素材の行には印が出る（§1-3-3e 要望A）', () => {
  it('⭐ 素材の行: 薄い背景のクラス・`data-kind`・バッジ文言 の 3 つで見分けられる', () => {
    const wrapper = mountPane()
    const part = rows(wrapper)[1]!

    // ① クラス（＝薄い背景。本人の案）
    expect(part.classes()).toContain('outline__item--part')
    // ② 属性（色が見えない環境・スタイルが当たらない環境でも残る）
    expect(part.attributes('data-kind')).toBe('partRef')
    // ③ 文言。⚠⚠ **色だけに依存しない**ための本体はこれ
    expect(part.find('.outline__badge').text()).toBe('素材の章')
  })

  it('⭐ 見出しの行には出ない（否定形——印が全部の行に出ていたら見分けになっていない）', () => {
    const wrapper = mountPane()
    const heading = rows(wrapper)[0]!

    expect(heading.classes()).not.toContain('outline__item--part')
    expect(heading.attributes('data-kind')).toBe('heading')
    expect(heading.find('.outline__badge').exists()).toBe(false)
  })

  it('⚠ バッジの文言は「パート」ではない（種別を何も言っていなかった）', () => {
    // ⚠ 旧文言に戻す変異を捕まえる。⭐ 文言は契約（§1-3-1 と同じ扱い）。
    const wrapper = mountPane()
    expect(wrapper.text()).not.toContain('パート')
    expect(wrapper.text()).toContain('素材の章')
  })
})

/** 階層移動のやじるし**そのもの**（§1-6-3 の帰結で、素材の行には出さないもの）。 */
const ARROWS = 'button[title="階層を上げる"], button[title="階層を下げる"]'

describe('⚠ 素材の行に階層移動のやじるしは出さない（§1-6-3 の帰結）', () => {
  /**
   * ⚠⚠ **「ボタンが 0 個」で書かない**（台帳 A68）。
   *   ここが 0 なのは「**やじるしを出さないと決めた**」からであって、
   *   「この行にボタンが在ってはならない」からではない。
   *   ⚠ 要望B（生成済みパートの編集）は**まさにこの行に入口を出す話**なので、
   *   数で書くと **B を入れた瞬間に赤くなり、その赤が「入口が増えた」なのか
   *   「やじるしが戻った」なのか、テスト名からは決められない**。
   *   → **やじるしを名指しする。** B で編集ボタンが増えても、この述語は赤くならない。
   */
  it('素材の行にやじるしが無い（押しても何も起きない／データに無い深さを書くため）', () => {
    const wrapper = mountPane()
    expect(rows(wrapper)[1]!.findAll(ARROWS)).toHaveLength(0)
  })

  it('陽性対照: 見出しの行にはやじるしが 2 つ出る（＝「出ない」が実装漏れではない）', () => {
    const wrapper = mountPane()
    expect(rows(wrapper)[0]!.findAll(ARROWS)).toHaveLength(2)
  })

  it('⭐⭐ 代わりに「深さは置いた場所で決まる」が読める（出せない理由を UI で言う）', () => {
    // ⚠⚠ やじるしが無いことを**利用者が読める形**で説明しているか。
    //   ここが空だと、利用者から見れば「ボタンが出ていない＝壊れている」と区別が付かない。
    const title = mountPane().find('.outline__badge').attributes('title') ?? ''
    expect(title).toContain('章として扱われ')
    expect(title).toContain('深さは置いた場所')
  })
})
