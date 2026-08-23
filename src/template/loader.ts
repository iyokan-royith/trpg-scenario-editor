/**
 * テンプレ定義の読み込み（Q6: **同梱品もユーザー持ち込みも同じ経路**）。
 *
 * ⚠⚠ **同梱テンプレを「オブジェクトとして import する」ことはしない。**
 *   `import def from './image.json'` にすると、同梱品だけが
 *   **JSON の構文解析も検証も通らずに**中へ入れてしまい、
 *   「同梱品が動く＝機構が検証される」（Q6 の狙い）が成立しなくなる。
 *   → `?raw` で **文字列として**読み、ユーザーが選んだファイルとまったく同じ
 *     `テンプレ定義を読む(text, 出所)` へ渡す。**入口はこの 1 本しかない。**
 */
import imageJson from '../templates/image.json?raw'
import { テンプレ定義を検める, TemplateDefinitionError } from './schema'
import type { TemplateDefinition } from './model'

/**
 * テンプレ定義の JSON テキストを読む。**同梱・持ち込みの区別なくここを通る。**
 * @param 出所 エラーメッセージに出す「どのファイルか」
 */
export function テンプレ定義を読む(text: string, 出所: string): TemplateDefinition {
  let 素: unknown
  try {
    素 = JSON.parse(text)
  } catch (error) {
    // ⚠ JSON.parse の素のメッセージは英語だが、**位置情報を含む**ので捨てない。
    throw new TemplateDefinitionError(出所, [
      `JSON として読めません: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }
  return テンプレ定義を検める(素, 出所)
}

/** 同梱テンプレ 1 件（テキストと出所の対）。 */
export interface 同梱テンプレ {
  出所: string
  text: string
}

/** リポジトリに同梱しているテンプレ定義。⚠ **普通の JSON**であって特別扱いはしない（Q6）。 */
export const 同梱テンプレの一覧: 同梱テンプレ[] = [
  { 出所: 'src/templates/image.json', text: imageJson },
]

/** 同梱テンプレを全部読む。壊れていれば `TemplateDefinitionError` が飛ぶ（黙って落とさない）。 */
export function 同梱テンプレを読む(): TemplateDefinition[] {
  return 同梱テンプレの一覧.map(({ text, 出所 }) => テンプレ定義を読む(text, 出所))
}
