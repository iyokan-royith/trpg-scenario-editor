import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { Node as PMNode } from '@tiptap/pm/model'
import PartRefView from './PartRefView.vue'

export const PART_REF_NODE = 'partRef'
export const PART_REF_INLINE_NODE = 'partRefInline'

/** 参照ノードの共通部分。⚠ block 版と inline 版で**属性の形を分けない**（走査も突き合わせも同じ）。 */
const 参照の属性 = () => ({
  instanceId: { default: null },
  partId: { default: null },
})

/**
 * 本文に置かれる「パートへの参照」（ブロック版）。
 *
 * ⚠ 設計の要: このノードは **内容を持たない**（atom）。持つのは
 *   `instanceId` / `partId` の 2 つだけで、表示内容はストアから引く。
 *   これにより「同じパートを 2 箇所に置く」（S7-3）が自然に成立し、
 *   データを直せば置かれた全部が同時に変わる（S7 の要点 3）。
 */
export const PartRef = Node.create({
  name: PART_REF_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes: 参照の属性,

  parseHTML() {
    return [{ tag: 'div[data-part-ref]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-part-ref': '' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(PartRefView)
  },
})

/**
 * 段落の**中**に置ける参照（インライン版・DESIGN 1-6-3 / 1-7-3）。
 *
 * ⚠⚠ **block 版を置き換えるものではない。** 形態 `独立章` はブロックとして置かれ、
 *   `本文中`（画像を含む）はこちらで置かれる。両方が同時に存在する。
 *
 * ⚠ 「単独で 1 ブロックを占める画像」も**このノードを空の段落に置く**ことで表す。
 *   深さと同じで、**単独行かどうかは「何を置いたか」ではなく「どこに置いたか」の属性**である。
 *
 * ⚠ DOM は **span**（NodeView 側も `as="span"`）。`<p>` の中に `<div>` を入れると
 *   HTML として不正で、ブラウザの正規化が段落を割りうる。
 *   `data-part-ref-inline` と属性名を分けているのも、貼り付け経路で block 版と
 *   取り違えないようにするため。
 */
export const PartRefInline = Node.create({
  name: PART_REF_INLINE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes: 参照の属性,

  parseHTML() {
    return [{ tag: 'span[data-part-ref-inline]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-part-ref-inline': '' })]
  },

  // ⚠ 包む要素を span にするのは **`PartRefView` 側の `NodeViewWrapper :as`**。
  //   Vue の NodeView はコンポーネントのルート要素がそのまま `dom` になるので、
  //   レンダラ側にタグを渡す口は無い（`VueNodeViewRendererOptions` に `as` は無い）。
  addNodeView() {
    return VueNodeViewRenderer(PartRefView)
  },
})

/** そのノードが参照ノードか（block / inline を問わない）。 */
export function 参照ノードか(node: PMNode): boolean {
  return node.type.name === PART_REF_NODE || node.type.name === PART_REF_INLINE_NODE
}

export interface PlacedRef {
  instanceId: string
  partId: string
  pos: number
}

/**
 * ドキュメントを走査して、置かれている参照を全部集める。
 * ⚠ **block 版と inline 版の両方を拾う。** 片方だけを見ると
 *   「未配置 N 件」も dangling 検出も、その形態の参照に対してだけ黙って外れる。
 */
export function collectPlacedRefs(doc: PMNode): PlacedRef[] {
  const found: PlacedRef[] = []
  doc.descendants((node, pos) => {
    if (!参照ノードか(node)) return
    found.push({
      instanceId: String(node.attrs.instanceId),
      partId: String(node.attrs.partId),
      pos,
    })
  })
  return found
}
