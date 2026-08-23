import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { PART_REF_NODE } from './partRefExtension'
import { 最大レベル, 最小レベル, 見出し記号, 見出しレベル, 記号の長さ } from './heading'

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

/**
 * 見出しレベルは **本文の記号から読む**（`attrs.level` は読まない）。
 * CONCEPT Q2 改訂（2026-08-23）で記号が本文に残るようになり、真実がテキスト側へ移った。
 * ⚠ こうしておくと、テストが素で組んだ doc（同期プラグインを通っていない）でも正しく動く。
 */
function headingLevel(node: PMNode): number | null {
  return 見出しレベル(node.textContent)
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
 * 「掴んだ節を、落とした先の節の**場所へ**動かす」を doc 上の挿入位置に翻訳する。
 *
 * ⭐ リストの並べ替えで期待される意味は「**相手の位置を取る**」であって
 *   「相手の前に挿す」ではない。前に挿す意味に固定すると、
 *   **すぐ下の兄弟へ落としたときに「動かない位置」を指してしまい、1 つ下へ動かせなくなる**
 *   （＝リスト UI でいちばん自然なジェスチャが死ぬ）。
 *
 * - 下へ動かすとき（掴んだ方が上）→ 相手の節の**うしろ**
 * - 上へ動かすとき（掴んだ方が下）→ 相手の節の**まえ**
 *
 * 落とせないときは null。
 */
export function dropTargetPos(doc: PMNode, sourcePos: number, targetPos: number): number | null {
  if (sourcePos === targetPos) return null
  const source = sectionRangeAt(doc, sourcePos)
  const target = sectionRangeAt(doc, targetPos)
  if (!source || !target) return null
  // 自分の配下へは落とせない（落とせると節が消える）
  if (targetPos > source.from && targetPos < source.to) return null
  return sourcePos < targetPos ? target.to : target.from
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
 * 節の階層を変えられるか。変えられないなら**理由**を返す（UI がそのまま出せる形）。
 *
 * ⭐ 「できるか」と「やる」を分けてあるのは、**ボタンの見た目と実行が同じ規則から出る**ため。
 *   別々に判定すると「押せるのに押すと断られる」が生まれる。
 */
export type 階層変更の可否 =
  | { 可: true }
  | { 可: false; 理由: 'レベルの範囲外' | '配下が範囲外へ押し出される' | '見出しではない' }

export function 階層を変えられるか(
  doc: PMNode,
  sourcePos: number,
  newLevel: number,
): 階層変更の可否 {
  const range = sectionRangeAt(doc, sourcePos)
  if (!range || range.level === null) return { 可: false, 理由: '見出しではない' }
  if (newLevel < 最小レベル || newLevel > 最大レベル) {
    return { 可: false, 理由: 'レベルの範囲外' }
  }
  const delta = newLevel - range.level
  if (delta === 0) return { 可: false, 理由: 'レベルの範囲外' }

  // ⚠ 配下がはみ出す場合は **断る**。以前はここで clamp していて、
  //   「親を 1 つ下げたら、上限に張り付いた子だけ動かず、親子が同じ深さに潰れる」
  //   という **黙ったままの構造破壊**が起きていた（2026-08-23 に実測）。
  let はみ出す = false
  doc.forEach((node, offset) => {
    if (offset < range.from || offset >= range.to) return
    const level = headingLevel(node)
    if (level === null) return
    const next = level + delta
    if (next < 最小レベル || next > 最大レベル) はみ出す = true
  })
  return はみ出す ? { 可: false, 理由: '配下が範囲外へ押し出される' } : { 可: true }
}

/**
 * 節の階層を変える Transaction を組む。見出し本体と、その配下の見出しを同じ量だけずらす。
 *
 * ⭐⭐ **書き換えるのは `attrs.level` ではなく、本文の見出し記号そのもの**
 *   （CONCEPT Q2 改訂・2026-08-23）。記号が真実なので、記号を変えないと何も変わらない。
 *   ロイスの言う「メタデータはメタデータとして編集したい」を、
 *   左ペインのボタンも**同じ実体（記号）を編集する**形で満たしている。
 *
 * ⚠ パート参照には効かない（深さは「どこに置いたか」で決まるので、
 *    階層を変えるとは別の見出しの下へ **移す** ことに他ならない → moveSection を使う）。
 */
export function setSectionLevel(
  state: EditorState,
  sourcePos: number,
  newLevel: number,
): Transaction | null {
  const doc = state.doc
  if (!階層を変えられるか(doc, sourcePos, newLevel).可) return null

  const range = sectionRangeAt(doc, sourcePos)!
  const delta = newLevel - range.level!

  const 書き換え: Array<{ from: number; to: number; 記号: string }> = []
  doc.forEach((node, offset) => {
    if (offset < range.from || offset >= range.to) return
    const level = headingLevel(node)
    if (level === null) return
    // ノードの中身は offset+1 から始まる。記号はその先頭にある。
    書き換え.push({
      from: offset + 1,
      to: offset + 1 + 記号の長さ(node.textContent),
      記号: 見出し記号(level + delta),
    })
  })
  if (書き換え.length === 0) return null

  const tr = state.tr
  // ⚠ 記号の長さが変わると後ろの位置がずれるので、**うしろから**当てる。
  for (const 一件 of [...書き換え].reverse()) {
    tr.insertText(一件.記号, 一件.from, 一件.to)
  }
  return tr.docChanged ? tr : null
}

/** 参照ノードかどうか（UI の出し分け用）。 */
export function isPartRefAt(doc: PMNode, pos: number): boolean {
  return doc.nodeAt(pos)?.type.name === PART_REF_NODE
}
