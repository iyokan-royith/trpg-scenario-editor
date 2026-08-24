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

/**
 * ⭐⭐ **2026-08-25 に決定が変わった**（§1-3-3e-2・ロイス確認）。
 *
 * ⚠⚠ **ここは以前「素材の行にやじるしは出さない」を固定していた。**
 *   ツリーに出ている参照は**章として扱われている**（`form === 'section'` しか出ない）ので、
 *   **他の章と同じ操作ができるべき**——というのが本人の指摘で、決定が撤回された。
 *   ⭐ **述語は「やじるしを名指しする」形のまま**（台帳 A68）で、**数だけが 0 → 2 になった**。
 *   ⚠ もし数（`findAll('button')`）のままだったら、この撤回のときに
 *   **「編集ボタンが増えたのか、やじるしが戻ったのか」が読めなかった。**
 */
describe('⭐ 素材の行にも階層の上げ下げが出る（§1-3-3e-2・決定の撤回）', () => {
  it('素材の行にやじるしが 2 つ出る（章として扱っているのだから、章と同じ操作ができる）', () => {
    const wrapper = mountPane()
    expect(rows(wrapper)[1]!.findAll(ARROWS)).toHaveLength(2)
  })

  it('見出しの行にも今までどおり 2 つ出る（片方だけ壊していないことの対照）', () => {
    const wrapper = mountPane()
    expect(rows(wrapper)[0]!.findAll(ARROWS)).toHaveLength(2)
  })

  it('⭐ 上限・下限に達している向きは押せない（素材の行でも見出しと同じ規則）', () => {
    const deep: OutlineItem[] = [
      { kind: 'partRef', level: 1, title: 'いちばん上', pos: 0, children: [] },
      { kind: 'partRef', level: 6, title: 'いちばん下', pos: 5, children: [] },
    ]
    const wrapper = mountPane(deep)
    const disabledOf = (index: number) =>
      rows(wrapper)[index]!.findAll(ARROWS).map((b) => (b.element as HTMLButtonElement).disabled)
    // level 1 は「上げる」が押せない／level 6 は「下げる」が押せない
    expect(disabledOf(0)).toEqual([true, false])
    expect(disabledOf(1)).toEqual([false, true])
  })

  it('⭐⭐ バッジの説明が現状に合っている（上げ下げできると読める）', () => {
    // ⚠⚠ 説明は**決定と一緒に変える**。古い説明（「深さは置いた場所で決まります」）が
    //   残っていると、**画面に出ているやじるしを「使ってはいけない」と読ませる**。
    const title = mountPane().find('.outline__badge').attributes('title') ?? ''
    expect(title).toContain('章として扱われ')
    expect(title).toContain('階層を上げ下げできます')
    expect(title).not.toContain('深さは置いた場所で決まります')
  })
})
