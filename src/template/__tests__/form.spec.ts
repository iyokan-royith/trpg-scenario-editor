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
  collectImages,
  createArrayItem,
  createDraft,
  isDraftDirty,
  isNeverAskedFieldType,
  isSupportedFieldType,
  labelOf,
  newItemId,
  pruneEmpty,
  validateDraft,
} from '../form'
import { DIRECTIONS, childFieldsOf } from '../domain'

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
  // ⚠ この 2 つは「欄が出ない」型。**理由が別**なので両方を混ぜてある（§1-3-3）。
  { key: 'guard', type: 'ref', label: '見張り' }, // まだ入力できない（判断待ち）
  { key: 'trapCount', type: 'derived', label: 'トラップ数' }, // これからも尋ねない
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

  it('入力できるのは基本型 7 種＋ドメイン型 4 種（`ref` / `oneOf` はまだ・`derived` は尋ねない）', () => {
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
    ])
    // ⏸ 判断待ちの 2 種（§1-3-3a）。⚠ ここが true に倒れたら、入力欄の無い型が
    //   「入力できる」と言われて**画面に何も出ないまま黙って通る**。
    expect(isSupportedFieldType('ref')).toBe(false)
    expect(isSupportedFieldType('oneOf')).toBe(false)
  })

  it('⭐ `derived` は「まだ」ではなく「これからも尋ねない」——2 つの集合を混ぜない（§1-3-3）', () => {
    expect(isNeverAskedFieldType('derived')).toBe(true)
    // ⚠⚠ 入力できる型に混ぜない（混ぜると入力欄を探しに行く）
    expect(isSupportedFieldType('derived')).toBe(false)
    // ⚠⚠ かつ「まだ入力できません」の集合とも別（＝否定で表さない）。
    //   ここが false になると、`derived` が未対応型と同じ文言で出る。
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
    expect('guard' in draft).toBe(false)
    // ⚠ 尋ねない型も同じ（導出値をデータ側に持たせない・P0 知見 1）
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
          at: coordinate('Z', 26),
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

  it('行が A〜Z の外・列が 1 未満なら知らせる', () => {
    const outOfRow = validateDraft(DOMAIN_FIELDS, draftWith({ at: coordinate('あ', 1) }))
    expect(outOfRow).toHaveLength(1)
    expect(outOfRow[0]).toContain('A〜Z')

    const zero = validateDraft(DOMAIN_FIELDS, draftWith({ at: coordinate('A', 0) }))
    expect(zero).toHaveLength(1)
    expect(zero[0]).toContain('1 以上')
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
