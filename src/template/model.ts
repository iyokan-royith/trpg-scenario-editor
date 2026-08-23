/**
 * P0 検証用の最小ドキュメントモデル。
 *
 * ここで確かめたいのは「テンプレインスタンス 1 件から N 個のパートが生まれ、
 * それぞれを本文の離れた位置へ独立に配置しても、データ側の変更に追従するか」だけ。
 * 本番の型（DESIGN-v0.md）はこれより語彙が多いが、追従の成否を決める骨格は同じ。
 */

/** パートが本文でどんな形を取るか。④の横断集計は v0 の範囲外なので持たない。 */
export type PartForm = '独立章' | '本文中' | '図'

/**
 * テンプレ定義が宣言する「どんなパートを出すか」。
 * - `固定`: インスタンスごとに 1 個
 * - `配列ごと`: `source` の配列の要素数だけ生まれる
 */
export type PartDefinition =
  | { key: string; kind: '固定'; label: string; form: PartForm }
  | { key: string; kind: '配列ごと'; source: string; label: string; form: PartForm }

export interface TemplateDefinition {
  id: string
  name: string
  parts: PartDefinition[]
}

/** 配列要素は安定した id を持つ（配置の紐付けが要素の並び順に依存しないため）。 */
export interface ArrayItem {
  id: string
  [field: string]: unknown
}

export interface TemplateInstance {
  id: string
  templateId: string
  data: Record<string, unknown>
}

/** 導出したパート。ドキュメントはこれを「参照」だけで持つ（実体は持たない）。 */
export interface Part {
  instanceId: string
  /** インスタンス内で一意。配列由来は `key:itemId`。 */
  partId: string
  form: PartForm
  title: string
  body: string
}

export function partKeyOf(instanceId: string, partId: string): string {
  return `${instanceId}/${partId}`
}

/**
 * インスタンス 1 件からパート列を導出する。
 * ⚠ パートは保存されない。データが変わるたびに毎回ここから作り直される
 *    ＝ 追従が「同期処理」ではなく「導出」で保証される、が P0 の主張。
 */
export function derivePartsOf(instance: TemplateInstance, def: TemplateDefinition): Part[] {
  const parts: Part[] = []
  for (const partDef of def.parts) {
    if (partDef.kind === '固定') {
      parts.push({
        instanceId: instance.id,
        partId: partDef.key,
        form: partDef.form,
        title: partDef.label,
        body: String(instance.data[partDef.key] ?? ''),
      })
      continue
    }
    const rows = instance.data[partDef.source]
    if (!Array.isArray(rows)) continue
    for (const row of rows as ArrayItem[]) {
      parts.push({
        instanceId: instance.id,
        partId: `${partDef.key}:${row.id}`,
        form: partDef.form,
        title: `${partDef.label} ${String(row.name ?? row.id)}`,
        body: String(row.body ?? ''),
      })
    }
  }
  return parts
}
