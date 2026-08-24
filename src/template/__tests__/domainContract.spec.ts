/**
 * ⭐⭐ **書く側（フォーム）と読む側（評価器・同梱サンプル）が、同じ語彙を使っているか。**
 *
 * ⚠⚠ この 1 本は、2026-08-24 に**実際に踏みかけた事故**から生まれた。
 *   フォームその2の実装で座標のキーを `column`、方向の値を英語（`downRight`）に決めかけたが、
 *   読む側は既に別の契約を持っていた:
 *   - `template/outputs.ts` の `isCoordinate()` は `{row: string, col: number}` を要求する
 *   - 同梱サンプル `samples/mayoi-park.json` は `{"row":"C","col":3}` / `"direction":"右下"` で書かれている
 *
 *   ⚠ **食い違っても例外は出ない。** `formatValue` は「知らないオブジェクト」を**空文字**にするので、
 *   フォームで入れた座標だけが**本文から黙って消える**（`downRight` の側は逆に、
 *   英語の内部値が本文へそのまま印字される＝§1-8-2c の再演）。
 *   → **書く側のテストは全部緑のまま、読む側だけが壊れる。**
 *
 * ⚠ 検証データは同梱の実物（サンプル・定義）と、フォームの純ロジックが作った値。
 */
import { describe, it, expect } from 'vitest'
import { readMayoiParkSample } from '../../samples'
import { readBundledTemplates } from '../loader'
import { derivePartsOf, inlineText, type TemplateInstance } from '../model'
import {
  COORDINATE_COLUMN_KEY,
  COORDINATE_ROW_KEY,
  DIRECTIONS,
  EDGE_REF_AT_KEY,
  EDGE_REF_FACING_KEY,
  REF_KIND_KEY,
  discriminatorKeyOf,
} from '../domain'
import { createArrayItem, createDraft, pruneEmpty, validateDraft } from '../form'

const dungeonMap = readBundledTemplates().find((d) => d.id === 'builtin.dungeon-map')!

/** サンプルの中の「座標らしきもの」を全部集める（キー名に依存せず形で拾う）。 */
function collectCoordinateLike(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectCoordinateLike(item, out)
    return out
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    // 行らしき 1 文字と、数の組を持つもの
    const rowLike = Object.entries(record).find(
      ([, v]) => typeof v === 'string' && /^[A-Z]$/.test(v),
    )
    const numberLike = Object.values(record).some((v) => typeof v === 'number')
    if (rowLike && numberLike) out.push(record)
    for (const child of Object.values(record)) collectCoordinateLike(child, out)
  }
  return out
}

describe('同梱サンプル（読む側の実物）と、フォームの語彙が一致している', () => {
  const sample = readMayoiParkSample()

  it('⭐ 座標のキーは `row` / `col`（フォームが書く形と同じ）', () => {
    const coordinates = collectCoordinateLike(sample.data)
    // ⚠ 陽性対照: そもそも座標が実物に入っていること（0 件なら以下は何も検査していない）
    expect(coordinates.length).toBeGreaterThan(5)
    for (const coordinate of coordinates) {
      expect(Object.keys(coordinate).sort()).toEqual([COORDINATE_COLUMN_KEY, COORDINATE_ROW_KEY].sort())
      expect(typeof coordinate[COORDINATE_COLUMN_KEY]).toBe('number')
    }
  })

  it('⭐ 辺参照は `at` + `direction`、方向の値は 8 方向の語彙に入っている', () => {
    const corridors = sample.data.corridors as Record<string, unknown>[]
    expect(corridors.length).toBeGreaterThan(0)
    for (const corridor of corridors) {
      for (const key of ['from', 'to'] as const) {
        const edge = corridor[key] as Record<string, unknown>
        expect(Object.keys(edge).sort()).toEqual([EDGE_REF_AT_KEY, EDGE_REF_FACING_KEY].sort())
        // ⚠⚠ ここが本体。フォームの選択肢に無い綴りが実物に在ったら、
        //   利用者が編集した瞬間に**同じ意味の値が 2 通り**データに並ぶ。
        expect(DIRECTIONS).toContain(edge[EDGE_REF_FACING_KEY])
      }
    }
  })

  it('方向を持つ普通のフィールド（`entrances[].facing`）も同じ語彙', () => {
    for (const entrance of sample.data.entrances as Record<string, unknown>[]) {
      expect(DIRECTIONS).toContain(entrance.facing)
    }
  })
})

describe('⭐⭐ フォームで打った座標が、読む側で表示できる（書く側だけで完結させない）', () => {
  it('部屋の `at` が `C-3` として本文に出る（空にも `[object Object]` にもならない）', () => {
    // フォームの純ロジックだけで data を作る（＝利用者が画面で打ったのと同じ経路）
    const roomFields = dungeonMap.fields.find((f) => f.key === 'rooms')!.fields!
    const room = createArrayItem(roomFields)
    room.name = 'ほこら'
    room.at = { [COORDINATE_ROW_KEY]: 'C', [COORDINATE_COLUMN_KEY]: 3 }
    const draft = { ...createDraft(dungeonMap.fields), rooms: [room] }

    // ⚠ 保存経路と同じ順序（検証 → 刈り取り）を踏む
    expect(validateDraft(dungeonMap.fields, draft)).toEqual([])
    const instance: TemplateInstance = {
      id: 'ためし',
      templateId: dungeonMap.id,
      data: pruneEmpty(dungeonMap.fields, draft),
      images: {},
    }

    const parts = derivePartsOf(instance, dungeonMap)
    const roomPart = parts.find((p) => p.partId.startsWith('rooms:'))!
    // ⚠ 座標が出るのは**見出し**（`dungeonMap.ts` の `title` が `at` + 名前）。
    //   ⚠⚠ `formatValue` の座標の書式（`outputs.ts` が単一の真実）
    expect(roomPart.title).toBe('C-3 ほこら')
    // 本文側にも壊れた表示が混ざっていないこと
    expect(inlineText(roomPart.body)).not.toContain('[object Object]')
  })
})

/**
 * C 群（`oneOf` / `ref`）の保存形が、同梱サンプルの実物と一致しているか。
 *
 * ⚠⚠ **`validateDraft` だけでは片側しか見えない。** あれは**宣言されたフィールドしか歩かない**ので、
 *   枝のフィールド名を 1 つ書き落としても（例: `allyFront` の `traps`）、
 *   サンプル側の値は「宣言されていないキー」として**黙って素通りし、緑のまま**になる。
 *   → **`pruneEmpty` の往復（保存形そのままが出るか）**を並べる。宣言が欠けていれば、
 *   そのキーが**往復で消える**ので赤くなる。
 */
describe('⭐⭐ 同梱サンプルは、この定義のフォームから入力できる形になっている', () => {
  const sample = readMayoiParkSample()

  it('サンプルの実データを下書きとして検証しても、誤りが 0 件（判別子・枝の名前が合っている）', () => {
    // ⚠ ここが赤いなら、判別子のキー名か枝の値が実データと食い違っている。
    expect(validateDraft(dungeonMap.fields, sample.data)).toEqual([])
  })

  /** そのキーの部分木だけを往復させる。⚠ 宣言が欠けていれば往復で消える。 */
  function roundTrip(key: string): unknown {
    return pruneEmpty(dungeonMap.fields, sample.data)[key]
  }

  it('⭐ `oneOf`（遭遇）が往復する——戦場の入れ子も、`allyFront` の `traps` も落ちない', () => {
    const rooms = roundTrip('rooms') as Record<string, unknown>[]
    const original = sample.data.rooms as Record<string, unknown>[]
    for (const [index, room] of rooms.entries()) {
      // ⚠⚠ 保存形そのままが出ること（1 つでも宣言が欠けていれば、そのキーが消えて赤くなる）
      expect(room.encounter).toEqual(original[index]!.encounter)
    }
    // ⚠ 陽性対照: そもそも両方の枝が実データに在ること（0 件なら何も検査していない）
    const shapes = original
      .map((room) => (room.encounter as Record<string, unknown> | undefined)?.shape)
      .filter(Boolean)
    expect(new Set(shapes)).toEqual(new Set(['enemies', 'battlefield']))
  })

  it('⭐ `oneOf`（罠）が往復する——`坂道` の `higherEnd` も、`幻の路` の判別子だけの形も', () => {
    const corridors = roundTrip('corridors') as Record<string, unknown>[]
    const original = sample.data.corridors as Record<string, unknown>[]
    for (const [index, corridor] of corridors.entries()) {
      expect(corridor.trap).toEqual(original[index]!.trap)
    }
    const names = original.map((c) => (c.trap as Record<string, unknown> | undefined)?.name).filter(Boolean)
    expect(new Set(names)).toEqual(new Set(['坂道', '幻の路']))
  })

  it('⭐ `ref`（トラップの対象）が往復する——通路の `ends`（座標の対）も潰れない', () => {
    const rooms = roundTrip('rooms') as Record<string, unknown>[]
    const original = sample.data.rooms as Record<string, unknown>[]
    for (const [index, room] of rooms.entries()) {
      expect(room.traps).toEqual(original[index]!.traps)
    }
    // ⚠ 陽性対照: `room` と `corridor` の両方が実データに在る
    const kinds = original
      .flatMap((room) => (room.traps as Record<string, unknown>[] | undefined) ?? [])
      .map((trap) => (trap.target as Record<string, unknown> | undefined)?.kind)
      .filter(Boolean)
    expect(new Set(kinds)).toEqual(new Set(['room', 'corridor']))
  })

  it('判別子のキーは実データと同じ（遭遇＝`shape`／罠＝`name`／参照＝`kind`）', () => {
    const rooms = dungeonMap.fields.find((f) => f.key === 'rooms')!.fields!
    const corridors = dungeonMap.fields.find((f) => f.key === 'corridors')!.fields!
    expect(discriminatorKeyOf(rooms.find((f) => f.key === 'encounter')!)).toBe('shape')
    expect(discriminatorKeyOf(corridors.find((f) => f.key === 'trap')!)).toBe('name')
    expect(discriminatorKeyOf({ key: 'target', type: 'ref' })).toBe(REF_KIND_KEY)
    // ⚠ 実データ側にもそのキーが在る（宣言だけが正しくても意味が無い）
    const encounters = (sample.data.rooms as Record<string, unknown>[])
      .map((room) => room.encounter as Record<string, unknown> | undefined)
      .filter(Boolean)
    for (const encounter of encounters) expect(encounter).toHaveProperty('shape')
  })
})
