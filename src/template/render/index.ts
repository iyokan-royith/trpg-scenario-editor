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
 * ⚠ **すべての組み込みパターンがこの形にできるわけではない**（実測・§1-6-8）。
 *   `builtin:image` の条件分岐（画像が未設定なら別の文字列を出す）自体は、
 *   評価器の `imageRef` ノードに焼き込む形で文法（1-6-2）でも書ける
 *   （実際 `grammarPattern` に差し替えても出力文字列は手続き版と一致する）。
 *   **本当の壁**は別にある: ① `inlinePart` の `title` が `''` 固定で、
 *   画像は表示名（caption）由来の `title` を素材一覧・dangling アラートに渡す必要がある
 *   ② `alt`/`title` が静的文字列しか取れず「フィールドの値を使い、無ければ空」が書けない。
 *   → §1-6-1 の `要検証`（v1 で文法を JSON に開くとき組み込みが文法で書ききれているか）
 *   に対する**否定側の実測**であり、§1-6-1 案イに昇格済み。
 *
 *   ⭐ 一般形: 文法は静的な宣言なので、条件分岐・整形の規則は「ノード種として
 *   評価器に焼き込む」形でしか入らない。`imageRef` はその一例。「文法で書ける」とは
 *   「既存のノード種の組み合わせで書ける」という意味であり、書けない範囲があるのは
 *   文法が無力だからではなく、その組み合わせがまだ無いからである。
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
