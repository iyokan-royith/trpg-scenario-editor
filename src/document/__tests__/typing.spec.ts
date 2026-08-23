/**
 * P1-1: 見出し記号（`## `）を打つとその場で見出しブロックになる。
 * P1-4: md を貼り付けるとブロックに分解される（貼り付け経路の配線ごと確かめる）。
 *
 * ⚠ ここで通しているのは ProseMirror の `handleTextInput` / `clipboardTextParser`。
 *   実際のキーボード入力・OS のクリップボードまでは通していない。
 *   要検証[実際のブラウザ（npm run dev）で「## 」と打つと見出しになり、
 *          md をクリップボードから貼るとブロックに分解されることを目視確認する]
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/vue-3'
import { createDocumentEditor } from '../editor'

let editor: Editor

/** 入力規則を通す経路で 1 文字ずつ打つ（ProseMirror のテキスト入力と同じ道）。 */
function 打つ(text: string) {
  for (const char of text) {
    const { state, view } = editor
    const { from, to } = state.selection
    // 第 5 引数は「規則が何もしなかったときの既定のトランザクション」を作る関数（本物と同じ形）
    const 既定 = () => state.tr.insertText(char, from, to)
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char, 既定))
    if (!handled) view.dispatch(既定())
  }
}

function ブロックの種類(): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => out.push(node.type.name))
  return out
}

beforeEach(() => {
  editor = createDocumentEditor({ content: { type: 'doc', content: [{ type: 'paragraph' }] } })
})

afterEach(() => {
  editor?.destroy()
})

/**
 * ⭐⭐ 2026-08-23 の CONCEPT Q2 改訂（ロイス指示「ア＝ソース方式」）で **期待値が反転した**。
 *   旧: 「`## ` を打つと**記号が消えて**見出しになる」
 *   新: 「見出しになるが、**記号は本物のテキストとして残り、編集できる**。消せば段落に戻る」
 *   ⚠ テストを甘くしたのではなく、**仕様が変わった**。
 */
describe('P1-1: 見出し記号を打つと見出しになるが、記号は残る', () => {
  it('⭐ 「## 」を打つと見出しになり、記号は本文に残っている', () => {
    打つ('## みだし')
    // ⚠ 末尾の空段落は StarterKit の TrailingNode（見出しの後ろに書けるようにする）。
    expect(ブロックの種類()).toEqual(['heading', 'paragraph'])
    expect(editor.state.doc.child(0).attrs.level).toBe(2)
    // ⭐ ここが改訂の中身。記号が消えたら「勝手に消された」ことになる
    expect(editor.state.doc.textContent).toBe('## みだし')
  })

  it('「# 」なら level 1 になる', () => {
    打つ('# おおみだし')
    expect(editor.state.doc.child(0).attrs.level).toBe(1)
    expect(editor.state.doc.textContent).toBe('# おおみだし')
  })

  it('⭐ 記号を消すと段落に戻る', () => {
    打つ('## みだし')
    expect(ブロックの種類()[0]).toBe('heading')
    // 記号 3 文字（`## `）を消す
    editor.view.dispatch(editor.state.tr.delete(1, 4))
    expect(ブロックの種類()[0]).toBe('paragraph')
    expect(editor.state.doc.textContent).toBe('みだし')
  })

  it('⭐ 記号を足すとレベルが変わる（メタデータをテキストとして編集できる）', () => {
    打つ('## みだし')
    editor.view.dispatch(editor.state.tr.insertText('#', 1, 1))
    expect(editor.state.doc.child(0).attrs.level).toBe(3)
    expect(editor.state.doc.textContent).toBe('### みだし')
  })

  it('記号でない先頭文字は段落のまま（陰性対照）', () => {
    打つ('ふつうの本文')
    expect(ブロックの種類()).toEqual(['paragraph'])
    expect(editor.state.doc.textContent).toBe('ふつうの本文')
  })

  it('スペースが無ければ見出しにしない（陰性対照・`#タグ` を壊さない）', () => {
    打つ('#タグ')
    expect(ブロックの種類()).toEqual(['paragraph'])
  })

  it('`#` が 7 つ以上なら見出しにしない（陰性対照）', () => {
    打つ('####### ななつ')
    expect(ブロックの種類()).toEqual(['paragraph'])
  })
})

describe('P1-4: 貼り付け経路が md をブロックに分解する', () => {
  it('clipboardTextParser が配線されていて、複数ブロックの Slice を返す', () => {
    const md = ['# しょう', '', 'ほんぶん。', '', '* いち', '* に'].join('\n')
    const { view, state } = editor
    const slice = view.someProp('clipboardTextParser', (f) =>
      f(md, state.doc.resolve(0), false, view),
    )
    expect(slice).toBeDefined()
    expect(slice!.content.childCount).toBeGreaterThan(1)
  })

  it('貼り付けた結果がドキュメントに入るとブロックに分解されている', () => {
    const md = ['# しょう', '', 'ほんぶん。', '', '* いち', '* に'].join('\n')
    const { view } = editor
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    const slice = view.someProp('clipboardTextParser', (f) =>
      f(md, view.state.doc.resolve(1), false, view),
    )!
    view.dispatch(view.state.tr.replaceSelection(slice))

    expect(ブロックの種類()).toEqual(['heading', 'paragraph', 'bulletList', 'paragraph'])
    expect(editor.state.doc.child(0).attrs.level).toBe(1)
  })
})
