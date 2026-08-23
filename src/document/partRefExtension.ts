import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import type { Node as PMNode } from '@tiptap/pm/model'
import PartRefView from './PartRefView.vue'

export const PART_REF_NODE = 'partRef'

/**
 * 本文に置かれる「パートへの参照」。
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

  addAttributes() {
    return {
      instanceId: { default: null },
      partId: { default: null },
    }
  },

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

export interface PlacedRef {
  instanceId: string
  partId: string
  pos: number
}

/** ドキュメントを走査して、置かれている参照を全部集める。 */
export function collectPlacedRefs(doc: PMNode): PlacedRef[] {
  const found: PlacedRef[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== PART_REF_NODE) return
    found.push({
      instanceId: String(node.attrs.instanceId),
      partId: String(node.attrs.partId),
      pos,
    })
  })
  return found
}
