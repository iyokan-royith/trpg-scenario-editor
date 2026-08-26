/**
 * `liquidOutputs` — **テンプレ文字列から出力を作る経路**（DESIGN-v0.md §1-13-1c・移行 P-a）。
 *
 * ⭐⭐ **このファイルが P-a の合格条件そのもの**である。確かめたいのは 2 つ:
 *   ① liquid のテンプレ文字列から出力が作れること
 *   ② **既存の `outputs` 経路が 1 ミリも変わっていないこと**（並存）。
 *   ②は「既存 413 本が緑」でも部分的に言えるが、**同じ定義に両方を書いて
 *   両方が出る**ことまで見ないと「並べて置いた」の証拠にならない（下の「並存」の節）。
 *
 * ⚠ 検証データは創作だが、**形は仕様の決定に従える**——遭遇は必ず `battlefield` に入り
 *   （§1-12-1）、部屋のトラップ（`roomTraps`）は本文に出す（§1-12-2）。
 *   ⚠ スパイクが発明した「（戦場指定なし）」という区画名は**まだ決まっていない**ので使わない
 *   （§1-12-1 の未決 2）。
 */
import { describe, it, expect } from 'vitest'
import { deriveLiquidPartsOf, type LiquidOutputDef } from '../outputs'
import { createLiquidEngine } from '../engine'
import { derivePartsOf, type TemplateDefinition, type TemplateInstance } from '../../model'
import { readTemplateDefinition } from '../../loader'
import { TemplateDefinitionError } from '../../schema'

function instanceOf(data: Record<string, unknown>): TemplateInstance {
  return { id: 'i1', templateId: 't1', data, images: {} }
}

function defOf(liquidOutputs: LiquidOutputDef[], outputs: TemplateDefinition['outputs'] = []) {
  return {
    id: 't1',
    name: 'ためし',
    version: '0.1.0',
    fields: [],
    outputs,
    liquidOutputs,
  } satisfies TemplateDefinition
}

describe('テンプレ文字列から出力が作れる（P-a の合格条件）', () => {
  it('インスタンスのデータを埋めた文字列が返る', async () => {
    const def = defOf([
      {
        kind: 'liquid',
        key: 'overview',
        label: '全体',
        form: 'section',
        template: '# {{ name }}\n\nレベル {{ level }}／プレイヤー {{ playerCount }} 人',
      },
    ])
    const parts = await deriveLiquidPartsOf(
      instanceOf({ name: 'マヨイパーク', level: 1, playerCount: 4 }),
      def,
    )
    expect(parts).toEqual([
      {
        instanceId: 'i1',
        partId: 'overview',
        form: 'section',
        title: '全体',
        rendered: '# マヨイパーク\n\nレベル 1／プレイヤー 4 人',
      },
    ])
  })

  it('条件分岐と繰り返しが効く（静的な文法では書けなかった「データの意味による分岐」）', async () => {
    // ⭐ ここが移行の実利。`outputs.ts` の評価器は分岐を持たないので、
    //   `encounter` の有無で本文を変えることが原理的に書けなかった（`dungeonMap.ts` の注記）。
    const def = defOf([
      {
        kind: 'liquid',
        key: 'room',
        label: '部屋',
        form: 'section',
        template: [
          '{{ name }}',
          '{%- if encounter %}',
          '遭遇: {{ encounter.kind }}',
          '{%- for area in encounter.battlefield %}',
          '- {{ area.name }}:{% for e in area.enemies %} 【{{ e.name }}】*{{ e.count }}{% endfor %}',
          '{%- endfor %}',
          '{%- else %}',
          '遭遇なし',
          '{%- endif %}',
        ].join('\n'),
      },
    ])

    const withEncounter = await deriveLiquidPartsOf(
      instanceOf({
        name: 'ジャングルエリア',
        encounter: {
          kind: '友好',
          battlefield: [
            { name: '敵前衛', enemies: [{ name: 'スライム', count: 1 }] },
            { name: '敵本陣', enemies: [{ name: 'みみず', count: 2 }] },
          ],
        },
      }),
      def,
    )
    expect(withEncounter[0]!.rendered).toBe(
      'ジャングルエリア\n遭遇: 友好\n- 敵前衛: 【スライム】*1\n- 敵本陣: 【みみず】*2',
    )

    const withoutEncounter = await deriveLiquidPartsOf(
      instanceOf({ name: 'かいようエリア', encounter: null }),
      def,
    )
    expect(withoutEncounter[0]!.rendered).toBe('かいようエリア\n遭遇なし')
  })

  it('md の表が段落に分解されない（スパイクで実測した空白制御・`{%-`）', async () => {
    // ⚠ **素直に書くと壊れる**方が既定である（§1-13-1c の注記 1）。
    //   ここは「直した書き方なら表として成立する」ことを固定するテストで、
    //   壊れる側は下の「反証」で対にしてある。
    const def = defOf([
      {
        kind: 'liquid',
        key: 'traps',
        label: 'トラップ',
        form: 'section',
        template: [
          '| 名前 | 対象 |',
          '|---|---|',
          '{%- for trap in roomTraps %}',
          '| {{ trap.name }} | {{ trap.target }} |',
          '{%- endfor %}',
        ].join('\n'),
      },
    ])
    const parts = await deriveLiquidPartsOf(
      instanceOf({
        // §1-12-2: 部屋のトラップは本文に羅列する（勘定に入るのに出口が無かった）
        roomTraps: [
          { id: 'r1', name: '自動販売機', target: '部屋' },
          { id: 'r2', name: 'シークレットドア', target: 'C1への通路' },
        ],
      }),
      def,
    )
    expect(parts[0]!.rendered).toBe(
      '| 名前 | 対象 |\n|---|---|\n| 自動販売機 | 部屋 |\n| シークレットドア | C1への通路 |',
    )
  })

  it('⚠ 反証: 空白制御を書かないと同じデータで表が壊れる（この検査が当たっている証拠）', async () => {
    // ⭐ 陽性対照。上のテストは「`{%-` を書いた版が通る」しか言っていないので、
    //   `-` を外したときに**実際に壊れる**ことまで見ないと、検査が何も見張っていない可能性がある。
    const def = defOf([
      {
        kind: 'liquid',
        key: 'traps',
        label: 'トラップ',
        form: 'section',
        template: [
          '|---|---|',
          '{% for trap in roomTraps %}',
          '| {{ trap.name }} |',
          '{% endfor %}',
        ].join('\n'),
      },
    ])
    const parts = await deriveLiquidPartsOf(
      instanceOf({ roomTraps: [{ id: 'r1', name: '温泉' }] }),
      def,
    )
    // タグ行が空行として残り、区切り行とデータ行の間が切れている＝表として成立しない
    expect(parts[0]!.rendered).toContain('|---|---|\n\n')
  })
})

describe('パートを何個生むかは、テンプレ文字列の外（`over`）が決める', () => {
  const def = defOf([
    {
      kind: 'liquid',
      key: 'rooms',
      label: '部屋',
      form: 'section',
      over: 'rooms',
      template: '{{ at }} {{ name }}',
    },
  ])

  it('配列の要素ごとに 1 パート生まれ、partId は `key:要素のid`（`repeat` と同じ規約）', async () => {
    const parts = await deriveLiquidPartsOf(
      instanceOf({
        rooms: [
          { id: 'a1', at: 'A-1', name: 'ゆきやまエリア' },
          { id: 'a2', at: 'A-2', name: 'ジャングルエリア' },
        ],
      }),
      def,
    )
    expect(parts.map((p) => p.partId)).toEqual(['rooms:a1', 'rooms:a2'])
    expect(parts.map((p) => p.rendered)).toEqual(['A-1 ゆきやまエリア', 'A-2 ジャングルエリア'])
    // ⚠ 添字ではなく id で作るので、1 件消しても後ろの partId は動かない（P0 知見 2）
    expect(parts.map((p) => p.title)).toEqual(['部屋 ゆきやまエリア', '部屋 ジャングルエリア'])
  })

  it('`over` が配列でなければ 0 個（既存の repeat / perItem と同じ振る舞い）', async () => {
    expect(await deriveLiquidPartsOf(instanceOf({}), def)).toEqual([])
    expect(await deriveLiquidPartsOf(instanceOf({ rooms: 'ちがう' }), def)).toEqual([])
  })
})

describe('⭐ 並存 — 同じ定義に両方書いても、既存の経路は 1 ミリも変わらない（P-a の要点）', () => {
  const def: TemplateDefinition = {
    id: 't1',
    name: 'ためし',
    version: '0.1.0',
    fields: [],
    outputs: [{ kind: 'fixed', key: 'legacy', label: '旧', form: 'section' }],
    liquidOutputs: [
      { kind: 'liquid', key: 'modern', label: '新', form: 'section', template: '新: {{ body }}' },
    ],
  }
  const instance = instanceOf({ legacy: 'ほんぶん', body: 'ほんぶん' })

  it('旧経路（同期・Inline[]）は liquidOutputs があっても同じ結果を返す', () => {
    const parts = derivePartsOf(instance, def)
    expect(parts).toEqual([
      {
        instanceId: 'i1',
        partId: 'legacy',
        form: 'section',
        title: '旧',
        body: [{ kind: 'text', text: 'ほんぶん' }],
      },
    ])
    // ⚠ liquidOutputs を消しても旧経路の結果は同じ＝新フィールドは旧経路に一切影響しない
    expect(derivePartsOf(instance, { ...def, liquidOutputs: undefined })).toEqual(parts)
  })

  it('新経路（非同期・文字列）は旧経路と独立に動く', async () => {
    const parts = await deriveLiquidPartsOf(instance, def)
    expect(parts.map((p) => p.partId)).toEqual(['modern'])
    expect(parts[0]!.rendered).toBe('新: ほんぶん')
  })

  it('liquidOutputs を持たない定義では 0 個（同梱テンプレ 2 本がこの状態）', async () => {
    const bare: TemplateDefinition = { ...def, liquidOutputs: undefined }
    expect(await deriveLiquidPartsOf(instance, bare)).toEqual([])
  })
})

describe('エンジン', () => {
  it('注入したエンジンが使われる（P-b がオプションを固定する差し込み口）', async () => {
    const engine = createLiquidEngine()
    const parts = await deriveLiquidPartsOf(
      instanceOf({ name: 'ねこ' }),
      defOf([{ kind: 'liquid', key: 'k', label: 'l', form: 'inline', template: '{{ name }}' }]),
      engine,
    )
    expect(parts[0]!.rendered).toBe('ねこ')
  })

  it('⚠ テンプレが壊れていれば例外がそのまま出る（黙って空文字にしない・§1-13-1c）', async () => {
    await expect(
      deriveLiquidPartsOf(
        instanceOf({}),
        defOf([
          { kind: 'liquid', key: 'k', label: 'l', form: 'inline', template: '{% for x in y %}' },
        ]),
      ),
    ).rejects.toThrow(/tag .* not closed|not closed/i)
  })
})

// ---------------------------------------------------------------------------
// 読み込みの入口（Q6: 同梱も持ち込みも同じ経路）で liquidOutputs が検められるか
// ---------------------------------------------------------------------------

function readAndFail(text: string): TemplateDefinitionError {
  try {
    readTemplateDefinition(text, 'ためし.json')
  } catch (error) {
    return error as TemplateDefinitionError
  }
  throw new Error('ためし.json は例外を投げるはずでした')
}

/** 濁点を持つ語。NFC（1 文字）とも NFD（か＋濁点）とも書けて、画面上は見分けが付かない。 */
const SOURCE_WORD = 'がけ'

const VALID_LIQUID_OUTPUT = {
  kind: 'liquid',
  key: 'room',
  label: '部屋',
  form: 'section',
  template: '{{ name }}',
}

describe('定義の検証 — liquidOutputs', () => {
  it('liquid だけを持つ定義が読める（outputs は空でよい）', () => {
    const def = readTemplateDefinition(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [{ key: 'name', type: 'string' }],
        outputs: [],
        liquidOutputs: [VALID_LIQUID_OUTPUT],
      }),
      'ためし.json',
    )
    expect(def.liquidOutputs).toEqual([VALID_LIQUID_OUTPUT])
  })

  it('liquidOutputs が無ければキーごと生えない（既存の定義と形が変わらない）', () => {
    const def = readTemplateDefinition(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [{ key: 'name', type: 'string' }],
        outputs: [{ kind: 'fixed', key: 'a', label: 'あ', form: 'section' }],
      }),
      'ためし.json',
    )
    expect('liquidOutputs' in def).toBe(false)
  })

  it('⚠ outputs も liquidOutputs も空なら、今までどおり「空です」と言う', () => {
    const error = readAndFail(
      JSON.stringify({ id: 'x.y', name: 'ためし', version: '0.1.0', fields: [], outputs: [] }),
    )
    expect(error.message).toContain('outputs が空です')
  })

  it('欠けている項目は「どこが」を言う（道順つき）', () => {
    const error = readAndFail(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [],
        outputs: [],
        liquidOutputs: [{ kind: 'liquid', key: 'a', label: 'あ' }],
      }),
    )
    expect(error.problems.some((p) => p.startsWith('liquidOutputs[0].form'))).toBe(true)
    expect(error.problems.some((p) => p.startsWith('liquidOutputs[0].template'))).toBe(true)
  })

  it('⚠ key が outputs のものと衝突したら断る（partId が 2 つの宣言で被る）', () => {
    const error = readAndFail(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [],
        outputs: [{ kind: 'fixed', key: 'room', label: '部屋', form: 'section' }],
        liquidOutputs: [VALID_LIQUID_OUTPUT],
      }),
    )
    expect(error.message).toContain('liquidOutputs[0].key「room」が他の出力と重複しています')
  })

  it('⚠ liquidOutputs どうしの重複も断る', () => {
    const error = readAndFail(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [],
        outputs: [],
        liquidOutputs: [VALID_LIQUID_OUTPUT, { ...VALID_LIQUID_OUTPUT, label: 'べつ' }],
      }),
    )
    expect(error.message).toContain('liquidOutputs[1].key「room」が他の出力と重複しています')
  })

  it('liquidOutputs が配列でなければ断る', () => {
    const error = readAndFail(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [],
        outputs: [],
        liquidOutputs: 'はい',
      }),
    )
    expect(error.message).toContain('liquidOutputs が配列ではありません')
  })

  it('⭐ over は「キーとして使われる値」なので NFC へ揃う（§1-8-4 規約①）', () => {
    // が(NFD) = か + 濁点。画面上は NFC と見分けが付かない。
    const NFD = SOURCE_WORD.normalize('NFD')
    const NFC = SOURCE_WORD.normalize('NFC')
    expect(NFD).not.toBe(NFC) // ⚠ 前提の確認（同じなら以下は何も検査していない）
    const def = readTemplateDefinition(
      JSON.stringify({
        id: 'x.y',
        name: 'ためし',
        version: '0.1.0',
        fields: [],
        outputs: [],
        liquidOutputs: [{ ...VALID_LIQUID_OUTPUT, over: NFD }],
      }),
      'ためし.json',
    )
    expect(def.liquidOutputs![0]!.over).toBe(NFC)
  })
})
