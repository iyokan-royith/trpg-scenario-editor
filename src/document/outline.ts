import type { Node as PMNode } from '@tiptap/pm/model'
import { PART_REF_NODE } from '../p0/partRefExtension'
import { partKeyOf, type Part } from '../p0/model'

/** 左ペインに出る 1 項目。⚠ これは **導出値** であり、保存しない（DESIGN 1-2）。 */
export interface OutlineItem {
  /** 見出しそのものか、独立章を生むパートへの参照か */
  kind: '見出し' | 'パート参照'
  /** ツリー上の深さ（1 が最上位）。⚠ 見出しは heading の level、パート参照は「置かれた場所」で決まる */
  level: number
  title: string
  /** ドキュメント内の位置。UI からの移動操作はこれを起点にする */
  pos: number
  children: OutlineItem[]
}

const MAX_LEVEL = 6

/**
 * ドキュメントから見出しツリーを導出する。
 *
 * ⚠⚠ **`parts` を受け取るのが契約**（DESIGN 1-6-4）。
 *   `partRef` ノードが持つ属性は `instanceId` / `partId` の 2 つだけで、
 *   `form: '独立章'` のパートの **見出し文字列は Part 側にあり doc に無い**。
 *   だから doc だけではツリーが作れない。`analyzePlacement(doc, parts)` と同じ形。
 *
 *   代案（partRef の attrs に title をキャッシュする）は採らない。
 *   「ツリーを別データとして持たない」（1-2）と「導出値をデータ側に持たせない」（P0 知見 1）を
 *   両方破り、本文編集と二重管理になって必ず drift するため。
 *
 * ⚠ この向きなので `document/` は `template/` を知らないままでいられる（DESIGN §2 の依存の向き）。
 *   受け取るのは「導出済みのパート列」であって、テンプレ定義でもインスタンスでもない。
 *
 * ⚠ ツリーに出るのは `form: '独立章'` のパートだけ。
 *   本文中・図は「見出し」ではないので出さない。
 *   データ側から消えたパート（dangling）も出さない —— それは
 *   `analyzePlacement()` の責務で、ツリーは「今ある見出し」だけを写す。
 *
 * ⚠ 走査するのは doc の直下のブロックだけ（引用の中などに入れた参照は拾わない）。
 *   v0 の本文は 1 枚の連続文書（CONCEPT Q5）でネストを作らないため。
 */
export function outline(doc: PMNode, parts: Part[] = []): OutlineItem[] {
  const index = new Map(parts.map((p) => [partKeyOf(p.instanceId, p.partId), p]))

  const roots: OutlineItem[] = []
  /** 直前までの祖先。level の昇順で積む */
  const stack: OutlineItem[] = []

  const push = (item: OutlineItem) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= item.level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(item)
    else roots.push(item)
    stack.push(item)
  }

  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level) || 1
      push({ kind: '見出し', level, title: node.textContent, pos: offset, children: [] })
      return
    }
    if (node.type.name !== PART_REF_NODE) return

    const part = index.get(partKeyOf(String(node.attrs.instanceId), String(node.attrs.partId)))
    if (!part || part.form !== '独立章') return

    // ⭐ 深さは「何を置いたか」ではなく「どこに置いたか」の属性（DESIGN 1-6-3）。
    //    同じパートを 2 箇所に置いたとき（S7-3）、両者が別の深さになれるのはこの向きだから。
    //    ⚠ 明示的な深さ指定 UI は P2（配置 UI）の責務。ここでは囲っている見出しの 1 つ下に置く。
    const enclosing = stack[stack.length - 1]
    const level = Math.min((enclosing?.level ?? 0) + 1, MAX_LEVEL)
    push({ kind: 'パート参照', level, title: part.title, pos: offset, children: [] })
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
