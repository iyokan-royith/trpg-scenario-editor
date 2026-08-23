/**
 * テンプレ定義の検証（DESIGN-v0.md §2・P2 完了条件 #8）。
 *
 * ⚠⚠ **目的は「弾くこと」ではなく「どこが悪いか言うこと」**。
 *   テンプレは配布物なので、壊れた定義を掴むのは**それを書いていない人**である。
 *   → 見つけた問題は**全部集めてから**返す（最初の 1 件で止めると、直しては読ませ直す往復になる）。
 *   → メッセージには必ず **出所**（どのファイルか）と **場所**（`fields[1].型` のような道順）を入れる。
 */
import { フィールドの型の一覧, type FieldDef, type TemplateDefinition } from './model'
import type { OutputDef } from './outputs'
import { 組み込みパターン名の一覧 } from './render'

export class TemplateDefinitionError extends Error {
  readonly 出所: string
  readonly 問題: string[]

  constructor(出所: string, 問題: string[]) {
    super(`${出所} を読めませんでした:\n- ${問題.join('\n- ')}`)
    this.name = 'TemplateDefinitionError'
    this.出所 = 出所
    this.問題 = 問題
  }
}

const フォーム一覧 = ['独立章', '本文中', '図']

function 素のオブジェクトか(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function 文字列を検める(
  値: unknown,
  道順: string,
  問題: string[],
  選択肢?: readonly string[],
): void {
  if (typeof 値 !== 'string' || 値 === '') {
    問題.push(`${道順} が空か、文字列ではありません（${JSON.stringify(値)}）`)
    return
  }
  if (選択肢 && !選択肢.includes(値)) {
    問題.push(`${道順} が未知の値です（「${値}」）。使えるのは ${選択肢.join(' / ')} です`)
  }
}

function fieldsを検める(値: unknown, 問題: string[]): void {
  if (!Array.isArray(値)) {
    問題.push(`fields が配列ではありません（${JSON.stringify(値)}）`)
    return
  }
  const 見たキー = new Set<string>()
  値.forEach((field, i) => {
    const 道順 = `fields[${i}]`
    if (!素のオブジェクトか(field)) {
      問題.push(`${道順} がオブジェクトではありません（${JSON.stringify(field)}）`)
      return
    }
    文字列を検める(field.key, `${道順}.key`, 問題)
    文字列を検める(field.型, `${道順}.型`, 問題, フィールドの型の一覧)
    if (typeof field.key === 'string') {
      // ⚠ キーの重複は「値が黙って上書きされる」形で効くので、型の誤りと同じ重さで拾う。
      if (見たキー.has(field.key)) 問題.push(`${道順}.key が重複しています（「${field.key}」）`)
      見たキー.add(field.key)
    }
  })
}

function outputsを検める(値: unknown, 問題: string[]): void {
  if (!Array.isArray(値)) {
    問題.push(`outputs が配列ではありません（${JSON.stringify(値)}）`)
    return
  }
  if (値.length === 0) 問題.push('outputs が空です（パートを 1 つも生まない定義になります）')
  値.forEach((output, i) => {
    const 道順 = `outputs[${i}]`
    if (!素のオブジェクトか(output)) {
      問題.push(`${道順} がオブジェクトではありません（${JSON.stringify(output)}）`)
      return
    }
    if ('pattern' in output) {
      文字列を検める(output.pattern, `${道順}.pattern`, 問題, 組み込みパターン名の一覧())
      return
    }
    if (!('kind' in output)) {
      問題.push(`${道順} に kind も pattern もありません（どちらか一方が要ります）`)
      return
    }
    文字列を検める(output.kind, `${道順}.kind`, 問題, ['固定', '配列ごと'])
    文字列を検める(output.key, `${道順}.key`, 問題)
    文字列を検める(output.label, `${道順}.label`, 問題)
    文字列を検める(output.form, `${道順}.form`, 問題, フォーム一覧)
    if (output.kind === '配列ごと') 文字列を検める(output.source, `${道順}.source`, 問題)
  })
}

/**
 * 素のデータをテンプレ定義として検める。
 * 問題があれば `TemplateDefinitionError` を投げる（問題は全件入っている）。
 */
export function テンプレ定義を検める(値: unknown, 出所: string): TemplateDefinition {
  const 問題: string[] = []
  if (!素のオブジェクトか(値)) {
    throw new TemplateDefinitionError(出所, [
      `いちばん外側がオブジェクトではありません（${JSON.stringify(値)}）`,
    ])
  }
  文字列を検める(値.id, 'id', 問題)
  文字列を検める(値.name, 'name', 問題)
  文字列を検める(値.version, 'version', 問題)
  fieldsを検める(値.fields, 問題)
  outputsを検める(値.outputs, 問題)

  if (問題.length > 0) throw new TemplateDefinitionError(出所, 問題)

  return {
    id: 値.id as string,
    name: 値.name as string,
    version: 値.version as string,
    fields: 値.fields as FieldDef[],
    outputs: 値.outputs as OutputDef[],
  }
}
