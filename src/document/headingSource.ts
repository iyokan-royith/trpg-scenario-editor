import { Extension } from '@tiptap/core'
import Heading from '@tiptap/extension-heading'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { headingLevel, markLength } from './heading'

/**
 * ソース方式の見出し（CONCEPT Q2 改訂・2026-08-23）。
 *
 * ⚠ 既定の Heading が持っている **入力規則とキーボード近道を外している**。
 *   どちらも「記号を消して見出しにする」「記号なしで見出しにする」動作で、
 *   **記号が本文に残るという新しい規約と正面からぶつかる**（記号の無い見出しが生まれる）。
 *   見出しになる道は「本文に記号を打つ」1 本だけにする。
 */
export const SourceHeading = Heading.extend({
  addInputRules() {
    return []
  },
  addKeyboardShortcuts() {
    return {}
  },
})

export const headingSyncKey = new PluginKey('headingSync')

/**
 * **本文のテキストを唯一の真実として、段落 ⇄ 見出しを合わせ続ける。**
 *
 * - 記号が付いた → 見出しになる（完了条件 #1 の前半）
 * - 記号が消えた → 段落に戻る（同・後半）
 * - 記号の数が変わった → `attrs.level` が追いかける（`<h3>` を出すための表示上のヒント）
 *
 * ⚠ **これは「導出値をデータ側に持たせる」ことではない。**
 *   ふるまい（ツリー・並べ替え・md 出力）は誰も `attrs.level` を読まず、
 *   必ず `heading.ts` の関数で本文から導出している。
 *   ここで揃えているのは**描画に使うタグ名だけ**なので、ずれても壊れるのは見た目であり、
 *   しかもこの appendTransaction が次の 1 手で直す。
 *
 * ⚠ `setNodeMarkup` はノードの大きさを変えないので、**カーソル位置は動かない**。
 */
export const HeadingSync = Extension.create({
  name: 'headingSync',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingSyncKey,

        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null

          const paragraph = newState.schema.nodes.paragraph
          const heading = newState.schema.nodes.heading
          if (!paragraph || !heading) return null

          const tr = newState.tr
          let changed = false

          newState.doc.forEach((node, pos) => {
            const isBlockText = node.type === paragraph || node.type === heading
            if (!isBlockText) return

            const level = headingLevel(node.textContent)

            if (level === null) {
              if (node.type === heading) {
                tr.setNodeMarkup(pos, paragraph, {}, node.marks)
                changed = true
              }
              return
            }
            if (node.type !== heading || Number(node.attrs.level) !== level) {
              tr.setNodeMarkup(pos, heading, { ...node.attrs, level }, node.marks)
              changed = true
            }
          })

          return changed ? tr : null
        },

        props: {
          /**
           * 記号を**淡く**見せる（メタデータをメタデータとして見せる）。
           * ⚠ これは装飾であって本文ではない。記号そのものは本物のテキストのまま残っている。
           */
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.forEach((node, pos) => {
              if (node.type.name !== 'heading') return
              const length = markLength(node.textContent)
              if (length === 0) return
              decorations.push(
                Decoration.inline(pos + 1, pos + 1 + length, { class: 'heading-mark' }),
              )
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
