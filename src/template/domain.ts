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
import type { FieldDef, FieldType, VariantDef } from './model'

/** 行（`A`〜`Z`）。⚠ 値が言語に依らないので、そのまま選択肢に使える（§1-8-1 の線を踏まない）。 */
export const ROW_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode('A'.charCodeAt(0) + i),
)

/**
 * 座標のキー。⚠⚠ **これは新しく決めた語ではない。既に在る契約に合わせている。**
 *   - `template/outputs.ts` の `isCoordinate()` が `{row: string, col: number}` を要求する
 *   - 同梱サンプル `samples/mayoi-park.json` が既に `{"row":"C","col":3}` で書かれている
 *   ⚠ ここを `column` にすると、**フォームで入れた座標だけが本文から消える**
 *   （`formatValue` の「オブジェクトなら空文字」の枝に落ちる＝例外も警告も出ない）。
 */
export const COORDINATE_ROW_KEY = 'row'
export const COORDINATE_COLUMN_KEY = 'col'

/**
 * 辺参照のキー。⚠ 同上——サンプルが既に `{"at": {...}, "direction": "下"}` で書かれている。
 *   ⚠ **フィールドの key（`facing` 等）とは層が違う**。あちらはテンプレ定義が決める名前で、
 *   こちらは `edgeRef` という**型の中身**の名前（型が決める・利用者は宣言しない）。
 */
export const EDGE_REF_AT_KEY = 'at'
export const EDGE_REF_FACING_KEY = 'direction'

/**
 * 8 方向（**斜めを含む**・§1-3 の型の表）。⚠ 並びは「上から時計回り」。
 *
 * ⚠⚠ **値は日本語である。これは §1-8-1 の例外ではなく、そのままの適用**——
 *   §1-8-1 の表は「テンプレ定義の `name` / 表示名の**値**」を日本語と定めており、
 *   方向は `enum` の `choices`（`友好` / `敵対`）と同じ**値**であって識別子ではない。
 *
 * ⚠⚠ そして**これも新しく決めた語ではない**。同梱サンプル `samples/mayoi-park.json` が
 *   既に `"direction": "右下"` で書かれている（＝**保存された形が契約**・§1-8-2b）。
 *   英語の内部値にすると、`formatValue` がそれをそのまま本文へ出すので
 *   **生成されたパートに `downRight` と印字される**（§1-8-2c の再演）。
 */
export const DIRECTIONS = ['上', '右上', '右', '右下', '下', '左下', '左', '左上'] as const

export type Direction = (typeof DIRECTIONS)[number]

/** 選択肢 1 つ。⚠ **値と表示は別**（§1-8-1: 判別子の値は英語でも、画面は日本語）。 */
export interface Choice {
  value: string
  label: string
}

/**
 * その欄の選択肢。⚠ `direction` は「**選択肢が型で固定された `enum`**」にすぎないので、
 *   入力欄も検証も `enum` の経路をそのまま使う（型ごとの分岐を増やさない）。
 */
export function choicesOf(field: FieldDef): Choice[] {
  const values = field.type === 'direction' ? DIRECTIONS : (field.choices ?? [])
  return values.map((value) => ({ value, label: field.choiceLabels?.[value] ?? value }))
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


/* ------------------------------------------------------------------ *
 * 判別子付き共用体（`oneOf`）と参照（`ref`）— DESIGN-v0.md §1-3・§1-3-3
 * ------------------------------------------------------------------ */

/**
 * ⭐⭐ **`ref` は「枝が型で固定された `oneOf`」である。**
 *
 * ⚠ だから `ref` 専用の機構を作らない（`coordinate` / `edgeRef` が `object` の経路に乗ったのと同じ形）。
 *   違いは**枝を誰が決めるか**だけ——`oneOf` は定義が宣言し、`ref` は型が持っている。
 *
 * ⚠⚠ 語彙は**新しく決めたものではない**。§1-8-2 の「参照値」の表と、
 *   同梱サンプル `samples/mayoi-park.json` の実データ
 *   （`{"kind":"room","at":{…}}` / `{"kind":"corridor","ends":[{…},{…}]}`）に既に在る。
 */
export const REF_KIND_KEY = 'kind'

/**
 * ⚠ `ends` は**座標の対**（`[座標, 座標]`）。`array` にできない——
 *   あちらは「要素がオブジェクトで安定した `id` を持つ」契約（P0 知見 2）なので、
 *   `[{row,col},{row,col}]` を表せない。→ 内部専用の `tuple` を使う。
 *
 * ⚠ `roomElement` は**同梱サンプルに 1 件も無い**（実データでは未行使）。
 *   語彙の出所は §1-8-2 の参照値の表であって、実データではない。
 */
export const REF_VARIANTS: readonly VariantDef[] = [
  { value: 'room', label: '部屋', fields: [{ key: 'at', type: 'coordinate', label: '座標' }] },
  {
    value: 'corridor',
    label: '通路',
    fields: [{ key: 'ends', type: 'coordinate', tuple: 2, label: '両端' }],
  },
  {
    value: 'roomElement',
    label: '部屋内要素',
    fields: [
      { key: 'at', type: 'coordinate', label: '座標' },
      { key: 'elementId', type: 'string', label: '要素id' },
    ],
  },
]

/** 判別子のキー。⚠ `ref` は型が決め、`oneOf` は定義が宣言する。 */
export function discriminatorKeyOf(field: FieldDef): string {
  return field.type === 'ref' ? REF_KIND_KEY : (field.discriminator ?? '')
}

/** 枝の一覧。⚠ 同上。 */
export function variantsOf(field: FieldDef): readonly VariantDef[] {
  return field.type === 'ref' ? REF_VARIANTS : (field.variants ?? [])
}

/** 判別子付き共用体か（`oneOf` と `ref` は**同じ機構**で扱う）。 */
export function isVariantFieldType(type: FieldType): boolean {
  return type === 'oneOf' || type === 'ref'
}

/**
 * 判別子そのものの入力欄（`enum` として作る）。
 * ⚠ **値は保存され、表示は `label`**（`enemies` → 「敵の列挙」・§1-8-1）。
 */
export function discriminatorFieldOf(field: FieldDef): FieldDef {
  const variants = variantsOf(field)
  return {
    key: discriminatorKeyOf(field),
    type: 'enum',
    label: '種類',
    choices: variants.map((variant) => variant.value),
    choiceLabels: Object.fromEntries(
      variants.map((variant) => [variant.value, variant.label ?? variant.value]),
    ),
  }
}

/** 共有フィールド（どの枝でも出る）。⚠ `ref` は持たない。 */
export function sharedFieldsOf(field: FieldDef): readonly FieldDef[] {
  return field.type === 'ref' ? [] : (field.fields ?? [])
}

/**
 * ⭐ **いま画面に出る／保存される**フィールド（判別子 + 共有 + **選ばれた枝だけ**）。
 * ⚠ 選ばれていない枝は含まない——**判別子が値を定義する**ので、他の枝は値の一部ではない。
 */
export function visibleFieldsOf(field: FieldDef, value: unknown): readonly FieldDef[] {
  const selected =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)[discriminatorKeyOf(field)]
      : undefined
  const variant = variantsOf(field).find((v) => v.value === selected)
  return [discriminatorFieldOf(field), ...sharedFieldsOf(field), ...(variant?.fields ?? [])]
}

/**
 * ⚠⚠ **打ちかけの判定にだけ使う**——判別子 + 共有 + **全部の枝**。
 *
 * ⭐ 枝を切り替えても、前の枝に打った値は下書きに**残す**（画面から消えるだけ・戻せば出てくる）。
 *   → だから「打ちかけかどうか」は**全部の枝**を見ないと、
 *   **打った値が残っているのに印だけ消える**（＝下書きが空だと誤解させる）。
 * ⚠ 保存（`pruneEmpty`）と検証（`validateDraft`）は**選ばれた枝だけ**を見る。
 *   3 つの述語が別々の集合を歩くのは意図であって、揃えてはならない。
 */
export function allVariantFieldsOf(field: FieldDef): readonly FieldDef[] {
  return [
    discriminatorFieldOf(field),
    ...sharedFieldsOf(field),
    ...variantsOf(field).flatMap((variant) => variant.fields ?? []),
  ]
}
