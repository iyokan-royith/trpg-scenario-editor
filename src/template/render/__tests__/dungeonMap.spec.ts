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
  DUNGEON_MAP_OUTPUTS,
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

  it('図（figurePart）側の宣言は roomStats を含む部屋データと、独立章と同じ既定値を持つ（P4 で使える形・1-6-10）', () => {
    const figureNode = DUNGEON_MAP_OUTPUTS.find((n) => n.node === 'figurePart')
    if (!figureNode || figureNode.node !== 'figurePart') throw new Error('figurePart が見つかりません')
    const args = figureNode.args as { rooms: string; roomStatsDefault: unknown }
    // ⚠ v0 では args は評価されない（描画は P4）。ここでは「宣言側に持たせてある」ことだけを確かめる。
    expect(args.rooms).toBe('rooms')
    // ⚠ 独立章の roomStats 行が使う default（NO_ROOM_STATS）と同一のオブジェクトを指している
    //   ことまで確認する——別々に定義すると片方だけ直して drift する事故を防ぐ。
    const roomsRepeat = DUNGEON_MAP_OUTPUTS.find((n) => n.node === 'repeat')
    if (!roomsRepeat || roomsRepeat.node !== 'repeat' || roomsRepeat.body.node !== 'blockPart') {
      throw new Error('rooms の repeat が見つかりません')
    }
    const roomStatsFieldRef = roomsRepeat.body.body
      .flat()
      .find((n) => n.node === 'fieldRef' && n.path === 'roomStats')
    if (!roomStatsFieldRef || roomStatsFieldRef.node !== 'fieldRef') {
      throw new Error('roomStats の fieldRef が見つかりません')
    }
    expect(args.roomStatsDefault).toBe(roomStatsFieldRef.default)
    // args.rooms が指す実データには roomStats を持つ部屋（B3・A2）が含まれている。
    const rooms = readMayoiParkSample().data[args.rooms] as { roomStats?: unknown }[]
    expect(rooms.filter((r) => r.roomStats !== undefined)).toHaveLength(2)
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

  it('部屋の本文に描写が入っている（roomStats を持たない部屋は既定値 T0/E0）', () => {
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-8`)
    expect(inlineText(room?.body ?? [])).toBe(
      'トラップ数 0／エネミー数 0\n見渡す限り一面の砂に覆われた部屋である。人やモンスターの気配はない。',
    )
  })

  it('パートを生まない配列（トラップ）は本文の中に順序どおり出る（S7-4）', () => {
    // こうざんエリアはトラップを 2 件持つ（自動販売機・シークレットドア）。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-5`)
    expect(inlineText(room?.body ?? [])).toBe(
      'トラップ 【自動販売機】\nトラップ 【シークレットドア】\n' +
        'トラップ数 0／エネミー数 0\n' +
        '高い山がそびえたつ部屋である。カフェのような建物があるが人やモンスターがいる気配はしない。',
    )
  })

  it('省略可フィールドが無い部屋では、その段落ごと出ない（空行が残らない）。roomStats は既定値で出る', () => {
    // 入場ゲートはトラップを持たない。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-1`)
    expect(inlineText(room?.body ?? [])).toBe(
      'トラップ数 0／エネミー数 0\n券売機のような物とゲートのような物が無惨に壊されている。\n遭遇は得に無い。',
    )
  })

  it('本文も描写も無い部屋（セントラルパーク）でも、パートは生まれ、roomStats は既定値で出る', () => {
    // ⚠ 生まないと、素材一覧からも「未配置 N 件」からも黙って消える（S7-1 が防ぎたい事故）。
    const room = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-6`)
    expect(room?.title).toBe('B-2 セントラルパーク')
    expect(inlineText(room?.body ?? [])).toBe('トラップ 【シークレットドア】\nトラップ数 0／エネミー数 0')
  })

  it('⭐⭐ 【ものかげ】で偽装している部屋（A2）と、roomStats を持たない部屋は「同じ見た目」になる（DESIGN 1-6-10 確定版）', () => {
    // A2＝room-3。実データでは enemyCount が【ものかげ】により 0 に偽装されている（reason 付き）。
    const disguised = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-3`)
    // room-9（かいようエリア）は roomStats を一切持たない部屋。
    const statless = sampleParts().find((p) => p.partId === `${ROOMS_PART_KEY}:room-9`)
    const roomStatsLineOf = (part: Part | undefined): string =>
      inlineText(part?.body ?? [])
        .split('\n')
        .find((line) => line.startsWith('トラップ数')) ?? ''
    const disguisedLine = roomStatsLineOf(disguised)
    const statlessLine = roomStatsLineOf(statless)
    // ⚠ A2 は trapCount が実値 2 なので行全体は一致しないが、
    //   「見分けが付かないこと」が要求されている enemyCount 側は両方とも「0」で一致する。
    expect(disguisedLine).toBe('トラップ数 2／エネミー数 0')
    expect(statlessLine).toBe('トラップ数 0／エネミー数 0')
    expect(disguisedLine).toContain('エネミー数 0')
    expect(statlessLine).toContain('エネミー数 0')
  })
})

describe('原本に無い値を作っていない（データの検算）', () => {
  it('roomStats を実際に持つ部屋は 2 室（B3・A2）。他 7 室は既定値（宣言側）で T0/E0 に揃う', () => {
    const rooms = readMayoiParkSample().data.rooms as { roomStats?: unknown }[]
    expect(rooms.filter((r) => r.roomStats !== undefined)).toHaveLength(2)
  })

  it('導出値は 4 点セットで、v0 では computed が null（1-3・S1）。B3 は通常値', () => {
    const rooms = readMayoiParkSample().data.rooms as {
      roomStats?: Record<string, unknown>
    }[]
    const stats = rooms.find((r) => r.id === 'room-2')?.roomStats
    expect(stats?.trapCount).toEqual({ computed: null, displayed: 1, useDisplayed: true })
    expect(stats?.enemyCount).toEqual({ computed: null, displayed: 10, useDisplayed: true })
  })

  it('⭐⭐ A2 は「表示は 0 だが、データ上は reason で区別できる」（表示を揃えても器は潰さない）', () => {
    const rooms = readMayoiParkSample().data.rooms as {
      id: string
      roomStats?: { enemyCount?: { reason?: string } }
    }[]
    const a2 = rooms.find((r) => r.id === 'room-3')
    const statless = rooms.find((r) => r.id === 'room-9')
    // ⚠ 表示（Part.body）では両者とも「エネミー数 0」で見分けが付かない（上のテストで確認済み）。
    //   しかしデータ側（TemplateInstance.data）では reason の有無で区別できる。
    expect(a2?.roomStats?.enemyCount?.reason).toBe('ものかげの効果により隠れている分は申告しない')
    expect(statless?.roomStats).toBeUndefined()
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
