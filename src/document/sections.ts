import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { PART_REF_NODE } from '../p0/partRefExtension'

/**
 * 左ペインからの並べ替え・階層変更。
 *
 * ⚠ ここに「ツリーの状態」は無い。**すべて doc への操作**として書く。
 *    ツリーは outline() が毎回導出するので、doc が変われば勝手に追従する（完了条件 #2）。
 *
 * ⚠ ドラッグの実体は P0 知見 4 のとおり「削除＋挿入」の 2 手。
 *    attrs はノードに乗って動くのでパートの紐付けは切れない。
 */

/** 見出し 1 個とその配下（次の同レベル以上の見出しの手前まで）が占める範囲。 */
export interface SectionRange {
  from: number
  to: number
  /** 見出しなら heading レベル。パート参照なら null（深さは位置で決まる） */
  level: number | null
}

const MIN_LEVEL = 1
const MAX_LEVEL = 6

function headingLevel(node: PMNode): number | null {
  if (node.type.name !== 'heading') return null
  return Number(node.attrs.level) || 1
}

/** doc の直下のブロック境界（＝挿入して良い位置）を全部返す。先頭 0 と末尾を含む。 */
export function topLevelBoundaries(doc: PMNode): number[] {
  const out = [0]
  let pos = 0
  doc.forEach((node) => {
    pos += node.nodeSize
    out.push(pos)
  })
  return out
}

/**
 * `pos`（doc 直下のブロックの開始位置）にある節の範囲を求める。
 * 見出しなら配下（より深い見出し・本文・パート参照）を全部含む。
 */
export function sectionRangeAt(doc: PMNode, pos: number): SectionRange | null {
  const node = doc.nodeAt(pos)
  if (!node) return null

  const level = headingLevel(node)
  if (level === null) {
    // 見出しでないブロック（段落・パート参照など）は、そのブロック 1 個だけが範囲。
    return { from: pos, to: pos + node.nodeSize, level: null }
  }

  let to = pos + node.nodeSize
  let scanning = false
  doc.forEach((child, offset) => {
    if (offset === pos) {
      scanning = true
      return
    }
    if (!scanning) return
    const childLevel = headingLevel(child)
    if (childLevel !== null && childLevel <= level) {
      scanning = false
      return
    }
    to = offset + child.nodeSize
  })
  return { from: pos, to, level }
}

/**
 * 節を `destPos`（doc 直下の境界）へ移動する Transaction を組む。
 * 移動できない場合は null（＝呼び出し側は何もしない）。
 *
 * ⚠ 自分自身の内側へは落とせない。落とせると節が消える。
 */
export function moveSection(
  state: EditorState,
  sourcePos: number,
  destPos: number,
): Transaction | null {
  const doc = state.doc
  const range = sectionRangeAt(doc, sourcePos)
  if (!range) return null
  if (!topLevelBoundaries(doc).includes(destPos)) return null
  // 自分の内側（範囲の内部）へは移せない。境界（from / to）は「動かない」ので無視する。
  if (destPos > range.from && destPos < range.to) return null
  if (destPos === range.from || destPos === range.to) return null

  const slice = doc.slice(range.from, range.to)
  const tr = state.tr.delete(range.from, range.to)
  // 削除で位置がずれるので必ず写像してから挿入する。
  tr.insert(tr.mapping.map(destPos, -1), slice.content)
  return tr
}

/**
 * 節の階層を変える Transaction を組む。見出し本体と、その配下の見出しを同じ量だけずらす。
 *
 * ⚠ パート参照には効かない（深さは「どこに置いたか」で決まるので、
 *    階層を変えるとは別の見出しの下へ **移す** ことに他ならない → moveSection を使う）。
 */
export function setSectionLevel(
  state: EditorState,
  sourcePos: number,
  newLevel: number,
): Transaction | null {
  if (newLevel < MIN_LEVEL || newLevel > MAX_LEVEL) return null
  const doc = state.doc
  const range = sectionRangeAt(doc, sourcePos)
  if (!range || range.level === null) return null

  const delta = newLevel - range.level
  if (delta === 0) return null

  const tr = state.tr
  doc.forEach((node, offset) => {
    if (offset < range.from || offset >= range.to) return
    const level = headingLevel(node)
    if (level === null) return
    const next = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level + delta))
    if (next === level) return
    tr.setNodeMarkup(offset, undefined, { ...node.attrs, level: next })
  })
  return tr.docChanged ? tr : null
}

/** 参照ノードかどうか（UI の出し分け用）。 */
export function isPartRefAt(doc: PMNode, pos: number): boolean {
  return doc.nodeAt(pos)?.type.name === PART_REF_NODE
}
