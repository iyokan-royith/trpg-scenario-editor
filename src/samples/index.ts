/**
 * 同梱のサンプル**インスタンス**（＝実データ）。
 *
 * ⚠ `src/templates/` は**テンプレ定義**（何を作れるか）の置き場で、こちらは
 *   その定義に沿った**インスタンス 1 件**（1-1 の 4 層のうち 2 段目）。層が違うので混ぜない。
 *   ⚠ DESIGN-v0.md §2 のモジュール構成にこのディレクトリは書かれていない（報告事項）。
 *
 * ⚠ 中身は手描きの迷宮 1 本ぶんを、§1-8-2 の対応表どおり**キーだけ英語・値は日本語**にしたもの。
 *   ⚠ **原本に無い値は足していない**——`roomStats` を持つ部屋が 1 つしか無いのは元データがそうだから。
 *
 * ⚠ 配列要素の `id` は**取り込み時に採番したもの**（P0 知見 2）。
 *   `at`（位置）や `name` をキーにすると、部屋を動かした／改名した瞬間に
 *   本文に置かれた参照が全部切れる。
 */
import raw from './mayoi-park.json?raw'
import type { TemplateInstance } from '../template/model'

export const MAYOI_PARK_SAMPLE_SOURCE = 'src/samples/mayoi-park.json'

/**
 * サンプルを 1 件読む。
 *
 * ⚠ **`import obj from './x.json'` にしない**（テンプレ定義側と同じ理由・`loader.ts` の警告）。
 *   オブジェクトとして取り込むと JSON の構文解析を通らずに中へ入ってしまい、
 *   「同梱品が動く＝機構が検証される」が成立しなくなる。
 *
 * ⚠ 画像は持たない。`images` が空でも 4 層の形は変わらない（1-4）。
 */
export function readMayoiParkSample(): TemplateInstance {
  const parsed = JSON.parse(raw) as Omit<TemplateInstance, 'images'>
  return { ...parsed, images: {} }
}
