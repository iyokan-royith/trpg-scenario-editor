/**
 * `outputs` — 「どんなパートを・どんな形で生むか」の宣言（DESIGN-v0.md 1-6）。
 *
 * ⚠⚠ **v0 で JSON から書けるのはここまで**（1-6-1 案イ「文法は内部表現。JSON からは開かない」）。
 *   1-6-2 の文法（`repeat` / `field-ref` / `inline-seq`）は **組み込みパターンの中に閉じている**。
 *   ユーザーが JSON に書けるのは「**どの組み込みパターンか**」の選択と、
 *   spike から引き継いだ 2 種（固定・配列ごと）だけ。
 *
 * ⚠ 旧名 `parts: PartDefinition[]` はこの型に置き換わった（DESIGN 1-3 の注記）。
 *   旧型は「何個生まれるか」だけを持ち、「中身に何を出すか」を持っていなかった。
 */
import type { PartForm } from './model'

/**
 * 出力の宣言 1 件。
 *
 * ⚠ 判別は **`pattern` を持つかどうか**で行う。同梱テンプレ定義（`templates/image.json`）が
 *   `{ "pattern": "builtin:image" }` の形で配布される契約なので、
 *   ここに `kind: '組み込み'` のような判別子を足すと JSON 側の形が変わってしまう。
 */
export type OutputDef =
  /** インスタンスごとに 1 個 */
  | { kind: '固定'; key: string; label: string; form: PartForm }
  /** `source` の配列の要素数だけ生まれる */
  | { kind: '配列ごと'; key: string; source: string; label: string; form: PartForm }
  /** 組み込みパターンに丸ごと任せる（生む数もパターンが決める） */
  | { pattern: string }

/** 組み込みパターン指定かどうか。⚠ 判別はこの述語 1 箇所でしか行わない。 */
export function 組み込みパターン指定か(output: OutputDef): output is { pattern: string } {
  return 'pattern' in output
}
