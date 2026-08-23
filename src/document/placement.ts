import type { Node as PMNode } from '@tiptap/pm/model'
import { collectPlacedRefs, type PlacedRef } from './partRefExtension'
import { partKeyOf, type Part } from '../template/model'

export interface PlacementReport {
  /** まだ本文のどこにも置かれていないパート（S7-1: 数字だけ常時見せる） */
  unplaced: Part[]
  /** データ側から消えたのに本文に残っている参照（S7-2: アラートを出す） */
  dangling: PlacedRef[]
  /** 同じパートが複数箇所に置かれている（S7-3: これは正常。件数だけ数える） */
  duplicated: string[]
}

/**
 * ドキュメントと生きているパート列を突き合わせる。
 * ⚠ 突き合わせは毎回この関数でやる。「配置済みフラグ」をデータ側に持たせない
 *    （持たせると本文の編集と二重管理になり、必ず drift する）。
 */
export function analyzePlacement(doc: PMNode, parts: Part[]): PlacementReport {
  const placed = collectPlacedRefs(doc)
  const livingKeys = new Set(parts.map((p) => partKeyOf(p.instanceId, p.partId)))

  const placedCount = new Map<string, number>()
  for (const ref of placed) {
    const key = partKeyOf(ref.instanceId, ref.partId)
    placedCount.set(key, (placedCount.get(key) ?? 0) + 1)
  }

  return {
    unplaced: parts.filter((p) => !placedCount.has(partKeyOf(p.instanceId, p.partId))),
    dangling: placed.filter((ref) => !livingKeys.has(partKeyOf(ref.instanceId, ref.partId))),
    duplicated: [...placedCount.entries()].filter(([, n]) => n > 1).map(([key]) => key),
  }
}
