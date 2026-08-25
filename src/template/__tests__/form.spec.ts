/**
 * フォームの純ロジック（`template/form.ts`）。
 *
 * ⚠ ここで見るのは「**入力の結果が `TemplateInstance.data` としてどう残るか**」であって、
 *   画面の見た目ではない。見た目側は `ui/__tests__/templateForm.spec.ts`。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { FIELD_TYPES, type ArrayItem, type FieldDef } from '../model'
import {
  FIELD_TYPE_LABELS,
  ITEM_ID_KEY,
  SUPPORTED_FIELD_TYPES,
  collectImages,
  createArrayItem,
  draftFromInstance,
  isSameDraft,
  createDraft,
  isDraftDirty,
  isNeverAskedFieldType,
  isSupportedFieldType,
  labelOf,
  newItemId,
  pruneEmpty,
  validateDraft,
} from '../form'
import { COORDINATE_CHOICES, DIRECTIONS, childFieldsOf, choicesOf, visibleFieldsOf } from '../domain'

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
  // ⚠ 欄が出ない唯一の型（これからも尋ねない・§1-3-3）
  { key: 'trapCount', type: 'derived', label: 'トラップ数' },
]

/** ドメイン型（この切れ目で足した A 群・B 群）。⚠ `edgeRef` は座標＋方向の合成。 */
const DOMAIN_FIELDS: FieldDef[] = [
  { key: 'at', type: 'coordinate', label: '位置' },
  { key: 'facing', type: 'direction', label: '向き' },
  { key: 'from', type: 'edgeRef', label: '始点' },
  { key: 'photo', type: 'image', label: '顔写真' },
]

/** 座標の値を作る小道具（下書きの形をテスト側で手打ちしない）。 */
function coordinate(row: string | '', col: number | null): Record<string, unknown> {
  return { row, col }
}

describe('型の日本語名（§1-8-2c: 内部の値を画面に出さない）', () => {
  it('宣言されている型は全部、日本語名を持っている', () => {
    // ⚠ 1 つでも欠けると「まだ入力できません（coordinate）」のように英語が漏れる。
    for (const type of FIELD_TYPES) {
      expect(FIELD_TYPE_LABELS[type]).toBeTruthy()
      expect(FIELD_TYPE_LABELS[type]).not.toBe(type)
    }
  })

  it('⭐ C 群が入り、`derived` 以外の全 13 種が入力できる', () => {
    expect([...SUPPORTED_FIELD_TYPES]).toEqual([
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
      'oneOf',
      'ref',
    ])
    expect(isSupportedFieldType('oneOf')).toBe(true)
    expect(isSupportedFieldType('ref')).toBe(true)
  })

  it('⭐⭐ 宣言できる型は必ずどちらかの集合に入る（新しい型を足したときに落ちる網）', () => {
    // ⚠⚠ 「入力できる」でも「尋ねない」でもない型が生まれると、
    //   その欄は**画面から消える**（`FieldEditor` の未対応の枝へ落ちる）。
    for (const type of FIELD_TYPES) {
      expect(isSupportedFieldType(type) || isNeverAskedFieldType(type)).toBe(true)
      // ⚠ 両方に入ってはならない（尋ねないのに入力欄を探しに行く）
      expect(isSupportedFieldType(type) && isNeverAskedFieldType(type)).toBe(false)
    }
  })

  it('⭐ `derived` は「まだ」ではなく「これからも尋ねない」——2 つの集合を混ぜない（§1-3-3）', () => {
    expect(isNeverAskedFieldType('derived')).toBe(true)
    // ⚠⚠ 入力できる型に混ぜない（混ぜると入力欄を探しに行く）
    expect(isSupportedFieldType('derived')).toBe(false)
    // ⚠⚠ **否定で表さない**ことがここの主題。C 群が入って未対応型が 0 になった今、
    //   「対応済みの否定」で書いていたら `derived` は**どの集合にも入らなくなっていた**。
    for (const type of ['ref', 'oneOf'] as const) expect(isNeverAskedFieldType(type)).toBe(false)
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
    // ⚠ 尋ねない型は下書きにキーごと作らない（導出値をデータ側に持たせない・P0 知見 1）
    expect('trapCount' in draft).toBe(false)
  })

  it('⭐ ドメイン型の空値——座標は行と列、辺参照は座標と方向の入れ物になる（合成）', () => {
    expect(createDraft(DOMAIN_FIELDS)).toEqual({
      at: { row: '', col: null },
      facing: '',
      from: { at: { row: '', col: null }, direction: '' },
      photo: null,
    })
  })

  it('⭐⭐ 合成型の子は**型が決める**——定義が `fields` を書いても入れ替わらない', () => {
    // ⚠⚠ ここが `field.fields ?? COMPOSITE` の順だと、持ち込みの定義で
    //   行と列が黙って別の構造に置き換わり、保存形が型の契約から外れる（P4 で図が描けない）。
    const hijacked: FieldDef = {
      key: 'at',
      type: 'coordinate',
      label: '位置',
      fields: [{ key: 'x', type: 'string', label: 'よこ' }],
    }
    expect(childFieldsOf(hijacked).map((f) => f.key)).toEqual(['row', 'col'])
    expect(createDraft([hijacked])).toEqual({ at: { row: '', col: null } })
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

/**
 * 未保存の印（DESIGN-v0.md §1-9-2）の述語。
 *
 * ⚠⚠ **`pruneEmpty()` で代用できないことを、ここで陽に固定する。**
 *   あちらは配列と真偽を空でも書くので、開いた直後から「値がある」になる——
 *   その実装に差し替えても気づけるように、**空の下書きが dirty でない**を最初に置く。
 */
describe('未保存の印（§1-9-2）', () => {
  it('⭐ 空の下書きは打ちかけではない（配列・真偽の欄があっても）', () => {
    const draft = createDraft(BASIC_FIELDS)
    expect(isDraftDirty(BASIC_FIELDS, draft)).toBe(false)
    // ⚠ 判別: pruneEmpty で代用すると、この時点で既にキーが 2 つある（items と secret）
    expect(Object.keys(pruneEmpty(BASIC_FIELDS, draft)).length).toBeGreaterThan(0)
  })

  it('文字列を打つと打ちかけになる／空白だけは打っていないのと同じ', () => {
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), title: 'ま' })).toBe(true)
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), title: '  ' })).toBe(false)
  })

  it('整数は「正しくない値」でも打ちかけとして数える（打った値を守る対象だから）', () => {
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: 3.5 })).toBe(true)
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: 0 })).toBe(true)
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), count: null })).toBe(false)
  })

  it('真偽は true だけ／配列は 1 件足した時点で打ちかけ', () => {
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), secret: false })).toBe(false)
    expect(isDraftDirty(BASIC_FIELDS, { ...createDraft(BASIC_FIELDS), secret: true })).toBe(true)
    const itemFields = BASIC_FIELDS[6]!.fields!
    expect(
      isDraftDirty(BASIC_FIELDS, {
        ...createDraft(BASIC_FIELDS),
        items: [createArrayItem(itemFields)],
      }),
    ).toBe(true)
  })

  it('⭐ 入れ子の奥に打った値も見つかる（再帰が 1 段目で切れていない）', () => {
    const draft = createDraft(BASIC_FIELDS)
    expect(isDraftDirty(BASIC_FIELDS, draft)).toBe(false)
    ;(draft.nest as Record<string, unknown>).inner = 'おくのもの'
    expect(isDraftDirty(BASIC_FIELDS, draft)).toBe(true)
  })
})

/**
 * ドメイン型の A 群（`coordinate` / `direction` / `edgeRef`）と B 群（`image`）。
 *
 * ⚠⚠ **3 つの述語（`validateDraft` / `isDraftDirty` / `pruneEmpty`）を型ごとに別々に見る。**
 *   1 つでも抜けると「印が点かない」「空欄が保存される」「検証を素通りする」のどれかが
 *   **緑のまま**起きる（どれも画面には出ない壊れ方をする）。
 */
describe('方向の語彙', () => {
  it('8 方向ある（斜めを含む）。⚠ 値は日本語＝`enum` の choices と同じ「値」（§1-8-1）', () => {
    expect(DIRECTIONS).toHaveLength(8)
    // ⚠ 斜めが落ちていないこと（4 方向だけ実装した、を検出する）
    expect([...DIRECTIONS]).toEqual(
      expect.arrayContaining(['右上', '右下', '左下', '左上']),
    )
    // ⚠⚠ 内部値を英語にすると、`formatValue` がそれをそのまま本文へ印字する（§1-8-2c）。
    for (const direction of DIRECTIONS) expect(direction).not.toMatch(/[a-zA-Z]/)
  })
})

describe('ドメイン型を保存する（pruneEmpty）', () => {
  it('⭐ 空のドメイン欄は 1 つも書かない（否定形の述語）', () => {
    const data = pruneEmpty(DOMAIN_FIELDS, createDraft(DOMAIN_FIELDS))
    expect(data).toEqual({})
  })

  it('揃った座標は行と列のまま書く（`A2` のような文字列に潰さない）', () => {
    const data = pruneEmpty(DOMAIN_FIELDS, {
      ...createDraft(DOMAIN_FIELDS),
      at: coordinate('A', 2),
    })
    // ⚠⚠ 文字列に潰すと P4 で図が描けない（§1-3 の `ref` と同じ理由）。
    expect(data.at).toEqual({ row: 'A', col: 2 })
  })

  it('方向は内部値（英語）で書く。空は書かない', () => {
    const data = pruneEmpty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), facing: '右下' })
    expect(data.facing).toBe('右下')
    expect('facing' in pruneEmpty(DOMAIN_FIELDS, createDraft(DOMAIN_FIELDS))).toBe(false)
  })

  it('辺参照は座標と方向の入れ子のまま書く（合成が保存形にも出る）', () => {
    const data = pruneEmpty(DOMAIN_FIELDS, {
      ...createDraft(DOMAIN_FIELDS),
      from: { at: coordinate('C', 1), direction: '下' },
    })
    expect(data.from).toEqual({ at: { row: 'C', col: 1 }, direction: '下' })
  })

  it('⭐⭐ 画像の実体は `data` に**絶対に**書かない（実体は images 側・§1-4）', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const data = pruneEmpty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), photo: blob })
    expect('photo' in data).toBe(false)
    // ⚠ どこにも紛れていないこと（入れ子に押し込まれていない）
    expect(JSON.stringify(data)).not.toContain('photo')
  })

  it('⚠ 半分だけの座標は「書かれる」——`pruneEmpty` は検証をしない（責務の線）', () => {
    // ⚠⚠ これは欠陥ではなく**分担**である。保存経路では `validateDraft()` が先に立ち、
    //   半分だけの座標はそこで止まる（下の describe で固定している）。
    //   ここを「揃っていなければ落とす」に変えると、打った値が黙って消える側の壊れ方になる。
    const data = pruneEmpty(DOMAIN_FIELDS, {
      ...createDraft(DOMAIN_FIELDS),
      at: coordinate('A', null),
    })
    expect(data.at).toEqual({ row: 'A' })
    expect(validateDraft(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), at: coordinate('A', null) })).
      toHaveLength(1)
  })
})

describe('ドメイン型の未保存の印（isDraftDirty）', () => {
  it('⭐ 空のドメイン下書きは打ちかけではない（否定形の述語）', () => {
    expect(isDraftDirty(DOMAIN_FIELDS, createDraft(DOMAIN_FIELDS))).toBe(false)
  })

  it('行だけ選んでも打ちかけ（半分の入力を印の無いまま消さない）', () => {
    expect(
      isDraftDirty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), at: coordinate('B', null) }),
    ).toBe(true)
    expect(
      isDraftDirty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), at: coordinate('', 3) }),
    ).toBe(true)
  })

  it('方向を選ぶと打ちかけになる', () => {
    expect(isDraftDirty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), facing: '上' })).toBe(true)
  })

  it('⭐ 辺参照の奥（座標の行）に打った値も見つかる（合成が 2 段目で切れていない）', () => {
    expect(
      isDraftDirty(DOMAIN_FIELDS, {
        ...createDraft(DOMAIN_FIELDS),
        from: { at: coordinate('D', null), direction: '' },
      }),
    ).toBe(true)
  })

  it('画像は 1 枚選んだ時点で打ちかけ。外すと戻る', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    expect(isDraftDirty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), photo: blob })).toBe(true)
    expect(isDraftDirty(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), photo: null })).toBe(false)
  })
})

describe('ドメイン型の検証（validateDraft）', () => {
  const draftWith = (patch: Record<string, unknown>) => ({ ...createDraft(DOMAIN_FIELDS), ...patch })

  it('空も、揃っているものも通る（弾きすぎていないことの陽性対照）', () => {
    expect(validateDraft(DOMAIN_FIELDS, createDraft(DOMAIN_FIELDS))).toEqual([])
    expect(
      validateDraft(
        DOMAIN_FIELDS,
        draftWith({
          at: coordinate('C', 3),
          facing: '左上',
          from: { at: coordinate('A', 1), direction: '左' },
        }),
      ),
    ).toEqual([])
  })

  it('⭐ 半分だけの座標は保存の手前で止まる（行だけ・列だけ）', () => {
    for (const half of [coordinate('A', null), coordinate('', 2)]) {
      const errors = validateDraft(DOMAIN_FIELDS, draftWith({ at: half }))
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('位置') // label（`at` ではない）
      expect(errors[0]).toContain('行と列')
      expect(errors[0]).not.toContain('at')
    }
  })

  /**
   * ⭐ 3×3 の外（§1-3-3d ①）。
   * ⚠⚠ **画面は 9 択なので、ここへ来るのは保存済みデータ・持ち込み定義から外れた値だけ**。
   *   それでも黙って通さない——通すと、図に置けない座標がデータに残る。
   */
  it('⭐ 3×3 の外の座標は知らせる（行も列も）', () => {
    for (const outside of [coordinate('あ', 1), coordinate('D', 1), coordinate('A', 0), coordinate('A', 4)]) {
      const errors = validateDraft(DOMAIN_FIELDS, draftWith({ at: outside }))
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('A1')
      expect(errors[0]).toContain('C3')
    }
    // ⚠ 陽性対照: 9 つは全部通る（弾きすぎていない）
    for (const inside of COORDINATE_CHOICES) {
      const at = { row: inside.slice(0, 1), col: Number(inside.slice(1)) }
      expect(validateDraft(DOMAIN_FIELDS, draftWith({ at }))).toEqual([])
    }
  })

  it('⚠ 列の小数は「整数で」と 1 行だけ出る（合成の子と親で二重に言わない）', () => {
    const errors = validateDraft(DOMAIN_FIELDS, draftWith({ at: coordinate('A', 1.5) }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('整数')
    expect(errors[0]).toContain('列') // 子の label まで言う
  })

  it('知らない向き（画面の選択肢から出ない値）は弾く', () => {
    const errors = validateDraft(DOMAIN_FIELDS, draftWith({ facing: '北東' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('向き')
  })

  it('⭐ 座標だけ・方向だけの辺参照は弾く（辺を指せない＝P4 で線が引けない）', () => {
    const onlyAt = validateDraft(
      DOMAIN_FIELDS,
      draftWith({ from: { at: coordinate('A', 1), direction: '' } }),
    )
    expect(onlyAt).toHaveLength(1)
    expect(onlyAt[0]).toContain('始点')
    expect(onlyAt[0]).toContain('座標と方向')

    const onlyFacing = validateDraft(
      DOMAIN_FIELDS,
      draftWith({ from: { at: coordinate('', null), direction: '上' } }),
    )
    expect(onlyFacing).toHaveLength(1)
    expect(onlyFacing[0]).toContain('座標と方向')
  })

  it('画像の欄に画像でないものが入っていたら保存の手前で止める', () => {
    const errors = validateDraft(DOMAIN_FIELDS, draftWith({ photo: 'ファイル名っぽい文字列' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('顔写真')
  })

  it('⭐ 配列の中の座標も「何件目か」まで言う（再帰が切れていない）', () => {
    const fields: FieldDef[] = [
      { key: 'rooms', type: 'array', label: '部屋', fields: [{ key: 'at', type: 'coordinate', label: '位置' }] },
    ]
    const ng = createArrayItem(fields[0]!.fields!)
    ng.at = coordinate('A', null)
    const errors = validateDraft(fields, { rooms: [createArrayItem(fields[0]!.fields!), ng] })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('部屋 2 件目')
    expect(errors[0]).toContain('位置')
  })
})

describe('画像の実体を取り出す（collectImages）', () => {
  const blob = () => new Blob(['x'], { type: 'image/png' })

  it('定義の `image` 欄から、選ばれた実体をキー付きで取り出す', () => {
    const file = blob()
    const images = collectImages(DOMAIN_FIELDS, { ...createDraft(DOMAIN_FIELDS), photo: file })
    expect(images).toEqual({ photo: file })
  })

  it('⭐ 選んでいなければ空。画像欄の無い定義でも空（否定形の述語）', () => {
    expect(collectImages(DOMAIN_FIELDS, createDraft(DOMAIN_FIELDS))).toEqual({})
    expect(collectImages(BASIC_FIELDS, createDraft(BASIC_FIELDS))).toEqual({})
  })

  it('⭐⭐ **値ではなく定義から歩く**——宣言の無いキーに Blob が居ても拾わない', () => {
    // ⚠ 「下書きの中の Blob を拾う」実装だと、入れ子や配列に紛れた Blob を偶然拾う。
    //   `imageFieldKeyOf()` / `replaceImage()` と同じく**宣言に聞く**のが線。
    const images = collectImages(DOMAIN_FIELDS, {
      ...createDraft(DOMAIN_FIELDS),
      まぎれこみ: blob(),
      nest: { inner: blob() },
    })
    expect(images).toEqual({})
  })
})

/**
 * C 群: 判別子付き共用体（`oneOf`）と参照（`ref`）。
 *
 * ⚠⚠ **3 つの述語が、それぞれ違う集合を歩く**のがこの型の本体（§1-3-3c・A61）:
 *   `pruneEmpty` と `validateDraft` は**選ばれた枝だけ**、`isDraftDirty` は**全部の枝**。
 *   揃えると、どちらかの向きに必ず壊れる——
 *   揃えて「選ばれた枝だけ」にすると**打った値が残っているのに印が消える**、
 *   揃えて「全部の枝」にすると**見えない欄のせいで保存できなくなる／隠れた枝が保存される**。
 */
const TRAP_FIELD: FieldDef = {
  key: 'trap',
  type: 'oneOf',
  label: '罠',
  discriminator: 'name',
  variants: [
    { value: '坂道', fields: [{ key: 'higherEnd', type: 'coordinate', label: '高い方' }] },
    { value: '幻の路' },
    { value: 'シークレットドア', fields: [{ key: 'target', type: 'ref', label: '対象' }] },
  ],
}

/** 共有フィールドを持つ `oneOf`（実物の `遭遇` と同じ形）。 */
const ENCOUNTER_FIELD: FieldDef = {
  key: 'encounter',
  type: 'oneOf',
  label: '遭遇',
  fields: [{ key: 'kind', type: 'enum', label: '種別', choices: ['友好', '敵対'] }],
  discriminator: 'shape',
  variants: [
    {
      value: 'enemies',
      label: '敵の列挙',
      fields: [
        { key: 'enemies', type: 'array', label: '敵', fields: [{ key: 'name', type: 'string', label: '名前' }] },
      ],
    },
    { value: 'battlefield', label: '戦場', fields: [{ key: 'battlefield', type: 'object', label: '戦場', fields: [{ key: 'enemyFront', type: 'string', label: '敵前衛' }] }] },
  ],
}

const REF_FIELD: FieldDef = { key: 'target', type: 'ref', label: '対象' }
const C_FIELDS: FieldDef[] = [TRAP_FIELD, ENCOUNTER_FIELD, REF_FIELD]

describe('判別子付き共用体の下書き（oneOf / ref）', () => {
  it('⭐ 枝が選ばれるまでは判別子と共有フィールドだけ（枝の空値を先に作らない）', () => {
    expect(createDraft(C_FIELDS)).toEqual({
      trap: { name: '' },
      encounter: { shape: '', kind: '' },
      // ⚠ `ref` の判別子は型が決めている（`kind`）
      target: { kind: '' },
    })
  })

  it('⭐⭐ `ref` の枝は型が持っている（定義に書かない・書けない）', () => {
    const kinds = visibleFieldsOf(REF_FIELD, undefined)[0]!
    expect(kinds.choices).toEqual(['room', 'corridor', 'roomElement'])
    // ⚠ 画面に出るのは日本語（§1-8-1: 値は英語・表示は日本語）
    expect(choicesOf(kinds).map((c) => c.label)).toEqual(['部屋', '通路', '部屋内要素'])
  })
})

describe('判別子付き共用体を保存する（pruneEmpty）', () => {
  const draftOf = (patch: Record<string, unknown>) => ({ ...createDraft(C_FIELDS), ...patch })

  it('⭐ 種類を選んでいなければ何も書かない（否定形の述語）', () => {
    expect(pruneEmpty(C_FIELDS, createDraft(C_FIELDS))).toEqual({})
  })

  it('⭐⭐ 選んだ枝だけを書く——隠れている枝に打った値は保存されない', () => {
    // 「坂道」に打ってから「幻の路」へ切り替えた下書き（前の枝の値は残っている）
    const data = pruneEmpty(
      C_FIELDS,
      draftOf({ trap: { name: '幻の路', higherEnd: { row: 'B', col: 1 } } }),
    )
    // ⚠⚠ 判別子が値を定義する。選ばれていない枝は下書きの作業領域であって値の一部ではない。
    expect(data.trap).toEqual({ name: '幻の路' })
  })

  it('⭐⭐ 両端とも未入力の通路は `ends` を書かない（`[null, null]` を保存形に入れない・台帳 A76）', () => {
    const draft = draftOf({
      target: {
        kind: 'corridor',
        ends: [
          { row: '', col: null },
          { row: '', col: null },
        ],
      },
    })
    // ⚠ この下書きは**検証を通る**（片端だけではないので「2 つとも入れてください」が出ない）。
    //   → `pruneEmpty` まで到達する経路が実在する、というのがこの述語の前提。
    expect(validateDraft(C_FIELDS, draft)).toEqual([])
    // ⚠⚠ `ends` が「無い」ことが本体。`[null, null]` は
    //   「通路はあるが両端が無い」という**図に描けない値**で、P4 の読み手が掴む。
    expect(pruneEmpty(C_FIELDS, draft).target).toEqual({ kind: 'corridor' })
  })

  it('⭐ フィールドを持たない枝も、判別子だけで保存される（`{name:"幻の路"}`）', () => {
    // ⚠ `object` の「中身が全部空なら丸ごと書かない」を当ててはならない
    //   （当てると、種類を選んだのに何も保存されない）。
    expect(pruneEmpty(C_FIELDS, draftOf({ trap: { name: '温泉' } })).trap).toEqual({ name: '温泉' })
  })

  it('選んだ枝の中身は、その型のまま入る（座標・共有フィールドも）', () => {
    const data = pruneEmpty(
      C_FIELDS,
      draftOf({
        trap: { name: '坂道', higherEnd: { row: 'B', col: 1 } },
        encounter: { kind: '敵対', shape: 'enemies', enemies: [{ id: 'e1', name: 'スライム' }] },
      }),
    )
    expect(data.trap).toEqual({ name: '坂道', higherEnd: { row: 'B', col: 1 } })
    // ⚠ 共有フィールド（`kind`）は枝に関わらず書かれる
    expect(data.encounter).toEqual({
      kind: '敵対',
      shape: 'enemies',
      enemies: [{ id: 'e1', name: 'スライム' }],
    })
  })

  it('⭐ `ref` の通路は座標の対（`ends`）として書く（`array` ではない）', () => {
    const data = pruneEmpty(
      C_FIELDS,
      draftOf({
        target: {
          kind: 'corridor',
          ends: [
            { row: 'A', col: 2 },
            { row: 'B', col: 3 },
          ],
        },
      }),
    )
    expect(data.target).toEqual({
      kind: 'corridor',
      ends: [
        { row: 'A', col: 2 },
        { row: 'B', col: 3 },
      ],
    })
  })

  it('`ref` の部屋・部屋内要素も §1-8-2 の形で書く（⚠ 部屋内要素はサンプルに実データが無い）', () => {
    expect(pruneEmpty(C_FIELDS, draftOf({ target: { kind: 'room', at: { row: 'C', col: 3 } } })).target).toEqual({
      kind: 'room',
      at: { row: 'C', col: 3 },
    })
    expect(
      pruneEmpty(
        C_FIELDS,
        draftOf({ target: { kind: 'roomElement', at: { row: 'C', col: 3 }, elementId: 'trap-1' } }),
      ).target,
    ).toEqual({ kind: 'roomElement', at: { row: 'C', col: 3 }, elementId: 'trap-1' })
  })
})

describe('判別子付き共用体の未保存の印（isDraftDirty）', () => {
  it('⭐ 空は打ちかけではない（否定形の述語）', () => {
    expect(isDraftDirty(C_FIELDS, createDraft(C_FIELDS))).toBe(false)
  })

  it('種類を選んだだけで打ちかけ', () => {
    expect(isDraftDirty(C_FIELDS, { ...createDraft(C_FIELDS), trap: { name: '温泉' } })).toBe(true)
  })

  it('⭐⭐ 隠れている枝に打った値も打ちかけとして数える（保存・検証との非対称）', () => {
    // 「坂道」に打ってから種類を空へ戻した下書き＝画面には何も見えないが、値は残っている
    const draft = { ...createDraft(C_FIELDS), trap: { name: '', higherEnd: { row: 'B', col: 1 } } }
    // ⚠⚠ ここが false になると、**値が残っているのに印が消える**（下書きが空だと誤解させる）
    expect(isDraftDirty(C_FIELDS, draft)).toBe(true)
    // ⚠ 同じ下書きで、保存には何も出ない（3 つの述語が別々の集合を歩いている証拠）
    expect(pruneEmpty(C_FIELDS, draft)).toEqual({})
  })

  it('⭐⭐ **2 番目以降の枝**に打った値も打ちかけとして数える（台帳 A75）', () => {
    // ⚠⚠ 上のテストが使う `higherEnd` は `TRAP_FIELD.variants[0]` なので、
    //   **先頭の枝しか見ない誤実装でも同じ答えになる**（＝守り手になっていなかった）。
    //   ここは `battlefield`＝`ENCOUNTER_FIELD.variants[1]` に打つ。
    const draft = {
      ...createDraft(C_FIELDS),
      encounter: { shape: '', kind: '', battlefield: { enemyFront: 'ゴブリン' } },
    }
    // ⚠ `allVariantFieldsOf` が**全部の枝**を歩いていなければ、ここが false になる。
    expect(isDraftDirty(C_FIELDS, draft)).toBe(true)
    // ⚠ 保存には出ない（種類が選ばれていないので）＝ここでも 3 つの述語の非対称が効いている
    expect(pruneEmpty(C_FIELDS, draft)).toEqual({})
  })
})

describe('判別子付き共用体の検証（validateDraft）', () => {
  const draftOf = (patch: Record<string, unknown>) => ({ ...createDraft(C_FIELDS), ...patch })

  it('空も、選んだ枝が揃っているものも通る（陽性対照）', () => {
    expect(validateDraft(C_FIELDS, createDraft(C_FIELDS))).toEqual([])
    expect(
      validateDraft(
        C_FIELDS,
        draftOf({
          trap: { name: '坂道', higherEnd: { row: 'B', col: 1 } },
          target: { kind: 'room', at: { row: 'A', col: 1 } },
        }),
      ),
    ).toEqual([])
  })

  it('⭐⭐ 隠れている枝の半端な値は保存を塞がない（見えない欄は直せない）', () => {
    // 「坂道」に半端な座標を打ってから「幻の路」へ切り替えた下書き
    const errors = validateDraft(
      C_FIELDS,
      draftOf({ trap: { name: '幻の路', higherEnd: { row: 'B', col: null } } }),
    )
    // ⚠⚠ ここでエラーを出すと、**画面に出ていない欄のせいで保存できなくなる**
    expect(errors).toEqual([])
  })

  it('⭐ 種類を空へ戻したら、隠れた値があっても通る（詰みを作らない）', () => {
    expect(
      validateDraft(C_FIELDS, draftOf({ trap: { name: '', higherEnd: { row: 'B', col: null } } })),
    ).toEqual([])
  })

  it('選んだ枝の中の誤りは、場所つきで弾く', () => {
    const errors = validateDraft(
      C_FIELDS,
      draftOf({ trap: { name: '坂道', higherEnd: { row: 'B', col: null } } }),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('罠')
    expect(errors[0]).toContain('高い方')
    expect(errors[0]).toContain('行と列')
  })

  it('知らない種類は弾く（保存済みデータ・持ち込み定義から来うる）', () => {
    const errors = validateDraft(C_FIELDS, draftOf({ trap: { name: '底なし沼' } }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('知らない種類')
  })

  it('⭐ `ref` の通路は両端が要る（片端だけの通路は指せない）', () => {
    const errors = validateDraft(
      C_FIELDS,
      draftOf({ target: { kind: 'corridor', ends: [{ row: 'A', col: 2 }, { row: '', col: null }] } }),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('両端')
    expect(errors[0]).toContain('2 つとも')
  })

  it('`ref` の枝の中の座標も「何つ目か」まで言う', () => {
    const errors = validateDraft(
      C_FIELDS,
      draftOf({
        target: {
          kind: 'corridor',
          ends: [
            { row: 'A', col: 2 },
            { row: 'B', col: 1.5 },
          ],
        },
      }),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('2 つ目')
    expect(errors[0]).toContain('整数')
  })

  it('⭐ `oneOf` の中の `ref` も検証される（再帰が枝をまたいで切れていない）', () => {
    const errors = validateDraft(
      C_FIELDS,
      draftOf({
        trap: { name: 'シークレットドア', target: { kind: 'room', at: { row: 'D', col: 1 } } },
      }),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('罠')
    expect(errors[0]).toContain('対象')
    expect(errors[0]).toContain('C3')
  })
})

/**
 * ⭐⭐ 保存済みインスタンス → 下書き（`draftFromInstance`・§1-11-2・**要望B の本体**）。
 *
 * ⚠⚠ **本丸は「配列要素の `id` を保つ」こと**（§1-11-1）。
 *   採番し直すと、本文に置いた `partRef`（`<key>:<要素id>`）が**全部行方不明になる**——
 *   ⚠ **例外は出ないし、フォームの画面上も何も変わらない。**
 */
describe('保存済みデータから下書きへ戻す（draftFromInstance）', () => {
  const ROOM_FIELDS: FieldDef[] = [
    { key: 'name', type: 'string', label: '名前' },
    { key: 'at', type: 'coordinate', label: '位置' },
  ]
  const FIELDS: FieldDef[] = [
    { key: 'title', type: 'string', label: '題' },
    { key: 'count', type: 'integer', label: '数' },
    { key: 'secret', type: 'boolean', label: '秘密' },
    { key: 'rooms', type: 'array', label: '部屋', fields: ROOM_FIELDS },
    { key: 'photo', type: 'image', label: '顔写真' },
    TRAP_FIELD,
    { key: 'trapCount', type: 'derived', label: 'トラップ数' },
  ]

  it('⭐⭐⭐ 配列要素の `id` を保つ（採番し直すと本文の参照が全部行方不明になる）', () => {
    const data = {
      rooms: [
        { id: 'item-aaa', name: 'ほこら' },
        { id: 'item-bbb', name: 'いずみ' },
      ],
    }
    const draft = draftFromInstance(FIELDS, data)
    const rooms = draft.rooms as ArrayItem[]
    // ⚠⚠ ここが本丸。`createArrayItem()` を通すと必ず新しい id になる。
    expect(rooms.map((r) => r.id)).toEqual(['item-aaa', 'item-bbb'])
    expect(rooms.map((r) => r.name)).toEqual(['ほこら', 'いずみ'])
  })

  it('⭐ 保存された値が入る（スカラー・真偽・入れ子の座標まで）', () => {
    const draft = draftFromInstance(FIELDS, {
      title: 'まよいの森',
      count: 3,
      secret: true,
      rooms: [{ id: 'item-a', name: 'ほこら', at: { row: 'B', col: 2 } }],
    })
    expect(draft.title).toBe('まよいの森')
    expect(draft.count).toBe(3)
    expect(draft.secret).toBe(true)
    expect((draft.rooms as ArrayItem[])[0]!.at).toEqual({ row: 'B', col: 2 })
  })

  it('⭐⭐ 定義に後から増えた項目は「空欄」として出る（土台は定義側から作る・§1-11-2）', () => {
    // 古いデータ（`count` を持たない時代のもの）を、`count` が増えた定義で開く
    const draft = draftFromInstance(FIELDS, { title: 'ふるいの' })
    // ⚠⚠ データから下書きを作ると**この欄が画面から消える**（＝二度と入力できない）
    expect('count' in draft).toBe(true)
    expect(draft.count).toBeNull()
    expect('secret' in draft).toBe(true)
    expect(draft.rooms).toEqual([])
  })

  it('⭐ 画像は `images` から戻す（`data` 側は見ない）', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    // ⚠⚠ `data` に画像らしきものが在っても使わない（実体の在処は 1 つ・§1-11-4）
    const draft = draftFromInstance(FIELDS, { photo: 'にせもの' }, { photo: blob })
    expect(draft.photo).toBe(blob)
  })

  it('画像を持たない素材は空欄で戻る（否定形）', () => {
    expect(draftFromInstance(FIELDS, {}).photo).toBeNull()
  })

  it('⭐ `oneOf` は保存された枝が復元される。⚠ 選ばれていない枝は戻らない（§1-11-3）', () => {
    const draft = draftFromInstance(FIELDS, {
      trap: { name: '坂道', higherEnd: { row: 'B', col: 1 } },
    })
    const trap = draft.trap as Record<string, unknown>
    expect(trap.name).toBe('坂道')
    expect(trap.higherEnd).toEqual({ row: 'B', col: 1 })
    // ⚠ 「幻の路」に打った値は**そもそも保存されていない**（§1-3-3c の契約の帰結）
    expect(Object.keys(trap).sort()).toEqual(['higherEnd', 'name'])
  })

  it('尋ねない型（導出値）は下書きにキーを作らない', () => {
    expect('trapCount' in draftFromInstance(FIELDS, { trapCount: 3 })).toBe(false)
  })

  it('⚠ 定義に無いキーは下書きに載らない＝保存し直すと消える（現状の仕様案）', () => {
    // ⚠⚠ **黙って消えるのを避けるため、ここに述語として置いておく。**
    //   要検証[定義に無いキーを持つデータが実在すると分かったら、消えてよいかを決める
    //          （同梱サンプルでは 0 件＝現状は到達不能）]
    const draft = draftFromInstance(FIELDS, { title: 'ある', しらないキー: 'きえる' })
    expect('しらないキー' in draft).toBe(false)
    expect(pruneEmpty(FIELDS, draft)).toEqual({ secret: false, rooms: [], title: 'ある' })
  })

  it('⭐ 戻した下書きをそのまま保存すると、元のデータに戻る（往復）', () => {
    // ⚠ 「開いて何もせず保存」で値が変わらないこと。⚠⚠ ここが崩れると、
    //   開いただけで中身が書き換わる（利用者は何もしていないのに）。
    const data = {
      title: 'まよいの森',
      count: 3,
      secret: false,
      rooms: [{ id: 'item-a', name: 'ほこら', at: { row: 'B', col: 2 } }],
      trap: { name: '幻の路' },
    }
    const draft = draftFromInstance(FIELDS, data)
    expect(validateDraft(FIELDS, draft)).toEqual([])
    expect(pruneEmpty(FIELDS, draft)).toEqual(data)
  })
})

describe('編集の「打ちかけ」は開いた時からの差分（isSameDraft）', () => {
  it('⭐ 開いた直後は「打ちかけ」ではない（画像を持っていても）', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const fields: FieldDef[] = [
      { key: 'name', type: 'string', label: '名前' },
      { key: 'photo', type: 'image', label: '写真' },
    ]
    const draft = draftFromInstance(fields, { name: 'ねこ' }, { photo: blob })
    // ⚠⚠ 浅い複製で渡す（`structuredClone` だと **Blob が別オブジェクトになって**常に差分になる）
    expect(isSameDraft({ ...draft }, draft)).toBe(true)
    // ⚠ 新規の判定（空と違うか）で見ると、開いた瞬間から「打ちかけ」になってしまう
    expect(isDraftDirty(fields, draft)).toBe(true)
  })

  it('1 文字でも変えれば差分になる／入れ子の奥でも見つかる', () => {
    const base = { title: 'あ', nest: { inner: 'い' }, items: [{ id: 'x', name: 'う' }] }
    expect(isSameDraft({ ...base, title: 'ん' }, base)).toBe(false)
    expect(isSameDraft({ ...base, nest: { inner: 'ん' } }, base)).toBe(false)
    expect(isSameDraft({ ...base, items: [{ id: 'x', name: 'ん' }] }, base)).toBe(false)
    // 件数が変わっても差分
    expect(isSameDraft({ ...base, items: [] }, base)).toBe(false)
  })
})
