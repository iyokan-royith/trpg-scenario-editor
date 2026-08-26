/**
 * liquidjs のエンジンを作る唯一の場所（DESIGN-v0.md §1-13-1c）。
 *
 * ⚠⚠ **実行時オプションはここではまだ固定しない（P-b の仕事）。**
 *   §1-13-1c で既に決まっている `strictVariables` / `strictFilters` /
 *   `renderLimit: 10000` / HTML・md の 2 インスタンス は **P-b でこのファイルにだけ足す**。
 *   → 生成箇所を 1 本にしておくのは、そのとき触るファイルを 1 つに閉じるため。
 *   **呼び出し側でエンジンを `new` しないこと。**
 *
 * ⚠⚠ **P-a の間、この経路を UI のイベントに繋いではならない。**
 *   `renderLimit` がまだ無く、非同期経路の暴走は**プロセス内から止められない**
 *   （`research/2026-08-26-liquid-unbounded-loops.md`: 自己再帰 `{% render %}` は
 *   非同期 API では 25 秒経っても例外もクラッシュも出さない）。P-a はテストからのみ叩く。
 *
 * ⚠ 非同期 API（`parseAndRender`）を使う前提で作る。§1-13-1c の決定が非同期なので、
 *   P-a のうちから Promise を返す形にしておけば **P-b はオプションを足すだけで済む**。
 */
import { Liquid } from 'liquidjs'

/**
 * liquid エンジンを 1 つ作る。
 *
 * ⚠ 既定のオプションのまま（`ownPropertyOnly` は liquidjs 10 の既定で `true`）。
 *   **意図的に何も指定していない**——P-a は「文字列から出力が作れること」だけを確かめる段で、
 *   オプションの固定は P-b が決める（決定は §1-13-1c に既にある）。
 */
export function createLiquidEngine(): Liquid {
  return new Liquid()
}

/**
 * 既定のエンジン（パース結果のキャッシュを共有するため 1 個を使い回す）。
 * ⚠ テストが独立したエンジンを使いたいときは `createLiquidEngine()` を呼んで注入する。
 */
export const defaultLiquidEngine: Liquid = createLiquidEngine()
