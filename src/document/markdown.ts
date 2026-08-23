import MarkdownIt from 'markdown-it'
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Slice } from '@tiptap/pm/model'
import { documentSchema } from './schema'

/**
 * md の入出力。
 *
 * ⚠ **md は入出力形式の一つにすぎない**（DESIGN 1-2）。単一の真実は ProseMirror の `doc`。
 *    → このファイルを丸ごと消しても、保存データもモデルも無傷でいられる
 *      （= 依存 markdown-it / prosemirror-markdown の捨て方でもある）。
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
    heading(state, node) {
      state.write(state.repeat('#', Number(node.attrs.level) || 1) + ' ')
      state.renderInline(node, false)
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
  return doc
}

/** ドキュメント → md 文字列。 */
export function docToMd(doc: PMNode): string {
  return markdownSerializer.serialize(doc)
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
