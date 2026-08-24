/**
 * ドメイン型（`coordinate` / `direction` / `edgeRef`）の**語彙**（DESIGN-v0.md §1-3・§1-3-3・§1-8-2）。
 *
 * ⚠⚠ **ここは「保存される形」の単一の真実である。**
 *   キー名（`row` / `column` / `at` / `facing`）と方向の内部値（`up` …）は
 *   `TemplateInstance.data` としてそのまま IndexedDB に残る＝**改名は純粋な rename ではない**（§1-8-2b）。
 *
 * ⭐ **`edgeRef` に新しい概念を足さない**（§1-3-3 の A 群）。
 *   `edgeRef` は `coordinate` + `direction` の**合成**であり、
 *   `coordinate` は `enum`（行）+ `integer`（列）の合成にすぎない。
 *   → 下の 2 つの `FieldDef[]` を返すだけで、入力欄も検証も刈り取りも
 *     **既存の `object` の経路がそのまま担う**（`A2右下` のような文字列に潰さない＝P4 で図が描ける）。
 */
import type { FieldDef, FieldType } from './model'

/** 行（`A`〜`Z`）。⚠ 値が言語に依らないので、そのまま選択肢に使える（§1-8-1 の線を踏まない）。 */
export const ROW_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode('A'.charCodeAt(0) + i),
)

/** 座標のキー。⚠ **保存形の契約**（§1-8-2b）。 */
export const COORDINATE_ROW_KEY = 'row'
export const COORDINATE_COLUMN_KEY = 'column'

/** 辺参照のキー。⚠ ドメインの語彙に合わせた（§1-8-2 の `位置`→`at` ／ `向き`→`facing`）。 */
export const EDGE_REF_AT_KEY = 'at'
export const EDGE_REF_FACING_KEY = 'facing'

/**
 * 8 方向（**斜めを含む**・§1-3 の型の表）。
 *
 * ⚠ 内部値は英語・画面は日本語（§1-8-1）。`fixed` / `perItem` / `section` と同じ線で、
 *   **列挙値は英語・表示は対応表を通す**（§1-8-2c: 内部の値をそのまま画面に出さない）。
 * ⚠ 並びは「上から時計回り」。画面の選択肢の順もこれをそのまま使う。
 */
export const DIRECTIONS = [
  'up',
  'upRight',
  'right',
  'downRight',
  'down',
  'downLeft',
  'left',
  'upLeft',
] as const

export type Direction = (typeof DIRECTIONS)[number]

export const DIRECTION_LABELS: Record<Direction, string> = {
  up: '上',
  upRight: '右上',
  right: '右',
  downRight: '右下',
  down: '下',
  downLeft: '左下',
  left: '左',
  upLeft: '左上',
}

// ⚠ 方向を足したのに表を直し忘れると、画面に `downRight` が出る（§1-8-2c の再演）。
//   実行時に 1 度だけ気づけるようにしておく（テストが最初に踏む）。
for (const direction of DIRECTIONS) {
  if (!DIRECTION_LABELS[direction]) throw new Error(`DIRECTION_LABELS に「${direction}」がありません`)
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)
}

/**
 * `coordinate` の中身＝行（`A`〜`Z` の選択）と列（1 以上の整数）。
 * ⚠ **`enum` と `integer` そのもの**なので、入力欄・検証・刈り取りを新しく書かない。
 */
export const COORDINATE_FIELDS: readonly FieldDef[] = [
  { key: COORDINATE_ROW_KEY, type: 'enum', label: '行', choices: [...ROW_LETTERS] },
  { key: COORDINATE_COLUMN_KEY, type: 'integer', label: '列' },
]

/** `edgeRef` の中身＝座標と方向。⚠ ここも合成だけ（独自の値表現を持たない）。 */
export const EDGE_REF_FIELDS: readonly FieldDef[] = [
  { key: EDGE_REF_AT_KEY, type: 'coordinate', label: '座標' },
  { key: EDGE_REF_FACING_KEY, type: 'direction', label: '方向' },
]

/**
 * ⭐ **合成型の子フィールドは定義側から与えられない**（型が決めている）。
 *
 * ⚠⚠ `field.fields ?? COMPOSITE[type]` の順に書いてはならない。
 *   利用者が `{ "type": "coordinate", "fields": [...] }` を持ち込んだ瞬間、
 *   行と列が**黙って別の構造に置き換わり**、保存形が型の契約から外れる
 *   （＝P4 の図が描けなくなる・`ref` を文字列に潰すのと同じ壊れ方）。
 *   → **合成型では定義の `fields` を見ない。** 宣言されていたら
 *     `template/schema.ts` が読み込みの入口で弾く（黙って無視しない）。
 */
const COMPOSITE_FIELDS: Partial<Record<FieldType, readonly FieldDef[]>> = {
  coordinate: COORDINATE_FIELDS,
  edgeRef: EDGE_REF_FIELDS,
}

/** その型が「型そのものが子の形を決めている」合成型か。 */
export function isCompositeFieldType(type: FieldType): boolean {
  return COMPOSITE_FIELDS[type] !== undefined
}

/**
 * 子フィールドの**単一の真実**。合成型は型が決めた形、`object` / `array` は定義が決めた形。
 * ⚠ フォームの描画・下書きの初期化・検証・刈り取りが**全部これを通る**
 *   （2 箇所に分かれると、画面に出ている欄と保存される形がずれる）。
 */
export function childFieldsOf(field: FieldDef): readonly FieldDef[] {
  return COMPOSITE_FIELDS[field.type] ?? field.fields ?? []
}
