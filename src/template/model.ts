/**
 * テンプレ層の型（DESIGN-v0.md 1-3 / 1-4）と、パートの導出。
 *
 * ⚠ 4 層の向きが一方向であること自体が設計（1-1）:
 *   定義 → インスタンス → （導出）パート ← 参照だけ ← ドキュメント。
 *   ドキュメントはパートを**所有しない**ので、「配置しても紐付けが切れない」が構造的に保証される。
 */
import type { OutputDef } from './outputs'
import type { LiquidOutputDef } from './liquid/outputs'
import { isPatternOutput } from './outputs'
import { builtinPatterns } from './render'

/** パートが本文でどんな形を取るか。④の横断集計は v0 の範囲外なので持たない（S4）。 */
export type PartForm = 'section' | 'inline' | 'figure'

/**
 * フォームに出る入力欄の型（1-3 の表）。
 * ⚠ v0 では **`derived` を除く 13 種すべてがフォームから入力できる**（2026-08-24・C 群まで完了）。
 *   `derived` は**これからも尋ねない**（導出値なので・`NEVER_ASKED_FIELD_TYPES`）。
 *   → 単一の真実は `template/form.ts` の `SUPPORTED_FIELD_TYPES` / `NEVER_ASKED_FIELD_TYPES`。
 *   ⚠⚠ **2 つの集合の和が、この一覧と一致していなければならない**（`form.spec.ts` が固定）。
 *   どちらにも入らない型を足すと、その欄は**画面から黙って消える**。
 */
export const FIELD_TYPES = [
  'string',
  'integer',
  'boolean',
  'text',
  'enum',
  'array',
  'object',
  'coordinate',
  'direction',
  'edgeRef',
  'ref',
  'oneOf',
  'image',
  'derived',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * `oneOf`（判別子付き共用体）の枝 1 本（1-3・1-3-3c）。
 *
 * ⚠ 保存形は**フラット**である——`{ [discriminator]: value, ...共有, ...この枝の fields }`。
 *   実物がそうなっている（`{name:'坂道', higherEnd:{…}}` / `{kind:'友好', shape:'enemies', enemies:[…]}`）。
 */
export interface VariantDef {
  /** 判別子に入る値。⚠ **保存される**（§1-8-2b） */
  value: string
  /** 選択肢の表示名。⚠ 省略時は `value` を出す（`shape` のように値が英語のときに使う） */
  label?: string
  /** この枝でだけ出るフィールド */
  fields?: FieldDef[]
}

export interface FieldDef {
  key: string
  type: FieldType
  /**
   * フォームに出す表示名。⚠ **値であって識別子ではない**ので日本語でよい（§1-8-1 の表の最終行）。
   * 省略時は `key` をそのまま出す（英語が出るが、黙って空になるよりはよい）。
   */
  label?: string
  /**
   * `enum` の選択肢。⚠ **値なので日本語**（`友好` / `敵対` / `坂道` …）。
   * 判別子は英語・列挙値は日本語、の線引きは §1-8-2 の注記どおり。
   */
  choices?: string[]
  /**
   * `object` の子フィールド／`array` の**要素**の形。
   *
   * ⚠ **`array` は「オブジェクトの配列」に限る。** 実物（`spike/sample/map.yaml` 由来のサンプル）の
   *   配列は `entrances` / `corridors` / `rooms` / `traps` / `enemies` まですべて要素がオブジェクトで、
   *   スカラーの配列は 1 つも無い。**要素に安定した `id` を持たせる必要がある**（P0 知見 2）ことからも、
   *   要素はオブジェクトでなければならない——スカラーには `id` を付ける場所が無い。
   */
  fields?: FieldDef[]
  /**
   * `oneOf` の判別子のキー。⚠ **保存形に現れる**（罠は `name`・遭遇は `shape`）。
   * ⚠ `ref` は型が決めている（`kind`）ので宣言しない。
   */
  discriminator?: string
  /** `oneOf` の枝。⚠ `ref` は型が決めている（`room` / `corridor` / `roomElement`）ので宣言しない。 */
  variants?: VariantDef[]
  /**
   * ⚠⚠ **内部専用**（利用者の JSON では宣言できない・`schema.ts` が弾く）。
   *   「この欄は同じ型を n 個持つ（並びに意味がある固定長）」。
   *   `ref` の `corridor` が持つ `ends: [座標, 座標]` のためだけに在る——
   *   `array` は要素がオブジェクトで `id` を持つ契約なので、**座標の対を表せない**。
   */
  tuple?: number
  /**
   * ⚠⚠ **内部専用**（同上）。`enum` の値 → 表示名。
   *   判別子の値が英語のとき（`enemies` → 「敵の列挙」）に、画面へ日本語を出すために使う（§1-8-1）。
   */
  choiceLabels?: Record<string, string>
}

export interface TemplateDefinition {
  /** 逆ドメイン風の一意名（衝突を避ける） */
  id: string
  name: string
  version: string
  fields: FieldDef[]
  outputs: OutputDef[]
  /**
   * ⭐ テンプレ文字列による出力（DESIGN §1-13-1c・移行 P-a）。
   *
   * ⚠⚠ **`outputs` と並存する 2 本目の経路であって、置き換えではない。**
   *   `outputs` が同期（`derivePartsOf`）・こちらが非同期（`deriveLiquidPartsOf`）なので
   *   union にまとめず**兄弟のフィールド**にしてある。理由と消し方は `liquid/outputs.ts` の冒頭。
   *   ⚠ **無いことが普通**（同梱テンプレ 2 本はまだ持っていない）。
   */
  liquidOutputs?: LiquidOutputDef[]
}

/** 配列要素は安定した id を持つ（配置の紐付けが要素の並び順に依存しないため）。 */
export interface ArrayItem {
  id: string
  [field: string]: unknown
}

export interface TemplateInstance {
  id: string
  templateId: string
  /** 定義の fields に沿った値 */
  data: Record<string, unknown>
  /** 画像の実体はここ（IndexedDB に入る）。キーはフィールド名 */
  images: Record<string, Blob>
}

/**
 * パートの中身を作る要素（1-6-2 の `inline`）。
 *
 * ⚠⚠ **DESIGN 1-4 は `bodyHtml: string` と書いているが、そのままでは Blob を載せられない。**
 *   画像の実体は `TemplateInstance.images` にあり、文字列に詰めるには
 *   object URL か data URL へ焼く必要がある＝**導出値をデータ側へ持たせる**ことになる
 *   （P0 知見 1 が禁じている型）。
 *   → 1-6-2 が既に定義していた `inline-seq`（`text | field-ref | image-ref | html`）を
 *     **内部表現としてそのまま採る**。`bodyHtml` の「自由 HTML」は、
 *     自由 HTML パターンを入れるときに `{ 種別: 'HTML' }` としてこの union に合流する
 *     （そのとき 1-4 の iframe sandbox 契約が効く）。
 */
export type Inline = { kind: 'text'; text: string } | { kind: 'image'; image: Blob; alt: string }

/** 導出したパート。ドキュメントはこれを「参照」だけで持つ（実体は持たない）。 */
export interface Part {
  instanceId: string
  /** インスタンス内で一意。配列由来は `key:itemId`。 */
  partId: string
  form: PartForm
  title: string
  body: Inline[]
}

export function partKeyOf(instanceId: string, partId: string): string {
  return `${instanceId}/${partId}`
}

/**
 * その定義が「実体を差し替えられる画像」を持つなら、そのフィールドのキー。
 *
 * ⚠⚠ **これは画像テンプレを名指しするための関数ではない**（それは §1-7-2 が禁じている）。
 *   宣言（`fields`）を読んで「`image` 型の欄があるか」を聞いているだけなので、
 *   利用者が持ち込む定義でも同じように効く。
 *
 * ⚠ **無いことに意味がある**——「差し替え」を出してよいかの判定がこれ。
 *   これを見ずに差し替えを出すと、画像を持たない素材に実体を書き込める
 *   （画面には何も起きないのに保存だけされる、という壊れ方をする）。
 *
 * ⚠ 先頭の 1 つだけを返す。v0 の宣言はどれも画像欄を高々 1 つしか持たない。
 *   複数持つ定義が出たら「どれを差し替えるか」を利用者に聞く必要があり、それは別の設計判断になる。
 */
export function imageFieldKeyOf(def: TemplateDefinition): string | undefined {
  return def.fields.find((field) => field.type === 'image')?.key
}

/** パートの中身を、表示用の 1 本のテキストへ畳む（一覧・テストの照合用）。 */
export function inlineText(body: Inline[]): string {
  return body.map((item) => (item.kind === 'text' ? item.text : item.alt)).join('')
}

/**
 * インスタンス 1 件からパート列を導出する。
 * ⚠ パートは保存されない。データが変わるたびに毎回ここから作り直される
 *    ＝ 追従が「同期処理」ではなく「導出」で保証される、が P0 の主張。
 */
export function derivePartsOf(instance: TemplateInstance, def: TemplateDefinition): Part[] {
  const parts: Part[] = []
  for (const output of def.outputs) {
    if (isPatternOutput(output)) {
      const render = builtinPatterns[output.pattern]
      if (!render) {
        // ⚠ 握りつぶさない。定義の検証（template/schema.ts）を通っていれば到達しない経路で、
        //   ここに来たなら「検証を通さずに登録された定義がある」という別の不具合である。
        throw new Error(
          `テンプレ定義「${def.id}」の outputs に未知のパターン「${output.pattern}」があります`,
        )
      }
      parts.push(...render(instance, def))
      continue
    }
    if (output.kind === 'fixed') {
      parts.push({
        instanceId: instance.id,
        partId: output.key,
        form: output.form,
        title: output.label,
        body: [{ kind: 'text', text: String(instance.data[output.key] ?? '') }],
      })
      continue
    }
    const rows = instance.data[output.over]
    if (!Array.isArray(rows)) continue
    for (const row of rows as ArrayItem[]) {
      parts.push({
        instanceId: instance.id,
        partId: `${output.key}:${row.id}`,
        form: output.form,
        title: `${output.label} ${String(row.name ?? row.id)}`,
        body: [{ kind: 'text', text: String(row.body ?? '') }],
      })
    }
  }
  return parts
}
