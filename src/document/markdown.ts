import MarkdownIt from 'markdown-it'
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Slice } from '@tiptap/pm/model'
import { documentSchema } from './schema'
import { 記号を補う, 記号の長さ } from './heading'

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
      const 長さ = 記号の長さ(text)
      // ⚠ 記号が無い見出しはここへ来ない（docToMd の入口で `記号を補う` を通している）。
      //   ⚠⚠ **ここで attrs から補う分岐を持たせない。** 以前それを持っていたせいで、
      //   同じ doc に対して md だけが「見出しとして出す」と答え、ツリーと編集は別の答えを出していた。
      //   記号が無い heading をどう解釈するかは `heading.ts` の 1 箇所だけが決める。
      state.write(text.slice(0, 長さ))
      state.renderInline(node.copy(node.content.cut(長さ)), false)
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
     * ⚠ P1 の md にはパートの中身を展開しない（展開は P3 の責務）。
     *   ただし **黙って消しはしない**。消すと「書き出して読み戻したら参照が失われていた」
     *   という、往復テストが緑のまま起きる事故になる。
     */
    partRef(state, node) {
      state.write(`<!-- partRef ${node.attrs.instanceId} ${node.attrs.partId} -->`)
      state.closeBlock(node)
    },
    /**
     * ⚠ inline 版も同じ理由で **黙って消さない**。
     *   ⚠ `state.text(..., false)` にするのは、`<!-- -->` の記号を md にエスケープさせないため
     *   （`state.write` はブロックの行頭に書く関数なので、文の途中には使えない）。
     */
    partRefInline(state, node) {
      state.text(`<!-- partRef ${node.attrs.instanceId} ${node.attrs.partId} -->`, false)
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
  return 記号を補う(doc)
}

/**
 * ドキュメント → md 文字列。
 *
 * ⚠ 入口で記号を補う（`heading.ts` の不変条件）。
 *   ここを通さないと、**外から渡された「記号の無い見出し」を md だけが見出しとして出し、
 *   ツリーは落とす**という食い違いが復活する（3巡目監査の差し戻し）。
 */
export function docToMd(doc: PMNode): string {
  return markdownSerializer.serialize(記号を補う(doc))
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
