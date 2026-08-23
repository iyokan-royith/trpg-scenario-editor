/**
 * `outputs` — 「どんなパートを・どんな形で生むか」の宣言（DESIGN-v0.md 1-6）。
 *
 * ⚠⚠ **v0 で JSON から書けるのは `OutputDef` まで**（1-6-1 案イ「文法は内部表現。JSON からは開かない」）。
 *   1-6-2 の文法（`repeat` / `field-ref` / `inline-seq`）は **組み込みパターンの中に閉じている**。
 *   ユーザーが JSON に書けるのは「**どの組み込みパターンか**」の選択と、
 *   spike から引き継いだ 2 種（`fixed` / `perItem`）だけ。
 *
 * ⚠ 旧名 `parts: PartDefinition[]` は `OutputDef` に置き換わった（DESIGN 1-3 の注記）。
 *   旧型は「何個生まれるか」だけを持ち、「中身に何を出すか」を持っていなかった。
 *   **このファイルの後半（`OutputNode` 以降）が、その穴を埋める内部表現とその評価器である。**
 */
import type { Inline, PartForm, Part, TemplateInstance } from './model'

/**
 * 出力の宣言 1 件（**JSON に書ける層**）。
 *
 * ⚠ 判別は **`pattern` を持つかどうか**で行う。同梱テンプレ定義（`templates/*.json`）が
 *   `{ "pattern": "builtin:image" }` の形で配布される契約なので、
 *   ここに `kind: '組み込み'` のような判別子を足すと JSON 側の形が変わってしまう。
 */
export type OutputDef =
  /** インスタンスごとに 1 個 */
  | { kind: 'fixed'; key: string; label: string; form: PartForm }
  /** `source` の配列の要素数だけ生まれる */
  | { kind: 'perItem'; key: string; source: string; label: string; form: PartForm }
  /** builtinPatternsに丸ごと任せる（生む数もパターンが決める） */
  | { pattern: string }

/** isPatternOutputどうか。⚠ 判別はこの述語 1 箇所でしか行わない。 */
export function isPatternOutput(output: OutputDef): output is { pattern: string } {
  return 'pattern' in output
}

// ---------------------------------------------------------------------------
// ここから下が 1-6-2 の文法（**内部表現**）と、その評価器。
// ---------------------------------------------------------------------------

/**
 * `inline` — パートの中身を構成する最小単位（1-6-2）。
 *
 * ⚠ `inlineRepeat` は **1-6-2 の BNF に無い**。仕様側が S7-4 で
 *   「パートを生まない配列（`敵[]` `トラップ[]`）は **inline-seq の中で順序どおり描画する**」と
 *   要求しているのに、`inline ::= text | field-ref | image-ref | html` に反復が無く
 *   **書けなかった**ため、`repeat` と同じ `over(配列フィールド)` の概念を 1 構文だけ足した。
 *   → 設計書へ昇格させるべき差分として報告する（勝手な拡張ではなく、仕様内部の矛盾の解消）。
 */
export type InlineNode =
  | { node: 'text'; text: string }
  /** 現在のスコープからのフィールドパス（`a.b.c`）。`repeat` の中では束縛された要素が起点 */
  | { node: 'fieldRef'; path: string }
  /** 画像フィールドへの参照。実体は `TemplateInstance.images[key]` */
  | { node: 'imageRef'; key: string; alt: string }
  /** 自由 HTML。⚠ 1-4 の契約により iframe sandbox で描画する（描画側は P4） */
  | { node: 'html'; html: string }
  /** 配列を順序どおりに畳み込む（S7-4 の「パートを生まない配列」） */
  | { node: 'inlineRepeat'; over: string; body: InlineSeq; separator: string }

export type InlineSeq = InlineNode[]

/**
 * `part` — S4 の ①独立章 ②本文中 ③図 にそのまま対応（1-6-2）。
 *
 * ⚠⚠ **`key` は BNF に無いが必須である。** パートの `partId` は
 *   `partRef.attrs` として**本文に保存される契約**（§1-8-2b）なので、
 *   配列の添字から導出すると要素を 1 つ消しただけで後ろ全部の配置がずれる（P0 知見 2）。
 *   → **宣言側が安定した名前を持つ**。設計書へ昇格させるべき差分として報告する。
 */
export type PartNode =
  | { node: 'blockPart'; key: string; title: InlineSeq; body: InlineSeq[] }
  | { node: 'inlinePart'; key: string; body: InlineSeq }
  | { node: 'figurePart'; key: string; title: InlineSeq; renderer: string; args?: unknown }

/** `output ::= part | repeat`（1-6-2）。 */
export type OutputNode =
  | PartNode
  /** ⭐ 件数がデータで決まる唯一の構文。`over` の配列の要素数だけ `body` が生まれる */
  | { node: 'repeat'; key: string; over: string; body: PartNode }

/** 配列要素は安定した `id` を持つ（P0 知見 2）。 */
interface Identified {
  id: string
  [field: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 座標（1-3 の `coordinate`）かどうか。`{row:'C', col:3}` → `C-3`。 */
function isCoordinate(value: unknown): value is { row: string; col: number } {
  return isRecord(value) && typeof value.row === 'string' && typeof value.col === 'number'
}

/**
 * `field-ref` が指した値を表示用の文字列にする。
 *
 * ⚠ **設計書は「field-ref が非スカラーを指したときに何が出るか」を定義していない。**
 *   ここでは**型で決まる表示**だけを持つ（座標 → `C-3`）。
 *   データの意味による分岐（遭遇の 2 形態・`*2` の 1 体省略・エリアの並び替え）は
 *   静的な文法では**原理的に書けない**ので、ここには入れない。→ 報告事項。
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (isCoordinate(value)) return `${value.row}-${value.col}`
  if (typeof value === 'object') return ''
  return String(value)
}

/** `a.b.c` を現在のスコープから辿る。途中で切れたら `undefined`。 */
function resolvePath(scope: unknown, path: string): unknown {
  let current: unknown = scope
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

/** `inline-seq` を評価して `Inline[]` にする。 */
function evaluateInlineSeq(seq: InlineSeq, scope: unknown, instance: TemplateInstance): Inline[] {
  const out: Inline[] = []
  for (const node of seq) {
    switch (node.node) {
      case 'text':
        out.push({ kind: 'text', text: node.text })
        break
      case 'fieldRef':
        out.push({ kind: 'text', text: formatValue(resolvePath(scope, node.path)) })
        break
      case 'imageRef': {
        const image = instance.images[node.key]
        // ⚠ 未設定を握りつぶさない。何が無いのかを本文にも一覧にも同じ文字列で出す。
        if (image) out.push({ kind: 'image', image, alt: node.alt })
        else out.push({ kind: 'text', text: `${node.alt}（画像が設定されていません）` })
        break
      }
      case 'html':
        // ⚠ v0 に自由 HTML を使う組み込みパターンは無い。合流先は 1-7-8 の #1 を参照。
        out.push({ kind: 'text', text: node.html })
        break
      case 'inlineRepeat': {
        const rows = resolvePath(scope, node.over)
        if (!Array.isArray(rows)) break
        rows.forEach((row, i) => {
          if (i > 0 && node.separator) out.push({ kind: 'text', text: node.separator })
          out.push(...evaluateInlineSeq(node.body, row, instance))
        })
        break
      }
    }
  }
  return out
}

/** 中身が空になった段落かどうか（省略可フィールドの跡）。 */
function isEmptySeq(inlines: Inline[]): boolean {
  return inlines.every((item) => item.kind === 'text' && item.text.trim() === '')
}

/**
 * `blockPart.body`（段落の列）を 1 本の `Inline[]` へ畳む。
 *
 * ⚠ **空になった段落は落とす。** 文法に条件分岐が無いので、省略可フィールド
 *  （`遭遇` の無い部屋・`トラップ` の無い部屋）を参照した段落は空で残る。
 *   これは**データの意味を見た分岐ではなく、評価結果が空かどうかという形の規則**である。
 */
function joinParagraphs(paragraphs: Inline[][]): Inline[] {
  const kept = paragraphs.filter((p) => !isEmptySeq(p))
  const out: Inline[] = []
  kept.forEach((paragraph, i) => {
    if (i > 0) out.push({ kind: 'text', text: '\n' })
    out.push(...paragraph)
  })
  return out
}

const PART_FORM_OF: Record<PartNode['node'], PartForm> = {
  blockPart: 'section',
  inlinePart: 'inline',
  figurePart: 'figure',
}

/**
 * `part` 1 つを評価する。
 * @param partId 本文に保存される識別子。`repeat` の中では `key:itemId`
 */
function evaluatePart(
  node: PartNode,
  partId: string,
  scope: unknown,
  instance: TemplateInstance,
): Part {
  const base = { instanceId: instance.id, partId, form: PART_FORM_OF[node.node] }
  switch (node.node) {
    case 'blockPart':
      return {
        ...base,
        title: inlinesToText(evaluateInlineSeq(node.title, scope, instance)),
        body: joinParagraphs(node.body.map((seq) => evaluateInlineSeq(seq, scope, instance))),
      }
    case 'inlinePart':
      return { ...base, title: '', body: evaluateInlineSeq(node.body, scope, instance) }
    case 'figurePart':
      // ⚠ **宣言だけが v0・描画は P4**（CONCEPT S8-2）。パートとしては生まれる（数に入る）。
      return {
        ...base,
        title: inlinesToText(evaluateInlineSeq(node.title, scope, instance)),
        body: [{ kind: 'text', text: `（図「${node.renderer}」は v0 では描画されません）` }],
      }
  }
}

/** `title` は文字列なので、評価した `Inline[]` からテキストだけを取り出す。 */
function inlinesToText(inlines: Inline[]): string {
  return inlines.map((item) => (item.kind === 'text' ? item.text : item.alt)).join('')
}

/**
 * ⭐ `outputs`（内部表現）を評価してパート列を作る。
 *
 * ⚠ ここが「**何個生まれるか**」と「**中身に何を出すか**」を**同時に**決める唯一の場所。
 *   `repeat` はその両方を一度に動かすので、旧設計の `parts` / `render` に分けられなかった（1-3 の注記）。
 */
export function evaluateOutputs(nodes: OutputNode[], instance: TemplateInstance): Part[] {
  const parts: Part[] = []
  for (const node of nodes) {
    if (node.node !== 'repeat') {
      parts.push(evaluatePart(node, node.key, instance.data, instance))
      continue
    }
    const rows = resolvePath(instance.data, node.over)
    if (!Array.isArray(rows)) continue
    for (const row of rows as Identified[]) {
      // ⚠ 添字ではなく要素の `id` を使う（1 件消しても後ろの配置がずれない・P0 知見 2）。
      parts.push(evaluatePart(node.body, `${node.key}:${row.id}`, row, instance))
    }
  }
  return parts
}
