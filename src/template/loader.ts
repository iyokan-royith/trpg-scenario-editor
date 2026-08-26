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
import dungeonMapJson from '../templates/dungeon-map.json?raw'
import { validateTemplateDefinition, TemplateDefinitionError } from './schema'
import type { TemplateDefinition } from './model'

/**
 * ⚠ 「キーとして使われる**値**」を持つプロパティ名。
 *   `fields[].key` と `outputs[].key` / `outputs[].over` / `liquidOutputs[].over` は、
 *   あとでインスタンスのデータを引くときの**キーそのもの**になる。
 *   `label` や `name` は表示名なので**含めない**（正規化しても害は無いが、
 *   「何がキーか」を曖昧にしないために区別しておく）。
 *
 * ⚠⚠ **`liquidOutputs[].template` は含めない。** あれは利用者が書いた**値**（本文）であり、
 *   「値には触らない」という下の規約に従う。⚠ ただしテンプレ文字列の中の `{{ ... }}` は
 *   NFC へ揃えたキーを参照するので、**中に NFD が混ざると黙って解決に失敗する**。
 *   識別子は英語という規約（§1-8）があるので当面は踏まないはずだが、線としては開いている。
 *   要検証[テンプレ文字列の中に NFD のキー参照を書いた実データが出たら、値に触らない規約と
 *   どちらを取るか決める（現状はテンプレ側が黙って空になる）]
 */
const KEY_VALUED_PROPERTIES = new Set(['key', 'over'])

/**
 * ⭐ 定義の中のキー文字列を **NFC へ揃える**（DESIGN-v0.md §1-8-4 規約①）。
 *
 * ⚠⚠ **見た目が同じキーが一致しない**事故を防ぐための唯一の場所。
 *   濁点は 1 文字（NFC）にも「か＋濁点」の 2 文字（NFD）にも書けて、
 *   **画面上は完全に同じに見える**のに、JS の文字列比較・オブジェクトのキー参照・
 *   `JSON.parse` の往復・js-yaml の**どれも一致しない**（実測）。
 *   macOS 由来のファイル名やコピー&ペーストで NFD は普通に紛れ込む。
 *
 * ⚠ 揃えるのは**キーだけ**で、値（表示名・本文）には触らない。
 *   値まで書き換えると、利用者が書いたとおりに出ない場所ができる。
 *
 * ⚠ 入口が 1 本（Q6）だからここに置けば足りる。**各層に散らさない。**
 */
export function normalizeKeysToNfc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeysToNfc)
  if (typeof value !== 'object' || value === null) return value

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized =
      KEY_VALUED_PROPERTIES.has(key) && typeof child === 'string'
        ? child.normalize('NFC')
        : normalizeKeysToNfc(child)
    out[key.normalize('NFC')] = normalized
  }
  return out
}

/**
 * テンプレ定義の JSON テキストを読む。**同梱・持ち込みの区別なくここを通る。**
 * @param source エラーメッセージに出す「どのファイルか」
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
  // ⚠ 検証より**前**に通す。検証のエラーメッセージにもキーが出るので、
  //   ここが後だと「同じに見える 2 つのキー」がメッセージ上でも見分けられなくなる。
  return validateTemplateDefinition(normalizeKeysToNfc(parsed), source)
}

/** 同梱テンプレ 1 件（テキストと出所の対）。 */
export interface BundledTemplate {
  source: string
  text: string
}

/** リポジトリに同梱しているテンプレ定義。⚠ **普通の JSON**であって特別扱いはしない（Q6）。 */
export const bundledTemplates: BundledTemplate[] = [
  { source: 'src/templates/image.json', text: imageJson },
  { source: 'src/templates/dungeon-map.json', text: dungeonMapJson },
]

/** 同梱テンプレを全部読む。壊れていれば `TemplateDefinitionError` が飛ぶ（黙って落とさない）。 */
export function readBundledTemplates(): TemplateDefinition[] {
  return bundledTemplates.map(({ text, source }) => readTemplateDefinition(text, source))
}
