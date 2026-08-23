/**
 * テンプレ定義の読み込み（Q6: **同梱品もユーザー持ち込みも同じ経路**）。
 *
 * ⚠⚠ **同梱テンプレを「オブジェクトとして import する」ことはしない。**
 *   `import def from './image.json'` にすると、同梱品だけが
 *   **JSON の構文解析も検証も通らずに**中へ入れてしまい、
 *   「同梱品が動く＝機構が検証される」（Q6 の狙い）が成立しなくなる。
 *   → `?raw` で **文字列として**読み、ユーザーが選んだファイルとまったく同じ
 *     `readTemplateDefinition(text, source)` へ渡す。**入口はこの 1 本しかない。**
 */
import imageJson from '../templates/image.json?raw'
import { validateTemplateDefinition, TemplateDefinitionError } from './schema'
import type { TemplateDefinition } from './model'

/**
 * テンプレ定義の JSON テキストを読む。**同梱・持ち込みの区別なくここを通る。**
 * @param 出所 エラーメッセージに出す「どのファイルか」
 */
export function readTemplateDefinition(text: string, source: string): TemplateDefinition {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // ⚠ JSON.parse の素のメッセージは英語だが、**位置情報を含む**ので捨てない。
    throw new TemplateDefinitionError(source, [
      `JSON として読めません: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }
  return validateTemplateDefinition(parsed, source)
}

/** 同梱テンプレ 1 件（テキストと出所の対）。 */
export interface BundledTemplate {
  source: string
  text: string
}

/** リポジトリに同梱しているテンプレ定義。⚠ **普通の JSON**であって特別扱いはしない（Q6）。 */
export const bundledTemplates: BundledTemplate[] = [
  { source: 'src/templates/image.json', text: imageJson },
]

/** 同梱テンプレを全部読む。壊れていれば `TemplateDefinitionError` が飛ぶ（黙って落とさない）。 */
export function readBundledTemplates(): TemplateDefinition[] {
  return bundledTemplates.map(({ text, source }) => readTemplateDefinition(text, source))
}
