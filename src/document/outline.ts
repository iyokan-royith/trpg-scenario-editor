import type { Node as PMNode } from '@tiptap/pm/model'
import { PART_REF_INLINE_NODE, PART_REF_NODE } from './partRefExtension'
import { partKeyOf, type Part } from '../template/model'
import { headingTitle, headingLevel, MAX_LEVEL } from './heading'

/** 左ペインに出る 1 項目。⚠ これは **導出値** であり、保存しない（DESIGN 1-2）。 */
export interface OutlineItem {
  /** 見出しそのものか、独立章を生むパートへの参照か */
  kind: 'heading' | 'partRef'
  /** ツリー上の深さ（1 が最上位）。⚠ 見出しは heading の level、パート参照は「置かれた場所」で決まる */
  level: number
  title: string
  /** ドキュメント内の位置。UI からの移動操作はこれを起点にする */
  pos: number
  children: OutlineItem[]
}

/**
 * ⭐ 「囲っている見出しの 1 つ下」— **深さの導出規則の単一の真実**（DESIGN 1-6-3）。
 * ⚠ ここと `derivedDepthAt()` の2箇所で別々に書かない（片方だけ直すと、
 *   **画面の深さと、正規化の判定が食い違う**＝明示のつもりが導出として捨てられる）。
 */
function depthUnder(enclosingLevel: number | null): number {
  return Math.min((enclosingLevel ?? 0) + 1, MAX_LEVEL)
}

/**
 * ⭐⭐ その位置に置かれた参照が、**明示指定が無ければ**どの深さになるか（§1-3-3e-2 の正規化）。
 *
 * ⚠⚠ **これは「今どう見えているか」ではなく「明示を外したらどう見えるか」**である。
 *   `setPartRefDepth()` が「導出と同じ値なら `null` を書く」判定に使う——
 *   **導出と同じ数の"明示"を残すと、画面上は同じなのに囲む見出しを変えたときだけ
 *   片方が追随しない**、という**見えない状態**が生まれる（台帳 A71）。
 *
 * ⚠ 囲っている見出し＝**その位置より前にある最後の見出し**。
 *   `outline()` の祖先スタックは見出しを処理するたびに自分が先頭になるので、同じ意味になる。
 */
export function derivedDepthAt(doc: PMNode, pos: number): number {
  let enclosing: number | null = null
  doc.forEach((node, offset) => {
    if (offset >= pos) return
    const level = headingLevel(node.textContent)
    if (level !== null) enclosing = level
  })
  return depthUnder(enclosing)
}

/**
 * ドキュメントから見出しツリーを導出する。
 *
 * ⚠⚠ **`parts` を受け取るのが契約**（DESIGN 1-6-4）。
 *   `partRef` ノードが持つ属性は `instanceId` / `partId` の 2 つだけで、
 *   `form: 'section'` のパートの **見出し文字列は Part 側にあり doc に無い**。
 *   だから doc だけではツリーが作れない。`analyzePlacement(doc, parts)` と同じ形。
 *
 *   代案（partRef の attrs に title をキャッシュする）は採らない。
 *   「ツリーを別データとして持たない」（1-2）と「導出値をデータ側に持たせない」（P0 知見 1）を
 *   両方破り、本文編集と二重管理になって必ず drift するため。
 *
 * ⚠ この向きなので `document/` は `template/` を知らないままでいられる（DESIGN §2 の依存の向き）。
 *   受け取るのは「導出済みのパート列」であって、テンプレ定義でもインスタンスでもない。
 *
 * ⚠ ツリーに出るのは `form: 'section'` のパートだけ。
 *   本文中・図は「見出し」ではないので出さない。
 *   データ側から消えたパート（dangling）も出さない —— それは
 *   `analyzePlacement()` の責務で、ツリーは「今ある見出し」だけを写す。
 *
 * ⚠ 見出しかどうかは **本文の記号**で決まる（`attrs.level` は見ない）。
 *   記号は本物のテキストとして本文に残っているので、**題名からは剥がして**ツリーに出す
 *   （左ペインに `## みだし` と出てはいけない）。
 *
 * ⚠ 走査するのは doc の直下のブロックだけ（引用の中などに入れた参照は拾わない）。
 *   v0 の本文は 1 枚の連続文書（CONCEPT Q5）でネストを作らないため。
 */
export function outline(doc: PMNode, parts: Part[] = []): OutlineItem[] {
  const index = new Map(parts.map((p) => [partKeyOf(p.instanceId, p.partId), p]))

  const roots: OutlineItem[] = []
  /**
   * 直前までの祖先。level の昇順で積む。
   *
   * ⚠⚠ **ここに積んでよいのは見出しだけ。** パート参照を積むと、
   *   次のパート参照が「直前のパート参照」を親だと思い込み、深さが階段になる。
   *   同じ見出しの下に独立章パートを N 件並べる形（DESIGN 1-6-5 の
   *   「配列 1 件ごとに独立章を生む」宣言が作る形）が、まさにこれである。
   */
  const headingAncestors: OutlineItem[] = []

  /** 現在の親（＝直前の見出し）に item をぶら下げる。 */
  const appendItem = (item: OutlineItem) => {
    const parent = headingAncestors[headingAncestors.length - 1]
    if (parent) parent.children.push(item)
    else roots.push(item)
  }

  /**
   * 参照ノード 1 個をツリーに置く（置くべきものなら）。
   * ⚠ block 版と inline 版で**扱いを分けない**。分けると、同じ `section` のパートが
   *   置いた形態によってツリーに出たり出なかったりする。
   */
  const placeRef = (node: PMNode, pos: number) => {
    const part = index.get(partKeyOf(String(node.attrs.instanceId), String(node.attrs.partId)))
    if (!part || part.form !== 'section') return

    // ⭐ 深さは「何を置いたか」ではなく「どこに置いたか」の属性（DESIGN 1-6-3）。
    //    同じパートを 2 箇所に置いたとき（S7-3）、両者が別の深さになれるのはこの向きだから。
    // ⚠ **祖先には積まない。** 積むと次のパート参照の親になってしまい、
    //   「どこに置いたか」ではなく「何番目に置いたか」で深さが決まってしまう。
    //   → **パート参照は配下を持たない**（左ペインの上げ下げで配下を気にしなくてよい根拠）。
    const enclosing = headingAncestors[headingAncestors.length - 1]
    const derived = depthUnder(enclosing?.level ?? null)
    // ⭐⭐ **明示された深さがあればそれを使う**（§1-3-3e-2・左ペインの上げ下げ）。
    //   ⚠ 既定は `null`＝導出。**既存の doc は属性を持たない**ので、ここが後方互換の受け口。
    const explicit = node.attrs.depth
    const level =
      typeof explicit === 'number' && Number.isFinite(explicit)
        ? Math.min(Math.max(Math.trunc(explicit), 1), MAX_LEVEL)
        : derived
    appendItem({ kind: 'partRef', level, title: part.title, pos, children: [] })
  }

  doc.forEach((node, offset) => {
    // ⭐ レベルも題名も **本文のテキストから導出する**（`attrs.level` は読まない）。
    //   CONCEPT Q2 改訂で記号が本文に残るようになり、真実がテキスト側へ移ったため。
    const level = headingLevel(node.textContent)
    if (level !== null) {
      // 同レベル以上の見出しまで巻き戻してから、自分をぶら下げて祖先になる。
      while (
        headingAncestors.length > 0 &&
        headingAncestors[headingAncestors.length - 1]!.level >= level
      ) {
        headingAncestors.pop()
      }
      const item: OutlineItem = {
        kind: 'heading',
        level,
        title: headingTitle(node.textContent),
        pos: offset,
        children: [],
      }
      appendItem(item)
      headingAncestors.push(item)
      // ⚠ return しない。見出しの中にも inline 参照は置けるので、下の走査へ落とす。
    } else if (node.type.name === PART_REF_NODE) {
      placeRef(node, offset)
      return
    }

    // ⚠ inline 版の参照は**段落の中**に居るので、doc の直下を見るだけでは 1 個も見つからない
    //   （DESIGN 1-6-3・1-7-3）。ここを足さないと、独立章のパートを文中に置いた場合だけ
    //   ツリーから黙って消える。
    node.descendants((child, childPos) => {
      if (child.type.name !== PART_REF_INLINE_NODE) return
      // childPos は node の内容の先頭からの相対位置。+1 は node 自身の開きタグ分。
      placeRef(child, offset + 1 + childPos)
    })
  })

  return roots
}

/** ツリーを深さ優先で平らに畳む（UI の描画・テストの照合用）。 */
export function flattenOutline(items: OutlineItem[]): OutlineItem[] {
  const out: OutlineItem[] = []
  const walk = (list: OutlineItem[]) => {
    for (const item of list) {
      out.push(item)
      walk(item.children)
    }
  }
  walk(items)
  return out
}
