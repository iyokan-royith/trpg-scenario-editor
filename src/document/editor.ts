import { Editor, type EditorOptions } from '@tiptap/vue-3'
import { documentExtensions } from './schema'
import { markdownSlice } from './markdown'

/**
 * P1 のエディタを組み立てる唯一の入口。
 *
 * ⚠ アプリ（App.vue）とテストが同じ経路でエディタを作ること自体が目的。
 *    別々に組むと「テストでは通るがアプリでは違う挙動」という差分が生まれる。
 */
export function createDocumentEditor(options: Partial<EditorOptions> = {}): Editor {
  return new Editor({
    extensions: documentExtensions,
    ...options,
    editorProps: {
      /**
       * 完了条件 #4: md を貼り付けるとブロックに分解される。
       * ⚠ ProseMirror の既定はテキストを段落に流し込むだけなので、`## ` は文字のまま残る。
       */
      /**
       * ⚠⚠ 解釈は必ず **貼り付け先のスキーマ**で行う（`$context` から取る）。
       *   同じ拡張から作ったスキーマでも Editor が持つものとは別インスタンスで、
       *   型が食い違った Slice は例外も出さずに握り潰される。
       */
      clipboardTextParser: (text, $context) => markdownSlice(text, $context.doc.type.schema),
      ...options.editorProps,
    },
  })
}
