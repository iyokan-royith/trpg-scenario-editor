/**
 * 組み込みパターン `builtin:dungeon-map` — 迷宮 1 本ぶんのパートを生む（DESIGN-v0.md 1-6-5）。
 *
 * ⭐ **このファイルが「組み込みパターンを 1-6-2 の文法で書く」（1-6-1 案イ）の実物**である。
 *   出力の中身は下の宣言（`DUNGEON_MAP_OUTPUTS`）が全部持っていて、手続きは 1 行も無い。
 *   JSON 側に出るのは `{ "pattern": "builtin:dungeon-map" }` の 1 行だけ。
 *
 * ⚠ 生まれるパートは **1 ＋ （部屋の件数） ＋ 1**。真ん中は `repeat` なので**データで決まる**。
 */
import { NO_ROOM_STATS, type OutputNode } from '../outputs'

export const DUNGEON_MAP_PATTERN = 'builtin:dungeon-map'

/** 同梱テンプレート「迷宮マップ」の id。⚠ 綴りの真実は `src/templates/dungeon-map.json` 側。 */
export const DUNGEON_MAP_TEMPLATE_ID = 'builtin.dungeon-map'

/**
 * ⚠ `key` は **本文に保存される `partId` そのもの**（§1-8-2b）。
 *   一度配布したら軽々に変えられない——変えると置かれた参照が「行方不明のパート」になる。
 */
export const OVERVIEW_PART_ID = 'overview'
export const ROOMS_PART_KEY = 'rooms'
export const FIGURE_PART_ID = 'map'

/**
 * §1-6-5 の検算表がそのままこの 3 要素になっている。
 *
 * | # | 要素 | 生まれるパート |
 * |---|---|---|
 * | 1 | `blockPart`「全体の説明」 | 独立章 ×1 |
 * | 2 | `repeat over(rooms) → blockPart` | 独立章 ×（部屋の件数） |
 * | 3 | `figurePart`「全体マップ」 | 図 ×1 |
 *
 * ⚠ `enemies` / `traps` は `repeat` にしない（S7-4 の「パートを生まない配列」）。
 *   `traps` は `inlineRepeat` で本文の中に順序どおり出る。
 *
 * ⚠⚠ **`encounter`（遭遇）は本文に出していない。** `敵の列挙` と `戦場` の 2 形態があり
 *   （1-3 の `oneOf` ①）、どちらの枝かで参照するパスが変わる＝**データの意味による分岐**になる。
 *   静的な文法（1-6-2）は分岐を持たないので原理的に書けない。→ 報告事項。
 */
export const DUNGEON_MAP_OUTPUTS: OutputNode[] = [
  {
    node: 'blockPart',
    key: OVERVIEW_PART_ID,
    title: [{ node: 'fieldRef', path: 'overview.name' }],
    body: [
      [
        { node: 'text', text: 'レベル ' },
        { node: 'fieldRef', path: 'overview.level' },
        { node: 'text', text: '／プレイヤー数 ' },
        { node: 'fieldRef', path: 'overview.playerCount' },
      ],
      [
        { node: 'text', text: 'マップサイズ ' },
        { node: 'fieldRef', path: 'overview.size.width' },
        { node: 'text', text: '×' },
        { node: 'fieldRef', path: 'overview.size.height' },
      ],
    ],
  },
  {
    node: 'repeat',
    key: ROOMS_PART_KEY,
    over: 'rooms',
    body: {
      node: 'blockPart',
      // ⚠ 束縛された要素が起点なので、パスは `rooms[i].` を書かない（1-6-2 の `field-ref`）。
      key: ROOMS_PART_KEY,
      title: [
        { node: 'fieldRef', path: 'at' },
        { node: 'text', text: ' ' },
        { node: 'fieldRef', path: 'name' },
      ],
      body: [
        [
          {
            node: 'inlineRepeat',
            over: 'traps',
            separator: '\n',
            body: [
              { node: 'text', text: 'トラップ 【' },
              { node: 'fieldRef', path: 'name' },
              { node: 'text', text: '】' },
            ],
          },
        ],
        // ⭐⭐ DESIGN 1-6-10（確定版）: `roomStats` を独立章にも出す。
        //   **持たない部屋も「トラップ数0／エネミー数0」として表示で揃える**（`default: NO_ROOM_STATS`）。
        //   ⚠ これは表示規則であって、`default` はデータに書き込まれない——持たない部屋の
        //   `TemplateInstance.data` は roomStats を持たないままである（NO_ROOM_STATS は宣言側の定数）。
        //   ⚠⚠ 表示を揃えることと区別を保つことは両立させる。【ものかげ】のように偽装で 0 を
        //   見せている部屋は roomStats を実際に持ち、reason 付きの導出値で内部的に区別される
        //   （`outputs.ts` の `NO_ROOM_STATS` のコメント参照）。見分けが付かない表示こそが
        //   偽装トラップの効果そのものなので、意図的に「揃える」を選んでいる。
        [{ node: 'fieldRef', path: 'roomStats', default: NO_ROOM_STATS }],
        [{ node: 'fieldRef', path: 'description' }],
      ],
    },
  },
  {
    node: 'figurePart',
    key: FIGURE_PART_ID,
    title: [{ node: 'text', text: '全体マップ' }],
    // ⚠ 描画は P4。v0 は「宣言だけ」で、パートとしては生まれる（CONCEPT S8-2）。
    renderer: 'dungeon-grid',
    // ⚠ `args.rooms` は部屋データそのもの（`roomStats` を含む）を指す既存のパス。
    //   P4 が部屋ラベル（元の `T{n}/E{n}` の位置）を描くとき、`args.rooms[].roomStats` を
    //   `roomStatsDefault` と同じ規則（`fieldRef.default` と同一の定数）で解決すれば、
    //   独立章と同じ「持たない部屋も T0/E0」表示になる。⚠ v0 では評価しない（宣言のみ）。
    args: { rooms: 'rooms', corridors: 'corridors', entrances: 'entrances', roomStatsDefault: NO_ROOM_STATS },
  },
]
