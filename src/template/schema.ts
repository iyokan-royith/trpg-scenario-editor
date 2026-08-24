/**
 * テンプレ定義の検証（DESIGN-v0.md §2・P2 完了条件 #8）。
 *
 * ⚠⚠ **目的は「弾くこと」ではなく「どこが悪いか言うこと」**。
 *   テンプレは配布物なので、壊れた定義を掴むのは**それを書いていない人**である。
 *   → 見つけた問題は**全部集めてから**返す（最初の 1 件で止めると、直しては読ませ直す往復になる）。
 *   → メッセージには必ず **出所**（どのファイルか）と **場所**（`fields[1].型` のような道順）を入れる。
 */
import { FIELD_TYPES, type FieldDef, type FieldType, type TemplateDefinition } from './model'
import { ITEM_ID_KEY } from './form'
import {
  allVariantFieldsOf,
  discriminatorKeyOf,
  isCompositeFieldType,
  isVariantFieldType,
} from './domain'
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
function checkFields(
  value: unknown,
  problems: string[],
  prefix = 'fields',
  inArrayItem = false,
  nested = false,
): void {
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
    // ⚠⚠ **合成型（座標・辺参照）の子の形は型が決めている**（`template/domain.ts`）。
    //   宣言を黙って無視すると、書いた人は「行と列を別の形にした」つもりのまま
    //   保存形だけが型の契約どおりになる。→ 無視せず、書いた人に言う。
    if (typeof field.type === 'string' && isCompositeFieldType(field.type as FieldType)) {
      if ('fields' in field) {
        problems.push(
          `${path}.fields は書けません（${field.type} の中身は型が決めています。行と列・座標と方向は宣言しません）`,
        )
      }
    }
    // ⚠⚠ **画像の実体は `TemplateInstance.images` にフィールド名 1 段のキーで入る**（§1-4）。
    //   入れ子・配列の中に置くとキーを表せず、**選んだ画像が黙って落ちる**。
    //   → 落とすのではなく、読み込みの入口で断る。
    //   要検証[入れ子の中に画像欄を置きたい実データが出てきたら、images のキーをパス化する設計へ広げる]
    if (field.type === 'image' && nested) {
      problems.push(
        `${path} に image は置けません（画像の欄は入れ子・配列の中には作れません。いちばん外側に置いてください）`,
      )
    }
    // ⚠⚠ **内部専用のプロパティは利用者の JSON では宣言させない**（`domain.ts` が付けるもの）。
    //   黙って効かせると、保存形が型の契約から外れる経路が利用者側に開く。
    for (const internal of ['tuple', 'choiceLabels'] as const) {
      if (internal in field) {
        problems.push(`${path}.${internal} は書けません（内部でだけ使う指定です）`)
      }
    }
    // ⭐ 判別子付き共用体（`oneOf` / `ref`）。
    if (typeof field.type === 'string' && isVariantFieldType(field.type as FieldType)) {
      checkVariantField(field, path, problems)
      // ⚠⚠ 検めるのは**利用者が書いたもの**だけ。`ref` の枝は型が持っている内部宣言なので
      //   ここへ通さない（通すと `domain.ts` が付ける `tuple` を「書けません」と弾いてしまう）。
      if (field.type === 'oneOf') {
        // 枝の中のフィールドも同じ検査を通す（⚠ 入れ子扱い＝この中に image は置けない）
        const declared = Array.isArray(field.variants) ? field.variants : []
        declared.forEach((variant, i) => {
          if (isPlainObject(variant) && Array.isArray(variant.fields)) {
            checkFields(variant.fields, problems, `${path}.variants[${i}].fields`, false, true)
          }
        })
        // 共有フィールド（どの枝でも出るもの）
        if (Array.isArray(field.fields)) {
          checkFields(field.fields, problems, `${path}.fields`, false, true)
        }
      }
      return
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
      checkFields(children, problems, `${path}.fields`, field.type === 'array', true)
    }
  })
}

/**
 * `oneOf` / `ref` の宣言を検める。
 *
 * ⚠ `ref` は**枝を型が持っている**ので、宣言されていたら弾く（合成型の `fields` と同じ線）。
 * ⚠⚠ 保存形は**フラットな併合**（`{[判別子]: 値, ...共有, ...枝}`）なので、
 *   **判別子・共有・全部の枝でキーが 1 つでも重なると、下書きが壊れる**（同じキーに違う型が入る）。
 */
function checkVariantField(
  field: Record<string, unknown>,
  path: string,
  problems: string[],
): void {
  if (field.type === 'ref') {
    for (const declared of ['discriminator', 'variants'] as const) {
      if (declared in field) {
        problems.push(
          `${path}.${declared} は書けません（ref の枝は型が決めています: 部屋 / 通路 / 部屋内要素）`,
        )
      }
    }
    return
  }
  checkString(field.discriminator, `${path}.discriminator`, problems)
  const variants = field.variants
  if (!Array.isArray(variants) || variants.length === 0) {
    problems.push(`${path}.variants がありません（oneOf は枝を 1 つ以上宣言する必要があります）`)
    return
  }
  const seenValues = new Set<string>()
  variants.forEach((variant, i) => {
    const where = `${path}.variants[${i}]`
    if (!isPlainObject(variant)) {
      problems.push(`${where} がオブジェクトではありません（${JSON.stringify(variant)}）`)
      return
    }
    checkString(variant.value, `${where}.value`, problems)
    if (typeof variant.value === 'string') {
      if (seenValues.has(variant.value)) {
        problems.push(`${where}.value が重複しています（「${variant.value}」）`)
      }
      seenValues.add(variant.value)
    }
  })
  // ⚠ フラットに併合されるので、判別子・共有・全部の枝を通してキーが一意でなければならない。
  const keys = allVariantFieldsOf(field as unknown as FieldDef).map((f) => f?.key)
  const seenKeys = new Set<string>()
  for (const key of keys) {
    if (typeof key !== 'string') continue
    if (seenKeys.has(key)) {
      problems.push(
        `${path} のキー「${key}」が重複しています（判別子・共有・枝は 1 つの入れ物に併合されます）`,
      )
    }
    seenKeys.add(key)
  }
  const discriminator = discriminatorKeyOf(field as unknown as FieldDef)
  if (discriminator && keys.filter((key) => key === discriminator).length > 1) {
    problems.push(`${path}.discriminator「${discriminator}」と同じ名前のフィールドがあります`)
  }
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
