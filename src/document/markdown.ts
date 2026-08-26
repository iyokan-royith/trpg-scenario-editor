import MarkdownIt from 'markdown-it'
import {
  MarkdownParser,
  MarkdownSerializer,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Slice } from '@tiptap/pm/model'
import { documentSchema } from './schema'
import { restoreHeadingMarks, markLength } from './heading'
import { PART_REF_INLINE_NODE, PART_REF_NODE } from './partRefExtension'
import { flattenOutline, outline } from './outline'
import { inlineText, partKeyOf, type Part } from '../template/model'
import { offsetMarkdownHeadings } from '../template/liquid/headingOffset'

/**
 * md の入出力。
 *
 * ⚠ **md は入出力形式の一つにすぎない**（DESIGN 1-2）。単一の真実は ProseMirror の `doc`。
 *    → このファイルを丸ごと消しても、保存データもモデルも無傷でいられる
 *      （= 依存 markdown-it / prosemirror-markdown の捨て方でもある）。
 *
 * ## 依存を足した理由（①なぜ ②なぜこれ ③どう捨てるか）
 *
 * - **①なぜ**: 貼り付け（#4）と往復（#5）で扱うのは**外から来る実物の md** である。
 *   自作パーサだと自作のフィクスチャでだけ緑になり、実物で崩れても気づけない。
 * - **②なぜこれ**（`prosemirror-markdown` + `markdown-it`）:
 *   - `prosemirror-markdown` は **ProseMirror 本体と同じ作者・同じ組織が出している公式パッケージ**で、
 *     `Schema` を引数に取る設計なので **Tiptap の独自ノード（`partRef`）を後から差し込める**。
 *     P3 でパート参照の展開を足すとき、**同じ表に 1 行足すだけで済む**のが決め手。
 *     ライセンス MIT・依存は `markdown-it` と `prosemirror-model` だけ。
 *   - `markdown-it` は **CommonMark 準拠を謳って実際に準拠試験を通している**実装で、
 *     `prosemirror-markdown` が既に内部で使っている（＝**新しく増える実体は無い**。
 *     transitive を明示宣言へ昇格させただけ）。
 *   - **採らなかった案**: ①自作パーサ（上記のとおり実物で崩れる）
 *     ②`marked` / `remark`（**ProseMirror への橋渡しを自分で書くことになり、
 *     `prosemirror-markdown` の利点が消える**。`remark` は生態系が大きく捨てにくい）
 *     ③Tiptap のサードパーティ md 拡張（**保守主体が個人で、
 *     Tiptap 本体のメジャー更新に追随する保証が無い**）。
 * - **③どう捨てるか**: **このファイルを消し、`App.vue` の md ボタンと
 *   `editor.ts` の `clipboardTextParser` の 3 箇所を外すだけ。**
 *   `doc` が真実なので**保存済みデータは 1 件も移行が要らない**。
 *
 * ⚠ `partRef` を含む md の往復は **P3 の責務**。P1 が扱うのは手書き本文だけ。
 *    書き出しでは参照ノードを **黙って捨てない**（下記 partRef のシリアライザを参照）。
 *
 * ## ⭐⭐ パート参照の展開（2026-08-26・§1-13-1h のロイス決定）
 *
 * `docToMd(doc, { parts })` を渡すと、パート参照は**コメントではなくそのパートの md 本文**として
 * 書き出され、そこで `offsetMarkdownHeadings`（§1-13-1d・P-c）が**配置階層ぶん**当たる。
 *
 * ⚠⚠ **何を捨てたかを正確に書いておく**（ロイス:「**読み戻す事は捨ててしまって構わない**」）:
 *
 * | | |
 * |---|---|
 * | 書き出した md を**読み戻す** | ⚠ **パート参照には戻らない**（展開された本文が手書き本文として入る） |
 * | 手書き本文の往復 | **無傷**（`mdToDoc` は 1 文字も変えていない） |
 * | 保存データ | **無傷**（md は入出力形式の一つで、単一の真実は `doc`・§1-2） |
 *
 * ⚠ **`parts` を渡さない `docToMd(doc)` は従来どおりコメントで書き出す。**
 *   これは互換のためではなく、**「素材一覧を知らない層」から呼ばれる経路が実在する**ため
 *   （P1 の往復テストなど）。展開できないのに黙って参照を消すのが最悪なので、
 *   その場合は今までどおり**消さずにコメントで残す**。
 */

/**
 * html: false は意図的。貼り付けた md に生 HTML が入っていても、
 * ただの文字列として扱う（自由 HTML はテンプレ側の契約であって、本文の貼り付け経路ではない）。
 */
const tokenizer = MarkdownIt('default', { html: false })

/**
 * markdown-it のトークン → Tiptap のノード名。
 * ⚠ prosemirror-markdown の既定表（`code_block` / `bullet_list` …）は
 *    prosemirror-schema-basic 用で、Tiptap のノード名と綴りが違う。ここで対応を書き直している。
 */
export function createMarkdownParser(schema: Schema): MarkdownParser {
  return new MarkdownParser(schema, tokenizer, {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList' },
    ordered_list: {
      block: 'orderedList',
      getAttrs: (tok) => ({ start: Number(tok.attrGet('start') ?? 1) || 1 }),
    },
    heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) || 1 }) },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: {
      block: 'codeBlock',
      getAttrs: (tok) => ({ language: tok.info || null }),
      noCloseToken: true,
    },
    hr: { node: 'horizontalRule' },
    hardbreak: { node: 'hardBreak' },
    // ⚠ 画像ノードは v0 のスキーマに無い（画像はテンプレインスタンス側の実体で、P3 の範囲）。
    //    無視しないとパーサが例外を投げるので明示的に落とす。
    //    要検証[P3 で画像を扱うとき、md 中の ![]() を落とさずに済む形になっているか。
    //           画像を含む md を貼って往復し、失われないことを確認したら閉じる]
    image: { ignore: true },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href') }) },
    code_inline: { mark: 'code', noCloseToken: true },
  })
}

/**
 * スキーマごとのパーサ置き場。
 *
 * ⚠⚠ **同じ拡張から作っても、Editor が持つ Schema は別インスタンスになる。**
 *   ProseMirror はノード型を **同一性** で比べるので、別スキーマで作った Slice を
 *   `replaceSelection()` に渡すと **例外も出さずに「何も起きない」**（P1 実装中に踏んだ）。
 *   → 貼り付け経路では必ず **エディタ自身のスキーマ**で解釈する。
 */
const parsers = new WeakMap<Schema, MarkdownParser>()

function parserFor(schema: Schema): MarkdownParser {
  let found = parsers.get(schema)
  if (!found) {
    found = createMarkdownParser(schema)
    parsers.set(schema, found)
  }
  return found
}

/**
 * パート参照 1 個ぶんの展開結果。`null` は「展開しない」＝コメントのまま出す。
 *
 * ⚠ `null` になるのは 2 通り: ①`parts` を渡されていない ②素材側から消えた参照（dangling）。
 *   どちらも**黙って消してはいけない**（消すと「書き出して読み戻したら参照が失われていた」
 *   という、往復テストが緑のまま起きる事故になる）。
 */
type ExpansionEntry = string | null

/**
 * ⚠⚠ **順番で消費する**（ノードの同一性では引けない）。
 *
 * ProseMirror の `Node` は**同じインスタンスが 2 箇所に現れうる**（コピー＆ペーストは
 * `Slice` の中のノードをそのまま挿す）。`Map<PMNode, level>` にすると、
 * **同じパートを 2 箇所に置いたとき（S7-3）に両方が同じ深さになる**——
 * しかも**例外は出ず、片方の深さが黙って間違う**。
 *
 * → だから「文書順に並べた配列＋カーソル」で持つ。
 *   ⚠ 代わりに**ずれる**危険が出るので、下の 2 つで鳴らす:
 *   ①カーソルが配列を越えたら throw ②書き出し後に「全部消費したか」を照合する。
 */
interface ExpansionCursor {
  entries: ExpansionEntry[]
  index: number
}

/** `serialize()` の `options` はそのまま `state.options` へ渡る（型が狭いので受け渡しだけ cast する）。 */
interface PartExpansionOption {
  partExpansion?: ExpansionCursor
}

type SerializeOptions = Parameters<MarkdownSerializer['serialize']>[1]

/**
 * 次のパート参照ぶんの展開結果を取り出す。
 *
 * ⚠ **オーバーランは黙って素通りさせない。** カーソル方式の唯一の弱点が
 *   「走査順のずれ」なので、ずれた瞬間に鳴らす（黙ると以降の深さが全部ずれる）。
 */
function takeExpansion(state: MarkdownSerializerState): ExpansionEntry {
  const cursor = (state.options as PartExpansionOption).partExpansion
  if (!cursor) return null
  if (cursor.index >= cursor.entries.length) {
    throw new Error(
      'パート参照の展開表を使い切りました（走査順が食い違っています）: ' +
        `${cursor.index + 1} 個目 / 表は ${cursor.entries.length} 個`,
    )
  }
  const entry = cursor.entries[cursor.index]!
  cursor.index += 1
  return entry
}

/**
 * 文書順に「各パート参照をどう展開するか」を決める（§1-13-1h）。
 *
 * ⭐⭐ **基準レベルは `outline(doc, parts)` が解決した最終の `level` を使う**（§1-13-1d 決定1b）。
 *   ⚠ `depthUnder(enclosing)` ではない——左ペインの上げ下げによる**明示の深さ**（`attrs.depth`）が
 *   優先される（§1-3-3e-2）ので、深さの単一の真実は `outline.ts` の側にある。
 *   ここで計算し直すと、**画面のツリーと書き出した md が食い違う**（台帳 A71 と同型）。
 *
 * ⚠ 走査は `doc.descendants` の**絶対 pos**で、`outline()` が inline 参照に付ける
 *   `offset + 1 + childPos` と同じ値になる（テストで固定してある）。
 *
 * ⚠ **`outline()` に出ないパート参照がある**（`form` が `section` でないもの＝図・本文中）。
 *   それらは**見出しの深さが定義されない**ので、**オフセットせず本文をそのまま出す**。
 */
function buildExpansionPlan(doc: PMNode, parts: Part[]): ExpansionEntry[] {
  const index = new Map(parts.map((part) => [partKeyOf(part.instanceId, part.partId), part]))
  const levelByPos = new Map<number, number>()
  for (const item of flattenOutline(outline(doc, parts))) {
    if (item.kind === 'partRef') levelByPos.set(item.pos, item.level)
  }

  const entries: ExpansionEntry[] = []
  doc.descendants((node, pos) => {
    const name = node.type.name
    if (name !== PART_REF_NODE && name !== PART_REF_INLINE_NODE) return true

    const part = index.get(partKeyOf(String(node.attrs.instanceId), String(node.attrs.partId)))
    // dangling（素材側から消えた参照）はコメントのまま残す。
    if (!part) {
      entries.push(null)
      return false
    }

    // ⚠ `inlineText` は画像の `Inline` を alt 文字列に畳む。md の画像書き出しは
    //   §1-13 の未決事項（「md 書き出しで何を画像化するか」）なので、ここでは決めない。
    //   `要検証[画像を HTML/md にどう載せるかが決まったとき、ここが alt でよいかを取り直す]`
    const body = inlineText(part.body)

    // ⚠ inline の参照は**段落の途中**に居るので、見出しという概念が無い。オフセットしない。
    const baseLevel = name === PART_REF_INLINE_NODE ? undefined : levelByPos.get(pos)
    entries.push(baseLevel === undefined ? body : offsetMarkdownHeadings(body, baseLevel))
    return false
  })
  return entries
}

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node))
    },
    codeBlock(state, node) {
      const backticks = node.textContent.match(/`{3,}/gm)
      const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```'
      state.write(fence + (node.attrs.language || '') + '\n')
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write(fence)
      state.closeBlock(node)
    },
    /**
     * ⚠⚠ **記号は本文のテキストとして既に入っている**（CONCEPT Q2 改訂・2026-08-23）。
     *   だから `'#'.repeat(level)` を足すと **`## ## みだし` と二重になる**。
     *   ここが「記号を剥がす層」の 1 つ目。
     *
     * ⚠ 記号だけは `state.write()` で**生のまま**書く。
     *   通常の inline として出すと、行頭の `#` が md のエスケープ対象になり `\## ` になる。
     */
    heading(state, node) {
      const text = node.textContent
      const length = markLength(text)
      // ⚠ 記号が無い見出しはここへ来ない（docToMd の入口で `restoreHeadingMarks` を通している）。
      //   ⚠⚠ **ここで attrs から補う分岐を持たせない。** 以前それを持っていたせいで、
      //   同じ doc に対して md だけが「見出しとして出す」と答え、ツリーと編集は別の答えを出していた。
      //   記号が無い heading をどう解釈するかは `heading.ts` の 1 箇所だけが決める。
      state.write(text.slice(0, length))
      state.renderInline(node.copy(node.content.cut(length)), false)
      state.closeBlock(node)
    },
    horizontalRule(state, node) {
      state.write('---')
      state.closeBlock(node)
    },
    bulletList(state, node) {
      state.renderList(node, '  ', () => '* ')
    },
    orderedList(state, node) {
      const start = Number(node.attrs.start) || 1
      const maxWidth = String(start + node.childCount - 1).length
      const space = state.repeat(' ', maxWidth + 2)
      state.renderList(node, space, (i) => {
        const label = String(start + i)
        return state.repeat(' ', maxWidth - label.length) + label + '. '
      })
    },
    listItem(state, node) {
      state.renderContent(node)
    },
    paragraph(state, node) {
      state.renderInline(node)
      state.closeBlock(node)
    },
    hardBreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n')
          return
        }
      }
    },
    text(state, node) {
      state.text(node.text ?? '')
    },
    /**
     * ⭐ `parts` を渡されていれば**パートの md 本文へ展開する**（§1-13-1h）。
     *   渡されていない／dangling のときは **黙って消さず**コメントで残す
     *   （消すと「書き出して読み戻したら参照が失われていた」という、
     *   往復テストが緑のまま起きる事故になる）。
     *
     * ⚠ `state.text(body, false)` で書くのは 2 つの理由から:
     *   ①`escape: false` — 本文は**もう md である**。エスケープすると `#` が `\#` になる
     *   ②`text()` は改行で分けて各行に `delim` を付けてくれる（`write()` は 1 行用）
     */
    partRef(state, node) {
      const expanded = takeExpansion(state)
      state.text(
        expanded ?? `<!-- partRef ${node.attrs.instanceId} ${node.attrs.partId} -->`,
        false,
      )
      state.closeBlock(node)
    },
    /**
     * ⚠ inline 版は**オフセットしない**（段落の途中に見出しは無い・`buildExpansionPlan` を参照）。
     *   ⚠ `state.text(..., false)` にするのは、`<!-- -->` の記号を md にエスケープさせないため
     *   （`state.write` はブロックの行頭に書く関数なので、文の途中には使えない）。
     */
    partRefInline(state, node) {
      const expanded = takeExpansion(state)
      state.text(
        expanded ?? `<!-- partRef ${node.attrs.instanceId} ${node.attrs.partId} -->`,
        false,
      )
    },
  },
  {
    italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    code: {
      open: '`',
      close: '`',
      escape: false,
    },
    link: {
      open: '[',
      close: (_state, mark) => `](${String(mark.attrs.href ?? '')})`,
      mixable: true,
    },
    // md に対応する記法が無いもの。落とすが、文字は残す。
    underline: { open: '', close: '', mixable: true },
  },
)

/** md 文字列 → ドキュメント。 */
export function mdToDoc(markdown: string, schema: Schema = documentSchema): PMNode {
  const doc = parserFor(schema).parse(markdown)
  if (!doc) throw new Error('md を解釈できませんでした')
  return restoreHeadingMarks(doc)
}

/** `docToMd` の追加入力。 */
export interface DocToMdOptions {
  /**
   * パート参照を展開するための素材一覧（§1-13-1h）。
   * ⚠ 省略すると従来どおり `<!-- partRef ... -->` のコメントで書き出す。
   */
  parts?: Part[]
}

/**
 * ドキュメント → md 文字列。
 *
 * ⚠ 入口で記号を補う（`heading.ts` の不変条件）。
 *   ここを通さないと、**外から渡された「記号の無い見出し」を md だけが見出しとして出し、
 *   ツリーは落とす**という食い違いが復活する（3巡目監査の差し戻し）。
 */
export function docToMd(doc: PMNode, options: DocToMdOptions = {}): string {
  // ⚠⚠ **記号を補った後の doc で計画を立てる。** `restoreHeadingMarks` は見出しの
  //   テキスト長を変えうるので、補う前の doc で位置を測ると `outline()` の pos とずれる。
  const restored = restoreHeadingMarks(doc)
  if (!options.parts) return markdownSerializer.serialize(restored)

  const cursor: ExpansionCursor = { entries: buildExpansionPlan(restored, options.parts), index: 0 }
  // ⚠ `serialize()` の options の型は `{ tightLists?: boolean }` としか宣言されていないが、
  //   実体は**そのまま `state.options` に置かれる**（prosemirror-markdown の設計・d.ts の注記
  //   「The options passed to the serializer」）。型が狭いだけなので、受け渡しだけ cast する。
  const out = markdownSerializer.serialize(restored, {
    partExpansion: cursor,
  } as unknown as SerializeOptions)
  // ⚠⚠ **消費し残しは「走査順がずれた」の証拠**（シリアライザが参照を 1 個飛ばした）。
  //   飛ばされると以降の展開が 1 個ずつずれ、**深さが黙って間違う**ので、ここで鳴らす。
  if (cursor.index !== cursor.entries.length) {
    throw new Error(
      'パート参照の展開表が余りました（走査順が食い違っています）: ' +
        `${cursor.index} 個消費 / 表は ${cursor.entries.length} 個`,
    )
  }
  return out
}

/**
 * 貼り付け用の Slice を作る（完了条件 #4: 1 個のテキスト塊にならない）。
 *
 * ⚠ 段落 1 個だけの md（＝ただの一行）は、カーソル位置にそのまま流し込みたいので
 *    開いた Slice にする。複数ブロックのときだけ閉じた Slice にしてブロックとして落とす。
 */
export function markdownSlice(markdown: string, schema: Schema = documentSchema): Slice {
  const doc = mdToDoc(markdown, schema)
  const onlyOneParagraph = doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph'
  return onlyOneParagraph ? Slice.maxOpen(doc.content) : new Slice(doc.content, 0, 0)
}
