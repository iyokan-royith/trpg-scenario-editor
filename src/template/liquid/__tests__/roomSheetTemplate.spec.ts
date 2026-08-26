/**
 * ⭐⭐ **同梱テンプレ `roomSheet` のたたき台が、実データで 1 件も落ちないこと**
 *   （DESIGN-v0.md §1-13-1g のロイス決定「**無いフィールドを参照しようとするのは出力の瑕疵です。
 *   出力テンプレート側をなおしてください**」）。
 *
 * ⚠⚠ **このファイルの合格条件は「例外が出ない」だけではない。**
 *   省略可フィールドに一切触れなければ例外は自明に出ない（P-d1 のたたき台が
 *   `at` / `name` しか触っていなかったのがまさにそれ）。**それは瑕疵の解消ではなく回避である。**
 *   → **「落ちない」と「省略可フィールドを実際に出している」を対で置く。**
 *
 * ⚠ 使うデータは**合成ではなくサンプル実物**（マヨイパーク 9 室）。
 *   省略の分布（`description` 無しが 1 室・`traps` 無しが 4 室・`encounter` 無しが 5 室）は
 *   合成では再現できるが、**再現したつもりで実物と違う**のが合成の失敗の型なので実物を使う。
 *   ⚠ 唯一の合成は「**新しく足した空の部屋**」（監査 A108）で、これは実データに存在しない状態。
 */
import { describe, it, expect } from 'vitest'
import { readMayoiParkSample } from '../../../samples'
import { readBundledTemplates } from '../../loader'
import type { TemplateDefinition, TemplateInstance } from '../../model'
import { deriveLiquidPartsOf, type LiquidPart } from '../outputs'
import { markdownLiquidEngine } from '../engine'
import { DUNGEON_MAP_TEMPLATE_ID } from '../../render/dungeonMap'
import { pruneEmpty } from '../../form'

/** ⚠ 同梱テンプレも利用者の持ち込みと同じ経路（`loader.ts`）で読む（Q6）。 */
function dungeonMapDefinition(): TemplateDefinition {
  const def = readBundledTemplates().find((d) => d.id === DUNGEON_MAP_TEMPLATE_ID)
  if (!def) throw new Error('同梱テンプレ「迷宮マップ」が読めていません')
  return def
}

interface Room {
  id: string
  [key: string]: unknown
}

function sampleRooms(): Room[] {
  return readMayoiParkSample().data.rooms as Room[]
}

/**
 * ⚠ **本番と同じエンジン**（`markdownLiquidEngine`）で回す。
 *   専用に作った緩いエンジンで回すと、`lenientIf` を落とした変異がここで鳴らなくなる。
 */
async function renderRooms(rooms: Room[]): Promise<LiquidPart[]> {
  const sample = readMayoiParkSample()
  const instance: TemplateInstance = { ...sample, data: { ...sample.data, rooms } }
  return deriveLiquidPartsOf(instance, dungeonMapDefinition(), markdownLiquidEngine)
}

/** 新しく足した直後の部屋（監査 A108 の実測: これしか持たない）。 */
const BRAND_NEW_ROOM: Room = { id: 'room-brand-new', traps: [] }

describe('roomSheet のたたき台 — 実データ 9 室で 1 件も落ちない（§1-13-1g）', () => {
  it('前提の確認: サンプルは実際に「欠けたフィールド」を含む（含まないなら以下は何も検査していない）', () => {
    const rooms = sampleRooms()
    expect(rooms).toHaveLength(9)
    expect(rooms.filter((r) => r.description === undefined)).toHaveLength(1)
    expect(rooms.filter((r) => r.traps === undefined)).toHaveLength(4)
    expect(rooms.filter((r) => r.encounter === undefined)).toHaveLength(5)
    // ⚠ §1-13-1g は「`encounter` 無しが 6 室」と書いているが、**実測は 5 室**である
    //   （持つのは room-2 / room-3 / room-4 / room-6）。ここは実物を測った値を置く。
    expect(rooms.filter((r) => r.roomStats === undefined)).toHaveLength(7)
  })

  it('⭐ 9 室すべてが例外なしで描ける', async () => {
    const parts = await renderRooms(sampleRooms())
    expect(parts).toHaveLength(9)
    for (const part of parts) expect(part.rendered).not.toBe('')
  })

  it('⭐ 新しく足した空の部屋（`{ traps: [] }` だけ）でも落ちない（監査 A108 の副産物）', async () => {
    const parts = await renderRooms([BRAND_NEW_ROOM])
    expect(parts).toHaveLength(1)
    // 名前も座標も無いが、見出しだけは必ず立つ（§1-13-1d の「先頭は必ず `#`」規約）
    expect(parts[0]!.rendered).toMatch(/^# /)
  })

  it('§1-13-1d の規約: どの部屋も先頭行が `# ` で始まる（オフセットの錨）', async () => {
    const parts = await renderRooms([...sampleRooms(), BRAND_NEW_ROOM])
    for (const part of parts) expect(part.rendered.split('\n')[0]).toMatch(/^# /)
  })
})

describe('⚠ 回避ではなく解消であること — 省略可フィールドを実際に出している', () => {
  /** 部屋 id → 描画結果。 */
  async function renderedById(): Promise<Map<string, string>> {
    const rooms = sampleRooms()
    const parts = await renderRooms(rooms)
    return new Map(rooms.map((room, index) => [room.id, parts[index]!.rendered]))
  }

  it('`description` を持つ部屋には本文が出る／持たない部屋には出ない', async () => {
    const byId = await renderedById()
    // room-1 は description を持つ
    expect(byId.get('room-1')).toContain('券売機のような物とゲートのような物が無惨に壊されている。')
    // room-6 は description を持たない唯一の部屋
    expect(byId.get('room-6')).toBe(byId.get('room-6')!.replace(/\n\n\n+/g, '\n\n'))
  })

  it('`encounter`（敵の列挙）を持つ部屋には遭遇の表が出る', async () => {
    const byId = await renderedById()
    const room2 = byId.get('room-2')!
    expect(room2).toContain('## 遭遇')
    expect(room2).toContain('* 種別: 友好')
    expect(room2).toContain('| ワリアヒラ | 2 |')
  })

  it('`encounter`（戦場）を持つ部屋には区画ごとの行が出る', async () => {
    const room3 = (await renderedById()).get('room-3')!
    expect(room3).toContain('| 場所 | 敵 | トラップ |')
    expect(room3).toContain('| 敵前衛 |')
    expect(room3).toContain('| 敵後衛 |')
    expect(room3).toContain('| 敵本陣 |')
    expect(room3).toContain('| 味方前衛 |')
    expect(room3).toContain('【スライム】*1')
    // ⚠ 味方前衛にはトラップだけがある（敵は空配列）。区画の存在で行を出しているという証拠
    expect(room3).toContain('(戦場にトラップが存在する可能性もある)')
  })

  it('⚠ 反証: 区画は「あるものだけ」出る（4 行が常に出るのではない）', async () => {
    // room-6 の戦場は enemyFront と enemyBase しか持たない
    const room6 = (await renderedById()).get('room-6')!
    expect(room6).toContain('| 敵前衛 |')
    expect(room6).toContain('| 敵本陣 |')
    expect(room6).not.toContain('| 敵後衛 |')
    expect(room6).not.toContain('| 味方前衛 |')
  })

  it('`traps` を持つ部屋にはトラップの節が出る／持たない部屋には出ない', async () => {
    const byId = await renderedById()
    expect(byId.get('room-5')).toContain('## トラップ')
    expect(byId.get('room-5')).toContain('* 自動販売機（対象: room）')
    expect(byId.get('room-1')).not.toContain('## トラップ')
  })

  it('⚠ 空配列の `traps` は「無い」と同じ扱い（節ごと出ない）', async () => {
    const parts = await renderRooms([BRAND_NEW_ROOM])
    expect(parts[0]!.rendered).not.toContain('## トラップ')
  })

  it('`roomStats` を持つ部屋には部屋データの節が出る（`reason` も省略可として扱う）', async () => {
    const byId = await renderedById()
    expect(byId.get('room-2')).toContain('* トラップ数: 1')
    expect(byId.get('room-2')).toContain('* エネミー数: 10')
    // room-3 の enemyCount だけが reason を持つ
    expect(byId.get('room-3')).toContain('（ものかげの効果により隠れている分は申告しない）')
    expect(byId.get('room-2')).not.toContain('（ものかげ')
    expect(byId.get('room-4')).not.toContain('## 部屋データ')
  })

  it('⭐ 省略可な葉（`note`）まで降りている — 無い敵で落ちず、有る敵では出る', async () => {
    const byId = await renderedById()
    // room-2 の敵は note を持たない（それでも表の列は出る）
    expect(byId.get('room-2')).toContain('| マッハペンギン | 4 |  |')
    // room-6 の【兵士】は note を持つ（戦場の表には出ないので、落ちないことだけを見る）
    expect(byId.get('room-6')).toContain('| 敵前衛 |')
  })
})

/**
 * ⚠⚠ **葉（いちばん下のフィールド）の欠落**（監査 A114 の差し戻し）。
 *
 * 上の describe は**節ごと省略される**形（`encounter` が丸ごと無い等）を見ていた。
 * こちらは**節はあるが中の 1 個が無い**形で、`{% if %}` では守れない
 * （守るべきなのは到達ではなく**出力**なので `| default:` の側）。
 *
 * ⚠ **UI から到達可能**である——`form.ts` の `pruneEmpty` は**空文字を落とす**ので、
 *   「戦場の敵を名前空欄で足す」だけで `name` が保存データから消える。
 *   下の最後のテストで、その経路を**実際に駆動して**確かめてある（推測ではない）。
 *
 * ⚠ **重大度は A108 と同じ**: `deriveLiquidPartsOf` は 1 件目で throw し、
 *   `partStore` は**素材単位**で catch するので、その部屋だけでなく
 *   **その素材の liquid パートが全滅**する。
 */
describe('⚠ 葉の欠落でも落ちない（監査 A114・戦場の内部不整合）', () => {
  it('戦場の敵に `name` が無い（名前空欄で足した敵）', async () => {
    const parts = await renderRooms([
      {
        id: 'r',
        at: { row: 'A', col: 1 },
        name: 'ため',
        encounter: {
          kind: '敵対',
          shape: 'battlefield',
          battlefield: { enemyFront: { enemies: [{ id: 'e1', count: 2 }] } },
        },
      },
    ])
    expect(parts[0]!.rendered).toContain('| 敵前衛 |')
  })

  it('戦場のトラップに `name` が無い', async () => {
    const parts = await renderRooms([
      {
        id: 'r',
        encounter: {
          kind: '敵対',
          shape: 'battlefield',
          battlefield: { allyFront: { traps: [{ id: 't1' }] } },
        },
      },
    ])
    expect(parts[0]!.rendered).toContain('| 味方前衛 |')
  })

  it('部屋のトラップに `target` はあるが `kind` が無い', async () => {
    const parts = await renderRooms([{ id: 'r', traps: [{ id: 't1', name: 'わな', target: {} }] }])
    expect(parts[0]!.rendered).toContain('わな')
  })

  it('`at` はあるが `row` が無い（座標を片方だけ入れた）', async () => {
    const parts = await renderRooms([{ id: 'r', at: { col: 3 }, name: 'ため' }])
    expect(parts[0]!.rendered).toMatch(/^# /)
  })

  /**
   * ⭐ **A114 に添えられた `要検証` を実駆動で閉じる**——
   *   「UI から戦場の敵を名前空欄で保存したとき `name` が保存データに現れないか」。
   *   ⚠ フォームの下書きを組み立てて**本物の `pruneEmpty`** に通す
   *   （構造からの推測ではなく、保存に使われる関数そのものを駆動する）。
   */
  it('⭐ 名前空欄の敵は `pruneEmpty` で `name` を落とす → その形でもテンプレが落ちない', async () => {
    const def = dungeonMapDefinition()
    const draft = {
      rooms: [
        {
          id: 'item-1',
          at: { row: 'A', col: 1 },
          name: 'ため',
          encounter: {
            shape: 'battlefield',
            kind: '敵対',
            battlefield: {
              enemyFront: { enemies: [{ id: 'item-2', name: '', count: 3, note: '' }], traps: [] },
            },
          },
        },
      ],
    }
    const data = pruneEmpty(def.fields, draft)
    const room = (data.rooms as Record<string, unknown>[])[0]!
    const front = (
      (room.encounter as Record<string, unknown>).battlefield as Record<string, unknown>
    ).enemyFront as Record<string, unknown>
    const enemy = (front.enemies as Record<string, unknown>[])[0]!
    // ⚠ 前提の確認: 本当に `name` が消えているか（消えていなければ以下は何も検査していない）
    expect('name' in enemy).toBe(false)
    expect(enemy.count).toBe(3)

    const parts = await renderRooms([room as Room])
    expect(parts[0]!.rendered).toContain('| 敵前衛 |')
  })
})
