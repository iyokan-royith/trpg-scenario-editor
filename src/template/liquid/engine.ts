/**
 * liquidjs のエンジンを作る唯一の場所（DESIGN-v0.md §1-13-1c）。
 *
 * ⭐ **実行時オプションはここが単一の真実**（移行 P-b で固定した）。
 *   値はすべて §1-13-1c の**決定**であり、実装側で選んだものは 1 つも無い:
 *
 *   | 設定 | 値 | 決定の理由 |
 *   |---|---|---|
 *   | `strictVariables` | `true` | 既定 `false` だと**未定義変数が黙って空文字**になる（実測） |
 *   | `strictFilters`   | `true` | 既定 `false` だと**存在しないフィルタが黙って無視**される（実測） |
 *   | `renderLimit`     | `10000` | 「いったん10秒ぐらいにして」。⚠ **これが無いと `{% render %}` の自己参照が本物の無限ループになる** |
 *   | `outputEscape`    | HTML 側だけ `'escape'` | **エンジン単位でしか切り替えられない**ので 2 インスタンスに分ける |
 *
 * ⚠ **文面のラップ・日本語化はしない**（ロイス決定: 「特に日本語化とかする必要はないです」）。
 *   `LiquidError` 系は `line`/`col`/`^` 付きの該当行を持つので**そのまま利用者に見せられる**。
 *   ただし `parseLimit` 超過だけは `context` を持たない `AssertionError` になる
 *   （`research/2026-08-26-liquidjs-error-messages.md` 6b）。
 *   → **だから `parseLimit` は設定しない**（§1-13-1c「他のガードは入れない」）。
 *   `__tests__/engine.spec.ts` にその分岐を述語として固定してある。
 *
 * ⚠ **`memoryLimit` を「総出力サイズの上限」として使わないこと**——実測で効かない
 *   （特定のビルトインフィルタの入力しか見ない。素の `{{ }}` で 150 万字が例外なしで通る）。
 *
 * ⚠⚠ **この経路をまだ UI のイベントに繋がない**（P-b のスコープ外）。
 *   `renderLimit` が入ったので技術的には可能になったが、接続は後のフェーズで決める。
 *   ⚠ `renderLimit` が保証するのは「**終わること**」であって「固まらないこと」ではない（§1-13-1c）。
 *
 * ⚠ 非同期 API（`parseAndRender`）で使う前提。同期 API は再帰 `render` を
 *   スタックオーバーフローで止めてしまい、上限が言語仕様でなく API で決まってしまう。
 */
import { Liquid, type LiquidOptions } from 'liquidjs'

/**
 * このエンジンの出力が**どこへ行くか**。
 *
 * ⚠ これは「見た目の種類」ではなく **`outputEscape` を掛けるかどうか**の区別である。
 *   - `'html'`: すべての `{{ }}` を自動エスケープする（テンプレ作者が `| raw` で個別に外せる）
 *   - `'markdown'`: 値をそのまま出す（md の記号がエスケープされると表も見出しも壊れるため）
 */
export type LiquidPurpose = 'html' | 'markdown'

/**
 * 1 回の `render()` に許す時間（ms）。§1-13-1c の決定値。
 *
 * ⚠ **「10 秒で必ず止まる」という意味ではない**。liquidjs は決められた検査点でしか
 *   経過時間を見ないので、検査点の粗いテンプレ形状では超過しうる
 *   （実測: 自己再帰 `{% render %}` は設定 300ms → 319ms とほぼ正確だが、
 *   `{% for i in (1..1e8) %}` は設定 200ms → 3,714ms ＝ 18 倍超過）。
 *   **保証されるのは「有限時間で終わること」まで。**
 */
export const LIQUID_RENDER_LIMIT_MS = 10_000

/**
 * エンジンに渡すオプション（**テストから同じ値を再利用するために公開している**）。
 *
 * ⚠ ここに無い DoS ガード（`parseLimit` / `memoryLimit` / `templateLimit`）は
 *   **意図的に設定していない**。`renderLimit` 1 本で覆えることを実測してある（§1-13-1c）。
 */
export function liquidOptionsFor(purpose: LiquidPurpose): LiquidOptions {
  return {
    strictVariables: true,
    strictFilters: true,
    renderLimit: LIQUID_RENDER_LIMIT_MS,
    ...(purpose === 'html' ? { outputEscape: 'escape' as const } : {}),
  }
}

/**
 * liquid エンジンを 1 つ作る。
 *
 * ⚠ **引数は省略できない。** エスケープするかどうかは黙って決まってよい種類の設定ではない
 *   （既定値を置くと、呼び出し側が選んだのか選ばなかったのかコードから読めなくなる）。
 */
export function createLiquidEngine(purpose: LiquidPurpose): Liquid {
  return new Liquid(liquidOptionsFor(purpose))
}

/**
 * HTML へ出すためのエンジン（`{{ }}` を自動エスケープする）。
 * §1-13-1b の決定「出力は HTML をそのまま出す」の側。
 */
export const htmlLiquidEngine: Liquid = createLiquidEngine('html')

/** md へ出すためのエンジン（値をそのまま出す）。 */
export const markdownLiquidEngine: Liquid = createLiquidEngine('markdown')

/**
 * 既定のエンジン（パース結果のキャッシュを共有するため 1 個を使い回す）。
 *
 * ⚠⚠ **md 側を指しているのは「決定」ではなく「P-a と同じ振る舞いの維持」である。**
 *   P-a の素の `new Liquid()` はエスケープ無し＝md 相当だったので、ここを md にすると
 *   P-b でエスケープの有無が変わらない（＝この commit の差分が設定の追加だけに閉じる）。
 *   **どちらのエンジンで導出するかという振り分けは、UI へ繋ぐフェーズの決定**であり、
 *   そこで `deriveLiquidPartsOf` の呼び出し側が明示的に選ぶべきものである。
 *   `要検証[UI 接続フェーズで「パートごとにどちらのエンジンを使うか」が決まったとき、
 *   この既定を消して呼び出し側に必須で選ばせる形にする]`
 */
export const defaultLiquidEngine: Liquid = markdownLiquidEngine
