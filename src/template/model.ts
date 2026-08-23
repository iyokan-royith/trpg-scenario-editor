/**
 * テンプレ層の型（DESIGN-v0.md 1-3 / 1-4）と、パートの導出。
 *
 * ⚠ 4 層の向きが一方向であること自体が設計（1-1）:
 *   定義 → インスタンス → （導出）パート ← 参照だけ ← ドキュメント。
 *   ドキュメントはパートを**所有しない**ので、「配置しても紐付けが切れない」が構造的に保証される。
 */
import type { OutputDef } from './outputs'
import { 組み込みパターン指定か } from './outputs'
import { 組み込みパターン } from './render'

/** パートが本文でどんな形を取るか。④の横断集計は v0 の範囲外なので持たない（S4）。 */
export type PartForm = '独立章' | '本文中' | '図'

/**
 * フォームに出る入力欄の型（1-3 の表）。
 * ⚠ v0 で**フォームまで実装済み**なのはスカラー（`文字列` / `画像`）だけ。
 *   残りは型として宣言されているが、入力 UI は後続フェーズの責務。
 */
export const フィールドの型の一覧 = [
  '文字列',
  '整数',
  '真偽',
  '長文',
  '列挙',
  '配列',
  '入れ子',
  '座標',
  '方向',
  '辺参照',
  '参照',
  'いずれか',
  '画像',
  '導出値',
] as const

export type FieldType = (typeof フィールドの型の一覧)[number]

export interface FieldDef {
  key: string
  型: FieldType
}

export interface TemplateDefinition {
  /** 逆ドメイン風の一意名（衝突を避ける） */
  id: string
  name: string
  version: string
  fields: FieldDef[]
  outputs: OutputDef[]
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
export type Inline = { 種別: 'テキスト'; 文: string } | { 種別: '画像'; 画像: Blob; 代替文: string }

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

/** パートの中身を、表示用の 1 本のテキストへ畳む（一覧・テストの照合用）。 */
export function インラインの文(body: Inline[]): string {
  return body.map((item) => (item.種別 === 'テキスト' ? item.文 : item.代替文)).join('')
}

/**
 * インスタンス 1 件からパート列を導出する。
 * ⚠ パートは保存されない。データが変わるたびに毎回ここから作り直される
 *    ＝ 追従が「同期処理」ではなく「導出」で保証される、が P0 の主張。
 */
export function derivePartsOf(instance: TemplateInstance, def: TemplateDefinition): Part[] {
  const parts: Part[] = []
  for (const output of def.outputs) {
    if (組み込みパターン指定か(output)) {
      const 描く = 組み込みパターン[output.pattern]
      if (!描く) {
        // ⚠ 握りつぶさない。定義の検証（template/schema.ts）を通っていれば到達しない経路で、
        //   ここに来たなら「検証を通さずに登録された定義がある」という別の不具合である。
        throw new Error(
          `テンプレ定義「${def.id}」の outputs に未知のパターン「${output.pattern}」があります`,
        )
      }
      parts.push(...描く(instance, def))
      continue
    }
    if (output.kind === '固定') {
      parts.push({
        instanceId: instance.id,
        partId: output.key,
        form: output.form,
        title: output.label,
        body: [{ 種別: 'テキスト', 文: String(instance.data[output.key] ?? '') }],
      })
      continue
    }
    const rows = instance.data[output.source]
    if (!Array.isArray(rows)) continue
    for (const row of rows as ArrayItem[]) {
      parts.push({
        instanceId: instance.id,
        partId: `${output.key}:${row.id}`,
        form: output.form,
        title: `${output.label} ${String(row.name ?? row.id)}`,
        body: [{ 種別: 'テキスト', 文: String(row.body ?? '') }],
      })
    }
  }
  return parts
}
