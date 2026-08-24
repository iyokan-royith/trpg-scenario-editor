/**
 * テンプレ定義の検証（DESIGN-v0.md §2・P2 完了条件 #8）。
 *
 * ⚠⚠ **目的は「弾くこと」ではなく「どこが悪いか言うこと」**。
 *   テンプレは配布物なので、壊れた定義を掴むのは**それを書いていない人**である。
 *   → 見つけた問題は**全部集めてから**返す（最初の 1 件で止めると、直しては読ませ直す往復になる）。
 *   → メッセージには必ず **出所**（どのファイルか）と **場所**（`fields[1].型` のような道順）を入れる。
 */
import { FIELD_TYPES, type FieldDef, type TemplateDefinition } from './model'
import { ITEM_ID_KEY } from './form'
import type { OutputDef } from './outputs'
import { builtinPatternNames } from './render'

export class TemplateDefinitionError extends Error {
  readonly source: string
  readonly problems: string[]

  constructor(source: string, problems: string[]) {
    super(`${source} を読めませんでした:\n- ${problems.join('\n- ')}`)
    this.name = 'TemplateDefinitionError'
    this.source = source
    this.problems = problems
  }
}

const PART_FORMS = ['section', 'inline', 'figure']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkString(
  value: unknown,
  path: string,
  problems: string[],
  choices?: readonly string[],
): void {
  if (typeof value !== 'string' || value === '') {
    problems.push(`${path} が空か、文字列ではありません（${JSON.stringify(value)}）`)
    return
  }
  if (choices && !choices.includes(value)) {
    problems.push(`${path} が未知の値です（「${value}」）。使えるのは ${choices.join(' / ')} です`)
  }
}

/**
 * @param prefix 親からの道順（`fields` / `fields[3].fields`）。**入れ子でも「どこが」を言えるようにする。**
 * @param inArrayItem 配列の**要素**の定義かどうか（`id` が予約されるのはここだけ）
 */
function checkFields(value: unknown, problems: string[], prefix = 'fields', inArrayItem = false): void {
  if (!Array.isArray(value)) {
    problems.push(`${prefix} が配列ではありません（${JSON.stringify(value)}）`)
    return
  }
  const seenKeys = new Set<string>()
  value.forEach((field, i) => {
    const path = `${prefix}[${i}]`
    if (!isPlainObject(field)) {
      problems.push(`${path} がオブジェクトではありません（${JSON.stringify(field)}）`)
      return
    }
    checkString(field.key, `${path}.key`, problems)
    checkString(field.type, `${path}.type`, problems, FIELD_TYPES)
    if (typeof field.key === 'string') {
      // ⚠ キーの重複は「値が黙って上書きされる」形で効くので、型の誤りと同じ重さで拾う。
      if (seenKeys.has(field.key)) problems.push(`${path}.key が重複しています（「${field.key}」）`)
      seenKeys.add(field.key)
      // ⚠⚠ 配列要素の `id` は採番したものが入る予約語（P0 知見 2）。
      //   宣言を許すと入力値が id を上書きし、**要素を 1 件消すと後ろ全部の配置がずれる**。
      if (inArrayItem && field.key === ITEM_ID_KEY) {
        problems.push(
          `${path}.key に「${ITEM_ID_KEY}」は使えません（配列の要素を見分けるために予約されています）`,
        )
      }
    }
    // ⚠ 型ごとに「無いと入力欄が作れないもの」を見る。
    //   黙って空のフォームを出すと、テンプレを書いた人ではなく**使う人**が原因不明の空欄を掴む。
    if (field.type === 'enum') {
      const choices = field.choices
      if (!Array.isArray(choices) || choices.length === 0) {
        problems.push(`${path}.choices がありません（enum は選択肢の一覧が要ります）`)
      } else {
        choices.forEach((choice, j) => checkString(choice, `${path}.choices[${j}]`, problems))
      }
    }
    if (field.type === 'object' || field.type === 'array') {
      const children = field.fields
      if (!Array.isArray(children) || children.length === 0) {
        problems.push(
          field.type === 'array'
            ? `${path}.fields がありません（array は要素 1 件の形を宣言する必要があります）`
            : `${path}.fields がありません（object は子フィールドの宣言が要ります）`,
        )
        return
      }
      checkFields(children, problems, `${path}.fields`, field.type === 'array')
    }
  })
}

function checkOutputs(value: unknown, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push(`outputs が配列ではありません（${JSON.stringify(value)}）`)
    return
  }
  if (value.length === 0) problems.push('outputs が空です（パートを 1 つも生まない定義になります）')
  value.forEach((output, i) => {
    const path = `outputs[${i}]`
    if (!isPlainObject(output)) {
      problems.push(`${path} がオブジェクトではありません（${JSON.stringify(output)}）`)
      return
    }
    if ('pattern' in output) {
      checkString(output.pattern, `${path}.pattern`, problems, builtinPatternNames())
      return
    }
    if (!('kind' in output)) {
      problems.push(`${path} に kind も pattern もありません（どちらか一方が要ります）`)
      return
    }
    checkString(output.kind, `${path}.kind`, problems, ['fixed', 'perItem'])
    checkString(output.key, `${path}.key`, problems)
    checkString(output.label, `${path}.label`, problems)
    checkString(output.form, `${path}.form`, problems, PART_FORMS)
    if (output.kind === 'perItem') checkString(output.source, `${path}.source`, problems)
  })
}

/**
 * 素のデータをテンプレ定義として検める。
 * 問題があれば `TemplateDefinitionError` を投げる（問題は全件入っている）。
 */
export function validateTemplateDefinition(value: unknown, source: string): TemplateDefinition {
  const problems: string[] = []
  if (!isPlainObject(value)) {
    throw new TemplateDefinitionError(source, [
      `いちばん外側がオブジェクトではありません（${JSON.stringify(value)}）`,
    ])
  }
  checkString(value.id, 'id', problems)
  checkString(value.name, 'name', problems)
  checkString(value.version, 'version', problems)
  checkFields(value.fields, problems)
  checkOutputs(value.outputs, problems)

  if (problems.length > 0) throw new TemplateDefinitionError(source, problems)

  return {
    id: value.id as string,
    name: value.name as string,
    version: value.version as string,
    fields: value.fields as FieldDef[],
    outputs: value.outputs as OutputDef[],
  }
}
