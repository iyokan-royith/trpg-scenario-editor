/**
 * 組み込みパターンの登録簿。
 *
 * ⚠ **ここが「使えるパターン名」の単一の真実**。定義の検証（`template/schema.ts`）も
 *   パートの導出（`template/model.ts`）も、同じこの表を引く。
 *   2 箇所に名前の一覧を持つと、**検証は通るのに導出で落ちる**組み合わせが作れてしまう。
 */
import type { Part, TemplateDefinition, TemplateInstance } from '../model'
import { evaluateOutputs, type OutputNode } from '../outputs'
import { IMAGE_PATTERN, renderImagePart } from './image'
import { DUNGEON_MAP_PATTERN, DUNGEON_MAP_OUTPUTS } from './dungeonMap'

export type PatternRenderer = (instance: TemplateInstance, def: TemplateDefinition) => Part[]

/**
 * 1-6-2 の文法で書いた宣言を、そのままパターンとして登録できる形にする（1-6-1 案イ）。
 *
 * ⚠ **すべての組み込みパターンがこの形にできるわけではない**（実測）。
 *   `builtin:image` は「画像が未設定なら別の文字列を出す」という**条件分岐**を要し、
 *   文法（1-6-2）に条件分岐は無い。→ §1-6-1 の `要検証`（v1 で文法を JSON に開くとき
 *   組み込みが文法で書ききれているか）に対する**否定側の実測**であり、報告事項。
 */
export function grammarPattern(nodes: OutputNode[]): PatternRenderer {
  return (instance) => evaluateOutputs(nodes, instance)
}

export const builtinPatterns: Record<string, PatternRenderer> = {
  [IMAGE_PATTERN]: renderImagePart,
  [DUNGEON_MAP_PATTERN]: grammarPattern(DUNGEON_MAP_OUTPUTS),
}

export function builtinPatternNames(): string[] {
  return Object.keys(builtinPatterns)
}
