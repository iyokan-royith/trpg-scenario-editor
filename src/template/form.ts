/**
 * テンプレのフォーム（DESIGN-v0.md §4 の P2 完了条件 #2）の**純ロジック**。
 *
 * ⚠ ここに UI は無い。`ui/TemplateForm.vue` / `ui/FieldEditor.vue` は
 *   「何を出すか」をここに聞き、「どう出すか」だけを持つ。
 *   → 下書きの初期化・空値の刈り取り・要素 id の採番は**マウント無しで検査できる**。
 */
import { FIELD_TYPES, type ArrayItem, type FieldDef, type FieldType } from './model'
import {
  COORDINATE_COLUMN_KEY,
  COORDINATE_ROW_KEY,
  EDGE_REF_FACING_KEY,
  EDGE_REF_AT_KEY,
  ROW_LETTERS,
  childFieldsOf,
  isDirection,
} from './domain'

/**
 * ⭐ フォームで**入力できる**型（この切れ目の範囲）。
 *
 * ⚠ 残るのは `ref` / `oneOf` の 2 種で、これは「**まだ**入力できない」（判断待ち・§1-3-3a）。
 *   `derived` は下の `NEVER_ASKED_FIELD_TYPES` を参照——**別の理由で欄が出ない**ので混ぜない。
 *   同梱の迷宮マップ定義は両方を実際に含んでいるので、
 *   **同梱品を開くこと自体がこの性質の検査**になっている。
 */
export const SUPPORTED_FIELD_TYPES = [
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
  'image',
] as const satisfies readonly FieldType[]

export type SupportedFieldType = (typeof SUPPORTED_FIELD_TYPES)[number]

export function isSupportedFieldType(type: FieldType): type is SupportedFieldType {
  return (SUPPORTED_FIELD_TYPES as readonly FieldType[]).includes(type)
}

/**
 * ⭐⭐ **入力欄を出さない型。ただし「まだ」ではなく「これからも尋ねない」**（§1-3-3）。
 *
 * ⚠⚠ `SUPPORTED_FIELD_TYPES` の否定で表さないのが要点。
 *   導出値は**導出されるから導出値**であって、人が入力するものではない
 *   （P0 知見 1: 導出したものをデータ側に持たせない）。
 *   「まだ入力できません」と出すと、**待っていれば入力できるようになる**という嘘になる。
 */
export const NEVER_ASKED_FIELD_TYPES = ['derived'] as const satisfies readonly FieldType[]

export function isNeverAskedFieldType(type: FieldType): boolean {
  return (NEVER_ASKED_FIELD_TYPES as readonly FieldType[]).includes(type)
}

/**
 * 型の**日本語名**（§1-8-2 の対応表の逆引き）。
 *
 * ⚠⚠ **内部の列挙値をそのまま画面に出さない**（§1-8-2c）。`form` の値（`section` 等）で
 *   一度これを踏んでいる。「まだ入力できません」の文面に `coordinate` と出ると、
 *   識別子は英語・表示は日本語（§1-8-1）の線を UI 側で破ることになる。
 */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: '文字列',
  integer: '整数',
  boolean: '真偽',
  text: '長文',
  enum: '列挙',
  array: '配列',
  object: '入れ子',
  coordinate: '座標',
  direction: '方向',
  edgeRef: '辺参照',
  ref: '参照',
  oneOf: 'いずれか',
  image: '画像',
  derived: '導出値',
}

// ⚠ 型が増えたときに対応表へ足し忘れると、画面に英語が漏れる（§1-8-2c の再演）。
//   実行時に 1 度だけ気づけるようにしておく（テストが最初に踏む）。
for (const type of FIELD_TYPES) {
  if (!FIELD_TYPE_LABELS[type]) throw new Error(`FIELD_TYPE_LABELS に「${type}」がありません`)
}

/** フォームに出す名前。⚠ 無ければ `key`（黙って空欄にしない）。 */
export function labelOf(field: FieldDef): string {
  return field.label ?? field.key
}

/**
 * ⚠⚠ **配列要素の識別子は `id` で予約されている**（P0 知見 2）。
 *   定義側が `id` という名前のフィールドを宣言すると、採番した id が上書きされ、
 *   **要素を 1 つ消すと後ろ全部の配置がずれる**（＝添字にしたのと同じ事故）。
 *   → `template/schema.ts` が定義の検証で弾く。ここはその名前の単一の真実。
 */
export const ITEM_ID_KEY = 'id'

let itemSequence = 0

/**
 * 配列要素の id を採番する（P0 知見 2）。
 * ⚠ **添字にしない。** 添字だと `partId`（本文に保存される）が並び順に依存し、
 *   要素を 1 件消しただけで後ろ全部の配置が別のパートを指す。
 */
export function newItemId(): string {
  itemSequence += 1
  return `item-${Date.now().toString(36)}-${itemSequence}`
}

/**
 * 空の下書きの値（型ごと）。
 *
 * ⚠ 未対応の型は `undefined` を返す＝**下書きにキーを作らない**。
 *   入力できないものの空値を作ると、保存したときに「入力していないのに値がある」データになる。
 */
function blankValueOf(field: FieldDef): unknown {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'enum':
    // ⚠ 方向は「選択肢が固定された `enum`」。空文字＝選んでいない。
    case 'direction':
      return ''
    case 'integer':
      // ⚠ `0` にしない。0 は「入力された 0」と区別が付かなくなる（下の `pruneEmpty` も参照）。
      return null
    case 'boolean':
      return false
    case 'array':
      return []
    case 'image':
      // ⚠ 実体（Blob）は `data` ではなく `TemplateInstance.images` へ行く（§1-4 / §1-7-2）。
      //   下書きの間だけここに置き、保存時に `collectImages()` が取り出す。
      return null
    case 'object':
    case 'coordinate':
    case 'edgeRef':
      // ⚠ 合成型の子は**型が決めている**（定義の `fields` は見ない・`domain.ts` を参照）。
      return createDraft(childFieldsOf(field))
    default:
      return undefined
  }
}

/** フォームの下書き（＝入力中の入れ物）を作る。 */
export function createDraft(fields: readonly FieldDef[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {}
  for (const field of fields) {
    const blank = blankValueOf(field)
    if (blank !== undefined) draft[field.key] = blank
  }
  return draft
}

/** 配列に足す要素 1 件。⚠ **id を必ず持つ**（P0 知見 2）。 */
export function createArrayItem(fields: readonly FieldDef[]): ArrayItem {
  return { ...createDraft(fields), [ITEM_ID_KEY]: newItemId() } as ArrayItem
}

/** 下書きの中の「オブジェクトらしき値」。⚠ 型が合わなければ空として扱う（落とさない）。 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 未入力（空文字・`null`・`undefined`）か。⚠ `0` と `false` は**入力された値**なので含めない。 */
function isBlankScalar(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

/**
 * 座標の状態。⚠ **「空」と「半分だけ」と「揃っている」の 3 つを区別する**のが要点で、
 *   これを 2 値（空か否か）にすると、行だけ入れた座標が黙って保存される。
 */
function coordinateState(value: unknown): 'blank' | 'partial' | 'complete' {
  const record = asRecord(value)
  const row = record[COORDINATE_ROW_KEY]
  const column = record[COORDINATE_COLUMN_KEY]
  const rowBlank = isBlankScalar(row)
  const columnBlank = isBlankScalar(column)
  if (rowBlank && columnBlank) return 'blank'
  if (rowBlank || columnBlank) return 'partial'
  return 'complete'
}

/** 辺参照の状態（座標と方向の合成なので、両方が揃って初めて `complete`）。 */
function edgeRefState(value: unknown): 'blank' | 'partial' | 'complete' {
  const record = asRecord(value)
  const at = coordinateState(record[EDGE_REF_AT_KEY])
  const facingBlank = isBlankScalar(record[EDGE_REF_FACING_KEY])
  if (at === 'blank' && facingBlank) return 'blank'
  if (at === 'complete' && !facingBlank) return 'complete'
  return 'partial'
}

/**
 * ⭐ 下書きを保存してよいかを調べる（§1-3-1 の決定 4）。
 *
 * ⚠⚠ **黙って値を変えない**のが要点。`integer` に `3.5` が来たとき、
 *   `Math.trunc` で `3` にするのは「利用者が打っていない値を保存する」ことであり、
 *   この設計書が繰り返し警告している型である。→ **保存せず、何がいけないかを言う。**
 *
 * ⚠ 空欄（`null`）は誤りではない。未入力は `pruneEmpty` が書かないだけで、
 *   ここで弾くと宣言側の既定値（`fieldRef.default`）へ行けなくなる（§1-6-10 の T0/E0）。
 *
 * ⚠ 出るのは**人が読む文**なので日本語・`label` で呼ぶ（§1-8-1 / §1-8-2c）。
 *   入れ子と配列は「どこの話か」を前に積む——`もちもの 2 件目の「重さ」` のように
 *   **場所が言えないと、画面のどの欄を直せばよいか分からない**。
 *
 * @param path 呼び出し側は渡さない（再帰で「ここまでの場所」を積むための引数）
 * @returns 誤りの説明。**空配列なら保存してよい**
 */
export function validateDraft(
  fields: readonly FieldDef[],
  draft: Record<string, unknown>,
  path: string[] = [],
): string[] {
  const errors: string[] = []
  const where = (label: string) =>
    path.length === 0 ? `「${label}」` : `${path.join('')}の「${label}」`

  for (const field of fields) {
    const value = draft[field.key]
    const label = labelOf(field)
    switch (field.type) {
      case 'integer': {
        // 未入力（null / undefined / 空文字）は誤りではない。
        if (value === null || value === undefined || value === '') break
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${where(label)}は数で入れてください`)
        } else if (!Number.isInteger(value)) {
          errors.push(`${where(label)}は整数で入れてください（${value} は整数ではありません）`)
        }
        break
      }
      case 'coordinate': {
        // ⚠ 子（行＝enum・列＝integer）の検査は既存の経路がやる。ここは**合成としての整合**だけ。
        errors.push(...validateDraft(childFieldsOf(field), asRecord(value), [...path, `「${label}」`]))
        const state = coordinateState(value)
        if (state === 'partial') {
          errors.push(`${where(label)}は行と列の両方を入れてください`)
          break
        }
        if (state === 'blank') break
        const record = asRecord(value)
        const row = record[COORDINATE_ROW_KEY]
        const column = record[COORDINATE_COLUMN_KEY]
        if (typeof row !== 'string' || !ROW_LETTERS.includes(row)) {
          errors.push(`${where(label)}の行は A〜Z で入れてください`)
        }
        // ⚠ 整数かどうかは子の検査が言うので、ここでは重ねて言わない（同じ誤りを 2 行出さない）。
        if (typeof column === 'number' && Number.isInteger(column) && column < 1) {
          errors.push(`${where(label)}の列は 1 以上で入れてください`)
        }
        break
      }
      case 'direction': {
        if (isBlankScalar(value)) break
        // ⚠ 画面の選択肢からは出ない値。**保存済みデータ**や持ち込みの定義から来うる。
        //   ⚠⚠ 8 方向の綴りは `domain.ts` が単一の真実（サンプルと同じ語彙）。
        if (!isDirection(value)) errors.push(`${where(label)}に知らない向きが入っています`)
        break
      }
      case 'edgeRef': {
        errors.push(...validateDraft(childFieldsOf(field), asRecord(value), [...path, `「${label}」`]))
        // ⚠⚠ 座標だけ・方向だけの辺参照は「辺」を指せない（＝P4 で線が引けない）。
        if (edgeRefState(value) === 'partial') {
          errors.push(`${where(label)}は座標と方向の両方を入れてください`)
        }
        break
      }
      case 'image': {
        if (value === null || value === undefined) break
        // ⚠ 選び直しの経路が壊れて別のものが入った場合に、保存の手前で止める。
        if (!(value instanceof Blob)) errors.push(`${where(label)}に選んだファイルを読めませんでした`)
        break
      }
      case 'object': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) break
        errors.push(
          ...validateDraft(childFieldsOf(field), value as Record<string, unknown>, [
            ...path,
            `「${label}」`,
          ]),
        )
        break
      }
      case 'array': {
        if (!Array.isArray(value)) break
        value.forEach((item, index) => {
          if (typeof item !== 'object' || item === null) return
          errors.push(
            ...validateDraft(childFieldsOf(field), item as Record<string, unknown>, [
              ...path,
              // ⚠ 添字ではなく「何件目」。画面の `field__itemNo` と同じ数え方にする。
              `${label} ${index + 1} 件目`,
            ]),
          )
        })
        break
      }
      default:
        break
    }
  }
  return errors
}

/**
 * ⭐ 下書きに「打った値」が入っているか（DESIGN-v0.md §1-9-2 の**未保存の印**）。
 *
 * ⚠⚠ **`pruneEmpty()` の結果では代用できない。** あちらは `array` と `boolean` を
 *   **空でも必ず書く**（空配列も入力の結果・`false` も入力された値、という別の契約）ので、
 *   配列や真偽の欄を持つ定義では**フォームを開いた瞬間から「値がある」**になる。
 *   → 印が最初から点いていれば、それは「隠れているだけ」を知らせる印として機能しない。
 *
 * ⚠ ここは「空の下書き（`createDraft`）と違うか」だけを見る。**保存してよいかは見ない**
 *   （それは `validateDraft()` の責務）。
 */
export function isDraftDirty(fields: readonly FieldDef[], draft: Record<string, unknown>): boolean {
  return fields.some((field) => {
    const value = draft[field.key]
    switch (field.type) {
      case 'string':
      case 'text':
      case 'enum':
      case 'direction':
        // ⚠ 空白だけは打っていないのと同じに扱う（`pruneEmpty` の trim と同じ線）。
        return typeof value === 'string' && value.trim() !== ''
      case 'integer':
        // ⚠ 数として正しいかは見ない。`3.5` を打ちかけて本文へ移った人の値も守る対象。
        return value !== null && value !== undefined && value !== ''
      case 'boolean':
        return value === true
      case 'array':
        // ⚠ 要素の中身は見ない。1 件足した時点で「打ちかけ」である。
        return Array.isArray(value) && value.length > 0
      case 'image':
        // ⚠ 1 枚選んだ時点で打ちかけ（**保存されず消えると気づけない**種類の入力なので）。
        return value instanceof Blob
      case 'coordinate':
      case 'edgeRef':
        // ⚠ 半分だけ入っている座標も「打ちかけ」。ここで false にすると、
        //   行だけ選んで本文へ移った人の入力が印の無いまま消える。
        return isDraftDirty(childFieldsOf(field), asRecord(value))
      case 'object':
        return (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          isDraftDirty(childFieldsOf(field), value as Record<string, unknown>)
        )
      default:
        // 入力できない型・尋ねない型は下書きにキーが無い（`blankValueOf` を参照）。
        return false
    }
  })
}

/**
 * ⭐ 下書きから `TemplateInstance.data` を作る。**空の入力は書かない。**
 *
 * ⚠ **ここは検証をしない。** 検証は `validateDraft()` の責務で、呼び手が**先に**通す。
 *   ここで黙って落とすと「保存したのに値が無い」になり、弾いたことが誰にも伝わらない。
 *
 * ⚠⚠ **これは見た目の都合ではなく、既存の機構との契約である。**
 *   評価器は「フィールドが**無い**」ときに `fieldRef.default` を発火させる（§1-6-10 の T0/E0）。
 *   空欄を `''` や `0` として書き込むと、**既定値の経路が黙って死ぬ**——
 *   「空欄のままにした」と「0 と入力した」を区別できなくなる。
 *
 * ⚠ `boolean` だけは `false` も書く（`false` は入力された値であって空ではない）。
 * ⚠ 配列要素の `id` は空判定に関わらず必ず残す。
 */
export function pruneEmpty(
  fields: readonly FieldDef[],
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const field of fields) {
    const value = draft[field.key]
    switch (field.type) {
      case 'string':
      case 'text':
      case 'enum':
      case 'direction': {
        const text = typeof value === 'string' ? value.trim() : ''
        if (text !== '') data[field.key] = text
        break
      }
      case 'integer': {
        // ⚠ 数として保つ（文字列で入れると `formatValue` は通るが、集計を入れた瞬間に壊れる）。
        if (typeof value === 'number' && Number.isFinite(value)) data[field.key] = value
        break
      }
      case 'boolean':
        data[field.key] = value === true
        break
      case 'array': {
        if (!Array.isArray(value)) break
        const items = value.map((item) => ({
          ...pruneEmpty(childFieldsOf(field), item as Record<string, unknown>),
          [ITEM_ID_KEY]: (item as ArrayItem)[ITEM_ID_KEY],
        }))
        // ⚠ 空配列も書く。「1 件も無い」は入力の結果であって、未入力ではない。
        data[field.key] = items
        break
      }
      case 'object':
      case 'coordinate':
      case 'edgeRef': {
        if (typeof value !== 'object' || value === null) break
        const nested = pruneEmpty(childFieldsOf(field), value as Record<string, unknown>)
        // ⚠ 中身が全部空なら丸ごと書かない（＝親も「無い」扱いにする）。
        if (Object.keys(nested).length > 0) data[field.key] = nested
        break
      }
      case 'image':
        // ⚠⚠ **画像の実体は `data` に書かない**（§1-4: 実体は `TemplateInstance.images`）。
        //   ここで Blob を書くと、md 展開・zip 出力・保存のすべてに
        //   「data の中に Blob が居る」という別経路が生まれる。→ `collectImages()` が取り出す。
        break
      default:
        // 入力できない型・尋ねない型は下書きにも無いので、ここへは来ない（来ても書かない）。
        break
    }
  }
  return data
}

/**
 * ⭐ 下書きから `TemplateInstance.images` を作る（§1-4 / §1-7-2）。
 *
 * ⚠⚠ **値ではなく定義から歩く。** 「下書きの中の Blob を拾う」と書くと、
 *   入れ子や配列に紛れ込んだ Blob を偶然拾う経路ができる。
 *   宣言（`image` 型の欄）に聞くのは `imageFieldKeyOf()` / `replaceImage()` と**同じ線**である。
 *
 * ⚠ **トップレベルの `image` 欄しか見ない。** `images` のキーはフィールド名 1 段
 *   （§1-4）なので、入れ子の中の画像はキーを表せない。
 *   → 黙って落とさないために、**入れ子の中の `image` 宣言は `template/schema.ts` が読み込みで弾く**。
 */
export function collectImages(
  fields: readonly FieldDef[],
  draft: Record<string, unknown>,
): Record<string, Blob> {
  const images: Record<string, Blob> = {}
  for (const field of fields) {
    if (field.type !== 'image') continue
    const value = draft[field.key]
    if (value instanceof Blob) images[field.key] = value
  }
  return images
}
