/**
 * フォームの純ロジック（`template/form.ts`）。
 *
 * ⚠ ここで見るのは「**入力の結果が `TemplateInstance.data` としてどう残るか**」であって、
 *   画面の見た目ではない。見た目側は `ui/__tests__/templateForm.spec.ts`。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { FIELD_TYPES, type FieldDef } from '../model'
import {
  FIELD_TYPE_LABELS,
  ITEM_ID_KEY,
  SUPPORTED_FIELD_TYPES,
  createArrayItem,
  createDraft,
  isSupportedFieldType,
  labelOf,
  newItemId,
  pruneEmpty,
  validateDraft,
} from '../form'

/** 基本型 7 種＋未対応型を 1 つ混ぜた定義（この切れ目の全域）。 */
const BASIC_FIELDS: FieldDef[] = [
  { key: 'title', type: 'string', label: '題' },
  { key: 'count', type: 'integer', label: '数' },
  { key: 'secret', type: 'boolean', label: '秘密' },
  { key: 'note', type: 'text', label: '覚え書き' },
  { key: 'mood', type: 'enum', label: '気分', choices: ['はれ', 'あめ'] },
  {
    key: 'nest',
    type: 'object',
    label: '入れ子',
    fields: [{ key: 'inner', type: 'string', label: '中身' }],
  },
  {
    key: 'items',
    type: 'array',
    label: 'もちもの',
    fields: [
      { key: 'name', type: 'string', label: '名前' },
      { key: 'weight', type: 'integer', label: '重さ' },
    ],
  },
  { key: 'where', type: 'coordinate', label: '場所' },
]

describe('型の日本語名（§1-8-2c: 内部の値を画面に出さない）', () => {
  it('宣言されている型は全部、日本語名を持っている', () => {
    // ⚠ 1 つでも欠けると「まだ入力できません（coordinate）」のように英語が漏れる。
    for (const type of FIELD_TYPES) {
      expect(FIELD_TYPE_LABELS[type]).toBeTruthy()
      expect(FIELD_TYPE_LABELS[type]).not.toBe(type)
    }
  })

  it('この切れ目で入力できるのは基本型 7 種だけ', () => {
    expect([...SUPPORTED_FIELD_TYPES]).toEqual([
      'string',
      'integer',
      'boolean',
      'text',
      'enum',
      'array',
      'object',
    ])
    expect(isSupportedFieldType('oneOf')).toBe(false)
    expect(isSupportedFieldType('coordinate')).toBe(false)
  })

  it('表示名が無ければ key を出す（黙って空欄にしない）', () => {
    expect(labelOf({ key: 'rooms', type: 'array' })).toBe('rooms')
    expect(labelOf({ key: 'rooms', type: 'array', label: '部屋' })).toBe('部屋')
  })
})

describe('下書きの初期値', () => {
  it('型ごとの空値が入り、未対応の型はキーごと作らない', () => {
    const draft = createDraft(BASIC_FIELDS)
    expect(draft).toEqual({
      title: '',
      count: null, // ⚠ 0 にしない（未入力と 0 が区別できなくなる）
      secret: false,
      note: '',
      mood: '',
      nest: { inner: '' },
      items: [],
    })
    // 入力できないものの空値を作らない（作ると「入力していないのに値がある」データになる）
    expect(ITEM_ID_KEY in draft).toBe(false)
    expect('where' in draft).toBe(false)
  })
})

describe('配列要素の id（完了条件 #5・P0 知見 2）', () => {
  it('要素は必ず id を持ち、子フィールドの空値も入る', () => {
    const item = createArrayItem(BASIC_FIELDS[6]!.fields!)
    expect(item.id).toMatch(/^item-/)
    expect(item.name).toBe('')
    expect(item.weight).toBeNull()
  })

  it('採番は毎回違う（同じミリ秒に続けて呼んでも）', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newItemId()))
    expect(ids.size).toBe(50)
  })
})

describe('保存する値（pruneEmpty）', () => {
  it('空の入力は書かない——「未入力」と「空文字を入れた」を作り分けない', () => {
    const draft = createDraft(BASIC_FIELDS)
    const data = pruneEmpty(BASIC_FIELDS, draft)
    // ⚠⚠ 空欄を書き込むと、評価器の `fieldRef.default`（§1-6-10 の T0/E0）が黙って死ぬ。
    expect(data).toEqual({ secret: false, items: [] })
  })

  it('boolean の false は書く（false は入力された値であって空ではない）', () => {
    const data = pruneEmpty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), secret: false })
    expect(data.secret).toBe(false)
  })

  it('整数 0 は書く。空欄（null）だけを落とす', () => {
    const zero = pruneEmpty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: 0 })
    expect(zero.count).toBe(0)
    const blank = pruneEmpty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: null })
    expect('count' in blank).toBe(false)
  })

  it('型がそのまま残る（整数は number・真偽は boolean）', () => {
    const data = pruneEmpty(BASIC_FIELDS, {
      ...createDraft(BASIC_FIELDS),
      title: 'ためし',
      count: 3,
      secret: true,
    })
    // ⚠ 文字列で入ると表示は通るが、集計（S3）を入れた瞬間に壊れる。
    expect(typeof data.count).toBe('number')
    expect(typeof data.secret).toBe('boolean')
    expect(data.title).toBe('ためし')
  })

  it('前後の空白は落とす（見えない差でキーが分かれない）', () => {
    const data = pruneEmpty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), title: '  ため  ' })
    expect(data.title).toBe('ため')
  })

  it('中身が全部空の入れ子は丸ごと書かない', () => {
    const data = pruneEmpty(BASIC_FIELDS, createDraft(BASIC_FIELDS))
    expect('nest' in data).toBe(false)

    const filled = pruneEmpty(BASIC_FIELDS, {
      ...createDraft(BASIC_FIELDS),
      nest: { inner: 'ある' },
    })
    expect(filled.nest).toEqual({ inner: 'ある' })
  })

  it('配列は要素の id を必ず残し、空の子だけを落とす', () => {
    const itemFields = BASIC_FIELDS[6]!.fields!
    const a = createArrayItem(itemFields)
    a.name = 'なわ'
    const b = createArrayItem(itemFields)
    const data = pruneEmpty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), items: [a, b] })
    expect(data.items).toEqual([{ id: a.id, name: 'なわ' }, { id: b.id }])
  })
})

/**
 * 整数の検証（DESIGN-v0.md §1-3-1 の決定 4）。
 *
 * ⚠⚠ **黙って切り捨てない**（`Math.trunc` は「黙って値を変える」型）。
 *   保存の手前で弾き、**何がいけないかを人の言葉で言う**。
 */
describe('整数でない値は保存の手前で弾く（§1-3-1 決定 4）', () => {
  it('整数はそのまま通る（弾きすぎていないことの陽性対照）', () => {
    for (const value of [0, 3, -7, null]) {
      expect(validateDraft(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: value })).toEqual(
        [],
      )
    }
  })

  it('⭐ 小数は弾かれ、表示名つきで知らせる（切り捨てない）', () => {
    const errors = validateDraft(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: 3.5 })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('数') // ⚠ label（`count` ではない・§1-8-1）
    expect(errors[0]).toContain('整数')
    // ⚠ 内部の識別子を画面に出さない（§1-8-2c）
    expect(errors[0]).not.toContain('count')
  })

  it('入れ子の中でも弾く（再帰が 2 段目で切れていない）', () => {
    const fields: FieldDef[] = [
      {
        key: 'nest',
        type: 'object',
        label: '全体',
        fields: [{ key: 'level', type: 'integer', label: 'レベル' }],
      },
    ]
    const errors = validateDraft(fields, { nest: { level: 1.5 } })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('全体')
    expect(errors[0]).toContain('レベル')
  })

  it('⭐ 配列の要素は「何件目か」まで言う（どの行が悪いか分からないと直せない）', () => {
    const itemFields = BASIC_FIELDS[6]!.fields!
    const ok = createArrayItem(itemFields)
    ok.weight = 2
    const ng = createArrayItem(itemFields)
    ng.weight = 2.25
    const errors = validateDraft(BASIC_FIELDS, {
      ...createDraft(BASIC_FIELDS),
      items: [ok, ng],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('もちもの')
    expect(errors[0]).toContain('2') // 2 件目
    expect(errors[0]).toContain('重さ')
  })
})
