/**
 * P1-3: 左ペインからの並べ替え・階層変更で、本文の順序が実際に変わる。
 *
 * ⚠ ここで検証しているのは **ドキュメントへの操作**だけ。
 *   左ペインの操作（dragstart/drop・階層ボタン）から App のハンドラを経てここへ届くまでの
 *   配線は `src/__tests__/App.spec.ts` が jsdom の DOM イベントで通している。
 *   両方を合わせても、なお通っていないのは次の層だけ:
 *   要検証[実ブラウザで、HTML5 のドラッグ&ドロップ（実際のマウス操作・dataTransfer 込み）で
 *          左ペインの項目を並べ替えられることを目視確認する。
 *          jsdom の dragstart/drop は dataTransfer を持たない合成イベントなので、
 *          ブラウザ既定のドラッグ挙動（drag image・dropEffect）までは再現していない]
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import {
  dropTargetPos,
  moveSection,
  sectionRangeAt,
  setSectionLevel,
  setPartRefDepth,
  canChangeLevel,
  topLevelBoundaries,
} from '../sections'
import { derivedDepthAt, flattenOutline, outline } from '../outline'
import { PART_REF_NODE } from '../partRefExtension'
import { headingTitle, headingMark } from '../heading'

/** ⚠ 記号は本物のテキスト（CONCEPT Q2 改訂・2026-08-23）。 */
function heading(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: headingMark(level) + text }],
  }
}
function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

let editor: Editor

/** doc 直下のブロックの開始位置（並び順） */
function boundaries(): number[] {
  return topLevelBoundaries(editor.state.doc)
}

/** ⚠ 見出しには記号が入っているので、並びの照合では剥がす（ツリーと同じ見え方にする）。 */
function bodyTitles(): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => out.push(headingTitle(node.textContent)))
  return out
}

beforeEach(() => {
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        heading(1, 'あかしょう'),
        paragraph('あかの本文'),
        heading(2, 'あかのせつ'),
        paragraph('あかのせつの本文'),
        heading(1, 'あおしょう'),
        paragraph('あおの本文'),
      ],
    },
  })
})

describe('節の範囲', () => {
  it('見出しの範囲は、次の同レベル以上の見出しの手前まで（配下を全部含む）', () => {
    const range = sectionRangeAt(editor.state.doc, 0)!
    expect(range.level).toBe(1)
    // 「あかしょう」節は 4 ブロック（見出し・本文・小見出し・本文）
    expect(range.from).toBe(boundaries()[0])
    expect(range.to).toBe(boundaries()[4])
  })

  it('見出しでないブロックはそのブロック 1 個だけ', () => {
    const paragraphPos = boundaries()[1]!
    const range = sectionRangeAt(editor.state.doc, paragraphPos)!
    expect(range.level).toBeNull()
    expect(range.to).toBe(boundaries()[2])
  })
})

describe('P1-3a: 並べ替え', () => {
  it('あとの節を先頭へ移すと、本文の順序が実際に変わる', () => {
    const blue = boundaries()[4]!
    const tr = moveSection(editor.state, blue, 0)!
    editor.view.dispatch(tr)

    expect(bodyTitles()).toEqual([
      'あおしょう',
      'あおの本文',
      'あかしょう',
      'あかの本文',
      'あかのせつ',
      'あかのせつの本文',
    ])
  })

  it('節を動かすとツリーも追従する（ツリーは別データを持たない）', () => {
    editor.view.dispatch(moveSection(editor.state, boundaries()[4]!, 0)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('見出しを動かすと配下も一緒に動く', () => {
    editor.view.dispatch(moveSection(editor.state, 0, editor.state.doc.content.size)!)
    const tree = outline(editor.state.doc)
    expect(tree.map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
    expect(tree[1]!.children.map((i) => i.title)).toEqual(['あかのせつ'])
  })

  it('自分自身の内側へは移せない（移せたら節が消える）', () => {
    const insidePos = boundaries()[2]!
    expect(moveSection(editor.state, 0, insidePos)).toBeNull()
  })

  it('ブロック境界でない位置は受け付けない', () => {
    expect(moveSection(editor.state, 0, 1)).toBeNull()
  })
})

describe('P1-3a: 落とした先 → 挿入位置の翻訳（dropTargetPos）', () => {
  it('⭐ すぐ下の兄弟へ落とすと「1 つ下へ動く」（相手のうしろ）', () => {
    // ⚠ ここが「相手の前に挿す」意味だと、動かない位置を指してしまい
    //   リスト UI でいちばん自然な「1 つ下へ」が死ぬ。
    const red = boundaries()[0]!
    const blue = boundaries()[4]!
    const dest = dropTargetPos(editor.state.doc, red, blue)!
    expect(dest).toBe(editor.state.doc.content.size)

    editor.view.dispatch(moveSection(editor.state, red, dest)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('すぐ上の兄弟へ落とすと「1 つ上へ動く」（相手のまえ）', () => {
    const blue = boundaries()[4]!
    const red = boundaries()[0]!
    const dest = dropTargetPos(editor.state.doc, blue, red)!
    expect(dest).toBe(0)

    editor.view.dispatch(moveSection(editor.state, blue, dest)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('自分自身・自分の配下へは落とせない', () => {
    expect(dropTargetPos(editor.state.doc, 0, 0)).toBeNull()
    expect(dropTargetPos(editor.state.doc, 0, boundaries()[2]!)).toBeNull()
  })
})

describe('P1-3b: 階層変更', () => {
  it('見出しのレベルを下げると、配下の見出しも同じだけ下がる', () => {
    editor.view.dispatch(setSectionLevel(editor.state, 0, 2)!)
    const flat = flattenOutline(outline(editor.state.doc))
    expect(flat.map((i) => [i.title, i.level])).toEqual([
      ['あかしょう', 2],
      ['あかのせつ', 3],
      ['あおしょう', 1],
    ])
  })

  it('階層を上げると、ツリーの親子関係が変わる', () => {
    // 「あかのせつ」(level 2) を level 1 にすると、あかしょうの子ではなくなる
    editor.view.dispatch(setSectionLevel(editor.state, boundaries()[2]!, 1)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual([
      'あかしょう',
      'あかのせつ',
      'あおしょう',
    ])
  })

  it('範囲外のレベルは受け付けない', () => {
    expect(setSectionLevel(editor.state, 0, 0)).toBeNull()
    expect(setSectionLevel(editor.state, 0, 7)).toBeNull()
  })

  it('見出しでないブロックには効かない（深さは位置で決まるので移動で表す）', () => {
    expect(setSectionLevel(editor.state, boundaries()[1]!, 2)).toBeNull()
  })
})

/**
 * ⭐⭐ パート参照の深さ（`setPartRefDepth`・§1-3-3e-2）。
 *
 * ⚠⚠ **見出しと「同じ操作」に見えて、書き換える先が違う**——
 *   見出しは**本文の記号**、参照は**ノードの属性**。
 *   ⚠ 取り違えると「押せるのに何も起きない」（記号が無いので書き換え対象が 0 件）。
 */
describe('パート参照の階層（§1-3-3e-2）', () => {
  function refDoc() {
    return new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'しょう'),
          { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: 'p1' } },
        ],
      },
    })
  }

  /** 参照ノードの位置（doc 直下の 2 つ目）。 */
  function refPos(ed: Editor): number {
    return topLevelBoundaries(ed.state.doc)[1]!
  }

  it('⭐ 深さを書き換えると、ノードの属性に入る（本文の文字は変わらない）', () => {
    const ed = refDoc()
    const before = ed.state.doc.textContent
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 4)!)
    expect(ed.state.doc.nodeAt(refPos(ed))!.attrs.depth).toBe(4)
    // ⚠ 本文（見出し記号）には触っていない
    expect(ed.state.doc.textContent).toBe(before)
  })

  it('⭐⭐ 見出し用の関数を参照に当てても何も起きない（取り違えの検出）', () => {
    const ed = refDoc()
    // ⚠⚠ 記号が無いので書き換え対象が 0 件＝`null`。**押せるのに何も起きない**の正体。
    expect(setSectionLevel(ed.state, refPos(ed), 3)).toBeNull()
  })

  it('⭐ 参照用の関数を見出しに当てても何も起きない（逆向きの取り違え）', () => {
    const ed = refDoc()
    expect(setPartRefDepth(ed.state, 0, 3)).toBeNull()
  })

  it('上限・下限の外は断る（見出しと同じ規則）', () => {
    const ed = refDoc()
    expect(canChangeLevel(ed.state.doc, refPos(ed), 0).ok).toBe(false)
    expect(canChangeLevel(ed.state.doc, refPos(ed), 7).ok).toBe(false)
    expect(setPartRefDepth(ed.state, refPos(ed), 0)).toBeNull()
    // 範囲内は通る（弾きすぎていないことの陽性対照）
    expect(canChangeLevel(ed.state.doc, refPos(ed), 6).ok).toBe(true)
  })

  it('⚠ 参照は配下を持たないので `descendantsOutOfRange` にならない（見出しとの違い）', () => {
    const ed = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: 'p1' } },
          // ⚠ 参照の「あと」に深い見出しが在っても、それは参照の配下ではない
          heading(6, 'ふかいせつ'),
        ],
      },
    })
    expect(canChangeLevel(ed.state.doc, 0, 6)).toEqual({ ok: true })
  })
})

/**
 * ⭐⭐ 明示的な深さの**正規化**（台帳 A71・§1-3-3e-2 の補正）。
 *
 * ⚠⚠ **画面では区別が付かない**——導出の深さ 2 と明示の深さ 2 はまったく同じに見える。
 *   だからここは**属性を直接見る**。見た目で確かめると、
 *   **「明示のまま戻った」も「導出へ戻った」も同じ緑になる**（＝検査になっていない）。
 */
describe('明示的な深さの正規化（A71）', () => {
  /** 見出し 1 つ（level 1）の下に参照を置いた doc。⚠ 導出の深さは 2。 */
  function docUnderHeading() {
    return new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'しょう'),
          { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: 'p1' } },
        ],
      },
    })
  }

  function refPos(ed: Editor): number {
    return topLevelBoundaries(ed.state.doc)[1]!
  }
  function depthOf(ed: Editor): unknown {
    return ed.state.doc.nodeAt(refPos(ed))!.attrs.depth
  }

  it('⭐ 導出と同じ深さへ戻すと、明示（属性）が消えて `null` になる', () => {
    const ed = docUnderHeading()
    expect(depthOf(ed)).toBeNull() // 最初は導出
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 3)!) // 下げる → 明示
    expect(depthOf(ed)).toBe(3)
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 2)!) // 上げて元の深さへ
    // ⚠⚠ ここが `2` のままだと、**画面は同じなのに導出へ戻っていない**（見えない状態が残る）
    expect(depthOf(ed)).toBeNull()
  })

  it('⭐⭐ 戻したあとに囲む見出しを変えると追随する（＝本当に導出へ戻っている）', () => {
    const ed = docUnderHeading()
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 3)!)
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 2)!)

    // 囲む見出しを level 1 → 2 にすると、導出の深さは 3 になるはず
    ed.view.dispatch(setSectionLevel(ed.state, 0, 2)!)
    const ref = flattenOutline(outline(ed.state.doc, [])).find((i) => i.kind === 'partRef')
    // ⚠ パートが無いので outline には出ない。深さの導出だけを直接見る。
    expect(ref).toBeUndefined()
    expect(derivedDepthAt(ed.state.doc, refPos(ed))).toBe(3)
    expect(depthOf(ed)).toBeNull()
  })

  it('⭐ 導出と違う深さは残る（明示を捨てているわけではない）', () => {
    const ed = docUnderHeading()
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 5)!)
    expect(depthOf(ed)).toBe(5)
    // もう一度別の値にしても、導出（2）でなければ残る
    ed.view.dispatch(setPartRefDepth(ed.state, refPos(ed), 4)!)
    expect(depthOf(ed)).toBe(4)
  })

  /**
   * ⚠⚠ **参照の「あと」に見出しがある形**を必ず1本置く（変異で実測した穴）。
   *   `derivedDepthAt()` が位置を見ずに**doc 全体の最後の見出し**を拾う実装でも、
   *   参照が末尾にある doc では**まったく同じ答えになる**——
   *   ⚠ 上の3本は全部その形だったので、**位置を無視する変異が素通りしていた**。
   *   ⭐ `outline()` 側は祖先スタックなので構造的に位置を見るが、
   *   **正規化の判定は別の実装**（「囲む見出しを探す」を2箇所に分けてしまった）。
   */
  it('⭐⭐ 参照のあとに見出しがあっても、囲むのは「前の見出し」', () => {
    const ed = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'まえのしょう'),
          { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: 'p1' } },
          heading(3, 'あとのせつ'),
        ],
      },
    })
    const pos = topLevelBoundaries(ed.state.doc)[1]!
    // ⚠ 後ろの見出し（level 3）を拾うと 4 になる。前の見出し（level 1）の 1 つ下＝2 が正しい。
    expect(derivedDepthAt(ed.state.doc, pos)).toBe(2)

    // 正規化もその値で行われる（2 へ戻したら明示が消える）
    ed.view.dispatch(setPartRefDepth(ed.state, pos, 5)!)
    ed.view.dispatch(setPartRefDepth(ed.state, pos, 2)!)
    expect(ed.state.doc.nodeAt(pos)!.attrs.depth).toBeNull()
  })

  it('最初から導出と同じ深さを指定しても、明示にはならない', () => {
    const ed = docUnderHeading()
    // ⚠ 「1 度でも押したら永久に明示」を作らない（A71 の症状そのもの）
    expect(setPartRefDepth(ed.state, refPos(ed), 2)).toBeNull()
    expect(depthOf(ed)).toBeNull()
  })
})
