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
import { COORDINATE_COLUMN_KEY, COORDINATE_ROW_KEY, DIRECTIONS, EDGE_REF_AT_KEY, EDGE_REF_FACING_KEY } from '../domain'
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
