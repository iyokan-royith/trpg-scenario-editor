/**
 * `liquidOutputs` — **テンプレ文字列**からパートを作る経路（DESIGN-v0.md §1-13-1c・移行 P-a）。
 *
 * ⭐⭐ **これは `outputs`（`template/outputs.ts` の構造化ノード列）の置き換えではなく、
 *   その隣に並べた 2 本目の経路である。** P-a の要点は「並存期間を作ること」で、
 *   既存の 37 本のテスト（台帳 A84）が 1 本も赤くならないことがその証拠になる。
 *   一気に置き換えて全部赤にし、緑に戻して「移行できた」と言うと
 *   **性質が運ばれた証拠にならない**（2026-08-26 の監査）。
 *
 * ⚠ **後で古い方を消すときの手順**（この形を選んだ理由でもある）:
 *   ① `TemplateDefinition.outputs` と `template/outputs.ts` を落とす
 *   ② `liquidOutputs` を `outputs` に改名する
 *   union の枝として足すのではなく**兄弟のフィールド**にしたのは、
 *   既存の `derivePartsOf` が**同期**で、liquid は**非同期**（§1-13-1c の決定）だからである。
 *   同じ union に入れると `derivePartsOf` 全体を非同期にすることになり、
 *   それを呼ぶ 37 本が**移行の中身と関係なく**赤くなる。
 *
 * ⚠ **どこまでが liquid の仕事か**: テンプレ文字列は「**1 パートの中身**」だけを書く。
 *   「**パートが何個生まれるか**」は `over` として**文字列の外**に残す。
 *   これは §1-13-2 の見立て（「`outputs` は見せ方だけでなく
 *   "配置の単位を N 個生む"宣言でもある。配置の単位はデータ構造側の話なので残るはず」）
 *   に従ったもので、スパイクの `each: key`（1 テンプレ → 部屋の数だけ出力）と同じ構図。
 */
import type { ArrayItem, PartForm, TemplateDefinition, TemplateInstance } from '../model'
import { defaultLiquidEngine } from './engine'
import type { Liquid } from 'liquidjs'

/**
 * テンプレ文字列による出力の宣言 1 件（**JSON に書ける層**）。
 *
 * ⚠ `kind: 'liquid'` は `OutputDef` の判別子と同じ語を使っているが**別の union ではない**。
 *   将来 `outputs` を置き換えるときに、この形がそのまま `outputs` の中身になる。
 */
export interface LiquidOutputDef {
  kind: 'liquid'
  /**
   * ⚠⚠ **本文に保存される `partId` の素**（§1-8-2b）。配布後に軽々に変えられない。
   * `over` を指定したときは `key:要素のid` になる（`repeat` と同じ規約）。
   */
  key: string
  label: string
  form: PartForm
  /**
   * 指定するとその配列フィールドの**要素ごとに 1 パート**生む（省略時はインスタンスに 1 個）。
   * ⚠ 値は `instance.data` からのパスではなく**トップレベルのフィールド名**
   *   （既存の `perItem.over` と同じ粒度）。
   */
  over?: string
  /** liquid のテンプレート文字列そのもの。⚠ **実行時に評価する**（ビルド時に埋め込まない） */
  template: string
}

/**
 * liquid が返した出力 1 件。
 *
 * ⚠⚠ **`Part.body: Inline[]` には畳まない。** liquid が返すのは文字列であり、
 *   §1-13-1b の決定（出力は HTML をそのまま出す）でも文字列である。
 *   ここで `[{kind:'text', text: html}]` に詰めると「テキストとして扱う」という嘘が入り、
 *   既存の `Inline` の意味（画面にそのまま出る文字）と衝突する。
 *   → **別の型として持ち、UI への接続は後のフェーズで決める。**
 */
export interface LiquidPart {
  instanceId: string
  partId: string
  form: PartForm
  title: string
  /** liquid の出力そのもの。⚠ エスケープ方針は P-b（HTML/md の 2 インスタンス）が決める */
  rendered: string
}

/**
 * `liquidOutputs` を評価してパート列を作る。
 *
 * ⚠ **例外は握りつぶさない。** 構文エラー・未定義変数・DoS ガードのいずれも
 *   そのまま呼び出し元へ投げる（§1-13-1c「エラーは教えてあげましょう」）。
 *   `LiquidError` は `file`/`line`/`col` を持つので、**そのまま利用者に見せられる形**である。
 *
 * ⚠ `over` が配列でないときは**黙って 0 個**にする。これは新しい寛容さではなく、
 *   既存の `repeat` / `perItem` と同じ振る舞いに揃えただけ（`model.ts` / `outputs.ts`）。
 *
 * @param engine 差し替え可能にしてあるのはテストのため。通常は既定を使う。
 */
export async function deriveLiquidPartsOf(
  instance: TemplateInstance,
  def: TemplateDefinition,
  engine: Liquid = defaultLiquidEngine,
): Promise<LiquidPart[]> {
  const parts: LiquidPart[] = []
  for (const output of def.liquidOutputs ?? []) {
    if (output.over === undefined) {
      parts.push({
        instanceId: instance.id,
        partId: output.key,
        form: output.form,
        title: output.label,
        rendered: await engine.parseAndRender(output.template, instance.data),
      })
      continue
    }
    const rows = instance.data[output.over]
    if (!Array.isArray(rows)) continue
    for (const row of rows as ArrayItem[]) {
      parts.push({
        instanceId: instance.id,
        // ⚠ 添字ではなく要素の `id`（1 件消しても後ろの配置がずれない・P0 知見 2）。
        partId: `${output.key}:${row.id}`,
        form: output.form,
        // ⚠ 既存の `perItem` と同じ見出しの作り方に揃える（`model.ts` の `derivePartsOf`）。
        title: `${output.label} ${String(row.name ?? row.id)}`,
        rendered: await engine.parseAndRender(output.template, row),
      })
    }
  }
  return parts
}
