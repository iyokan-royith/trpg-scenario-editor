import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const currentBlockKey = new PluginKey<boolean>('currentBlock')

/**
 * 「いまカーソルが居るブロック」に印を付ける（要望1・2026-08-23）。
 *
 * ロイスの指摘:
 * > 入力されている範囲の枠線は不適切に見えます。
 * > 「ブロックが選択されている」事を示すのであればブロック単位で示したほうがいい。
 *
 * ⚠ 元の枠は **ブラウザが `contenteditable` に付ける既定の outline** で、
 *   こちらが意図して描いたものではなかった（App.vue に focus 用の CSS は 1 行も無かった）。
 *   既定の outline は CSS で消すので、**フォーカスの所在を示す責任がここに移る**
 *   （消しっぱなしにするとキーボード利用者が現在地を見失う）。
 *
 * ⚠ エディタにフォーカスが無いときは印を出さない。
 *   「どのブロックに居るか」ではなく「**いまここに入力される**」を示すための印だから。
 *
 * ⚠⚠ フォーカスの有無を `view.hasFocus()` で読まず、**DOM の focus/blur を受けて
 *   プラグインの state に持つ**。理由は 2 つ:
 *   ①フォーカスの出入りは state を変えないので、`hasFocus()` を読む形だと
 *     装飾が計算し直されない（＝印が古いまま残る）
 *   ②`hasFocus()` は jsdom で常に false になるため、**その形にすると
 *     この機能はテストで 1 度も通らないまま緑になる**
 */
export const CurrentBlock = Extension.create({
  name: 'currentBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: currentBlockKey,

        state: {
          init: () => false,
          apply(tr, previous) {
            const signal = tr.getMeta(currentBlockKey)
            return typeof signal === 'boolean' ? signal : previous
          },
        },

        props: {
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(currentBlockKey, true))
              return false
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(currentBlockKey, false))
              return false
            },
          },

          decorations(state) {
            if (!currentBlockKey.getState(state)) return DecorationSet.empty

            const { from, to } = state.selection
            const decorations: Decoration[] = []
            state.doc.forEach((node, pos) => {
              const end = pos + node.nodeSize
              // 選択範囲に少しでも重なっているブロックに印を付ける
              // （複数ブロックにまたがる選択もそのまま示せる）
              if (end <= from || pos >= to) return
              decorations.push(Decoration.node(pos, end, { class: 'current-block' }))
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
