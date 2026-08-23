/**
 * 組み込みパターンの登録簿。
 *
 * ⚠ **ここが「使えるパターン名」の単一の真実**。定義の検証（`template/schema.ts`）も
 *   パートの導出（`template/model.ts`）も、同じこの表を引く。
 *   2 箇所に名前の一覧を持つと、**検証は通るのに導出で落ちる**組み合わせが作れてしまう。
 */
import type { Part, TemplateDefinition, TemplateInstance } from '../model'
import { IMAGE_PATTERN, renderImagePart } from './image'

export type PatternRenderer = (instance: TemplateInstance, def: TemplateDefinition) => Part[]

export const builtinPatterns: Record<string, PatternRenderer> = {
  [IMAGE_PATTERN]: renderImagePart,
}

export function builtinPatternNames(): string[] {
  return Object.keys(builtinPatterns)
}
