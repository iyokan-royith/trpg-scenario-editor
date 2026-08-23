/**
 * ⭐⭐ §1-6-5 の検算を **実行結果で確かめる**（P2 完了条件 #3・§6 の `要検証`）。
 *
 * ⚠⚠ **設計書の「1＋9＋1 = 11」は机上の計算であって実測ではない**と設計書自身が書いている。
 *   ここで測るのは合計 11 だけではない——**内訳**（どの `outputs` の要素から何個出たか）と、
 *   **件数がデータで決まっていること**（部屋を 1 件足すと 12 になる）と、
 *   **中身にデータの値が入っていること**（固定文字列だけになっていない）である。
 *   合計だけを見ると、`repeat` が壊れて別の要素が 11 個出ても緑になりうる。
 */
import { describe, it, expect } from 'vitest'
import { readMayoiParkSample } from '../../../samples'
import { readBundledTemplates } from '../../loader'
import { derivePartsOf, inlineText, type Part, type TemplateDefinition } from '../../model'
import {
  DUNGEON_MAP_TEMPLATE_ID,
  FIGURE_PART_ID,
  OVERVIEW_PART_ID,
  ROOMS_PART_KEY,
} from '../dungeonMap'

function dungeonMapDefinition(): TemplateDefinition {
  const def = readBundledTemplates().find((d) => d.id === DUNGEON_MAP_TEMPLATE_ID)
  // ⚠ 同梱テンプレも利用者の持ち込みと同じ経路（`loader.ts`）で読む（Q6）。
  if (!def) throw new Error('同梱テンプレ「迷宮マップ」が読めていません')
  return def
}

function sampleParts(): Part[] {
  return derivePartsOf(readMayoiParkSample(), dungeonMapDefinition())
}

/** どの `outputs` の要素から生まれたパートかは `partId` に出る（`rooms:<要素id>` など）。 */
function originOf(part: Part): string {
  return part.partId.split(':')[0] ?? part.partId
}

describe('§1-6-5 の検算 — 実データから 11 パート', () => {
  it('合計 11 個生まれる', () => {
    expect(sampleParts()).toHaveLength(11)
  })

  it('内訳が §1-6-5 の表と一致する（1 ＋ 9 ＋ 1）', () => {
    const parts = sampleParts()
    const breakdown = parts.reduce<Record<string, number>>((acc, part) => {
      acc[originOf(part)] = (acc[originOf(part)] ?? 0) + 1
      return acc
    }, {})
    expect(breakdown).toEqual({
      [OVERVIEW_PART_ID]: 1, // #1 blockPart「全体の説明」
      [ROOMS_PART_KEY]: 9, // #2 repeat over(rooms) → blockPart
      [FIGURE_PART_ID]: 1, // #3 figurePart「全体マップ」
    })
  })

  it('形態（S4）も表のとおり — 独立章 ×10・図 ×1', () => {
    const parts = sampleParts()
    expect(parts.filter((p) => p.form === 'section')).toHaveLength(10)
    expect(parts.filter((p) => p.form === 'figure')).toHaveLength(1)
    // ⚠ 図は「宣言だけ v0・描画は P4」（S8-2）。**数には入る**。
    expect(parts.find((p) => p.form === 'figure')?.title).toBe('全体マップ')
  })

  it('部屋を 1 件足すと 12 になる（件数がデータで決まっている）', () => {
    const instance = readMayoiParkSample()
    const rooms = instance.data.rooms as { id: string }[]
    const before = derivePartsOf(instance, dungeonMapDefinition())
    rooms.push({ id: 'room-10', at: { row: 'C', col: 1 }, name: 'ふえた部屋' } as never)
    const after = derivePartsOf(instance, dungeonMapDefinition())

    expect(before).toHaveLength(11)
    expect(after).toHaveLength(12)
    expect(after.map((p) => p.partId)).toContain(`${ROOMS_PART_KEY}:room-10`)
  })

  it('部屋を 1 件消しても、残った部屋の partId は動かない（配置が切れない・P0 知見 2）', () => {
    const instance = readMayoiParkSample()
    const rooms = instance.data.rooms as { id: string }[]
    const before = derivePartsOf(instance, dungeonMapDefinition()).map((p) => p.partId)
    // ⚠ 添字で partId を作っていると、先頭を消した時点で後ろが全部ずれる。
    rooms.splice(0, 1)
    const after = derivePartsOf(instance, dungeonMapDefinition()).map((p) => p.partId)

    expect(after).toHaveLength(10)
    expect(after).toEqual(before.filter((id) => id !== `${ROOMS_PART_KEY}:room-1`))
  })
})

describe('パートの中身にデータの値が入っている（field-ref が効いている）', () => {
  it('部屋のタイトルが「座標 名前」になる（どちらもデータ由来）', () => {
    const titles = sampleParts()
      .filter((p) => originOf(p) === ROOMS_PART_KEY)
      .map((p) => p.title)
    // ⚠ 固定文字列でこれを作ることはできない（部屋ごとに違う値が入っている）。
    expect(titles).toEqual([
      'C-3 入場ゲート',
      'B-3 しんりんエリア',
      'A-2 ジャングルエリア',
      'A-1 ゆきやまエリア',
      'B-1 こうざんエリア',
      'B-2 セントラルパーク',
      'C-2 どうくつエリア',
      'C-1 さばくエリア',
      'A-3 かいようエリア',
    ])
  })

  it('全体の説明のタイトルと本文が、データの値から組み立てられている', () => {
    const overview = sampleParts().find((p) => p.partId === OVERVIEW_PART_ID)
    expect(overview?.title).toBe('マヨイパーク')
    expect(inlineText(overview?.body ?? [])).toBe('レベル 1／プレイヤー数 4\nマップサイズ 3×3')
  })

  it('部屋の本文に描写が入っている', () => {
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-8`)
    expect(inlineText(room?.body ?? [])).toBe(
      '見渡す限り一面の砂に覆われた部屋である。人やモンスターの気配はない。',
    )
  })

  it('パートを生まない配列（トラップ）は本文の中に順序どおり出る（S7-4）', () => {
    // こうざんエリアはトラップを 2 件持つ（自動販売機・シークレットドア）。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-5`)
    expect(inlineText(room?.body ?? [])).toBe(
      'トラップ 【自動販売機】\nトラップ 【シークレットドア】\n' +
        '高い山がそびえたつ部屋である。カフェのような建物があるが人やモンスターがいる気配はしない。',
    )
  })

  it('省略可フィールドが無い部屋では、その段落ごと出ない（空行が残らない）', () => {
    // 入場ゲートはトラップを持たない。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-1`)
    expect(inlineText(room?.body ?? [])).toBe(
      '券売機のような物とゲートのような物が無惨に壊されている。\n遭遇は得に無い。',
    )
  })

  it('本文も描写も無い部屋（セントラルパーク）でも、パートは生まれる', () => {
    // ⚠ 生まないと、素材一覧からも「未配置 N 件」からも黙って消える（S7-1 が防ぎたい事故）。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-6`)
    expect(room?.title).toBe('B-2 セントラルパーク')
    expect(inlineText(room?.body ?? [])).toBe('トラップ 【シークレットドア】')
  })
})

describe('原本に無い値を作っていない（データの検算）', () => {
  it('roomStats を持つ部屋は 1 つだけ', () => {
    const rooms = readMayoiParkSample().data.rooms as { roomStats?: unknown }[]
    expect(rooms.filter((r) => r.roomStats !== undefined)).toHaveLength(1)
  })

  it('導出値は 4 点セットで、v0 では computed が null（1-3・S1）', () => {
    const rooms = readMayoiParkSample().data.rooms as {
      roomStats?: Record<string, unknown>
    }[]
    const stats = rooms.find((r) => r.roomStats)?.roomStats
    expect(stats?.trapCount).toEqual({ computed: null, displayed: 1, useDisplayed: true })
    expect(stats?.enemyCount).toEqual({ computed: null, displayed: 10, useDisplayed: true })
  })

  it('参照は文字列に潰さず、判別子付きの構造で持っている（1-3・P4 の図がこれに依存する）', () => {
    const rooms = readMayoiParkSample().data.rooms as {
      traps?: { name: string; target?: unknown }[]
    }[]
    const traps = rooms.flatMap((r) => r.traps ?? [])
    expect(traps.find((t) => t.name === 'ものかげ')?.target).toEqual({
      kind: 'room',
      at: { row: 'A', col: 2 },
    })
    expect(traps.find((t) => t.name === 'パスワード')?.target).toEqual({
      kind: 'corridor',
      ends: [
        { row: 'A', col: 2 },
        { row: 'B', col: 3 },
      ],
    })
  })
})
