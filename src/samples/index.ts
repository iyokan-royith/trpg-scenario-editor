/**
 * 同梱のサンプル**インスタンス**（＝実データ）。
 *
 * ⚠ `src/templates/` は**テンプレ定義**（何を作れるか）の置き場で、こちらは
 *   その定義に沿った**インスタンス 1 件**（1-1 の 4 層のうち 2 段目）。層が違うので混ぜない。
 *   DESIGN-v0.md §2 のモジュール構成にこのディレクトリは追記済み。
 *
 * ⚠ 中身は手描きの迷宮 1 本ぶんを、§1-8-2 の対応表どおり**キーだけ英語・値は日本語**にしたもの。
 *   原本は3本あり、それぞれ持っている情報が違う（**「原本」を指すときはどれか明示する**）:
 *   ①`map.yaml`（テキスト定義）は `B3`（`room-2`）1 室だけが `部屋データ`（トラップ数/エネミー数）を持つ。
 *   ②`迷宮MAP.png`（手描き画像）は**9 室全部**に `T{n}/E{n}` のラベルがある。
 *   `roomStats` を持つ部屋は 2 室（`room-2`＝B3・`room-3`＝A2）で、**B3 は①②どちらにも実データがある**が、
 *   **A2 は①には無く、②（画像）にしか無い値**（T2/E0）を採っている——`map.yaml` 単体では説明できない。
 *   ⚠ **A2 の `enemyCount` は【ものかげ】による偽装**（隠れている分を計上しない効果）で、
 *   `reason` にその理由が入っている——**表示は他の値と同じ形式だが、データ上は区別できる**。
 *   他の 7 室が `roomStats` を持たないのは①（`map.yaml`）に合わせているからで、
 *   ⚠ **②（画像）には残り 7 室ぶんのラベルもある**——このサンプルは①の姿と②の姿の中間にある。
 *   （宣言側の既定値で T0/E0 に揃える）
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
