/**
 * P1-3: 左ペインからの並べ替え・階層変更で、本文の順序が実際に変わる。
 *
 * ⚠ ここで検証しているのは **ドキュメントへの操作**だけ。
 *   左ペインの操作（dragstart/drop・階層ボタン）から App のハンドラを経てここへ届くまでの
 *   配線は `src/__tests__/App.spec.ts` が jsdom の DOM イベントで通している。
 *   両方を合わせても、なお通っていないのは次の層だけ:
 *   要検証[実ブラウザで、HTML5 のドラッグ&ドロップ（実際のマウス操作・dataTransfer 込み）で
 *          左ペインの項目を並べ替えられることを目視確認する。
 *          jsdom の dragstart/drop は dataTransfer を持たない合成イベントなので、
 *          ブラウザ既定のドラッグ挙動（drag image・dropEffect）までは再現していない]
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import {
  dropTargetPos,
  moveSection,
  sectionRangeAt,
  setSectionLevel,
  topLevelBoundaries,
} from '../sections'
import { flattenOutline, outline } from '../outline'
import { headingTitle, headingMark } from '../heading'

/** ⚠ 記号は本物のテキスト（CONCEPT Q2 改訂・2026-08-23）。 */
function heading(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: headingMark(level) + text }],
  }
}
function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

let editor: Editor

/** doc 直下のブロックの開始位置（並び順） */
function boundaries(): number[] {
  return topLevelBoundaries(editor.state.doc)
}

/** ⚠ 見出しには記号が入っているので、並びの照合では剥がす（ツリーと同じ見え方にする）。 */
function bodyTitles(): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => out.push(headingTitle(node.textContent)))
  return out
}

beforeEach(() => {
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        heading(1, 'あかしょう'),
        paragraph('あかの本文'),
        heading(2, 'あかのせつ'),
        paragraph('あかのせつの本文'),
        heading(1, 'あおしょう'),
        paragraph('あおの本文'),
      ],
    },
  })
})

describe('節の範囲', () => {
  it('見出しの範囲は、次の同レベル以上の見出しの手前まで（配下を全部含む）', () => {
    const range = sectionRangeAt(editor.state.doc, 0)!
    expect(range.level).toBe(1)
    // 「あかしょう」節は 4 ブロック（見出し・本文・小見出し・本文）
    expect(range.from).toBe(boundaries()[0])
    expect(range.to).toBe(boundaries()[4])
  })

  it('見出しでないブロックはそのブロック 1 個だけ', () => {
    const paragraphPos = boundaries()[1]!
    const range = sectionRangeAt(editor.state.doc, paragraphPos)!
    expect(range.level).toBeNull()
    expect(range.to).toBe(boundaries()[2])
  })
})

describe('P1-3a: 並べ替え', () => {
  it('あとの節を先頭へ移すと、本文の順序が実際に変わる', () => {
    const blue = boundaries()[4]!
    const tr = moveSection(editor.state, blue, 0)!
    editor.view.dispatch(tr)

    expect(bodyTitles()).toEqual([
      'あおしょう',
      'あおの本文',
      'あかしょう',
      'あかの本文',
      'あかのせつ',
      'あかのせつの本文',
    ])
  })

  it('節を動かすとツリーも追従する（ツリーは別データを持たない）', () => {
    editor.view.dispatch(moveSection(editor.state, boundaries()[4]!, 0)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('見出しを動かすと配下も一緒に動く', () => {
    editor.view.dispatch(moveSection(editor.state, 0, editor.state.doc.content.size)!)
    const tree = outline(editor.state.doc)
    expect(tree.map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
    expect(tree[1]!.children.map((i) => i.title)).toEqual(['あかのせつ'])
  })

  it('自分自身の内側へは移せない（移せたら節が消える）', () => {
    const insidePos = boundaries()[2]!
    expect(moveSection(editor.state, 0, insidePos)).toBeNull()
  })

  it('ブロック境界でない位置は受け付けない', () => {
    expect(moveSection(editor.state, 0, 1)).toBeNull()
  })
})

describe('P1-3a: 落とした先 → 挿入位置の翻訳（dropTargetPos）', () => {
  it('⭐ すぐ下の兄弟へ落とすと「1 つ下へ動く」（相手のうしろ）', () => {
    // ⚠ ここが「相手の前に挿す」意味だと、動かない位置を指してしまい
    //   リスト UI でいちばん自然な「1 つ下へ」が死ぬ。
    const red = boundaries()[0]!
    const blue = boundaries()[4]!
    const dest = dropTargetPos(editor.state.doc, red, blue)!
    expect(dest).toBe(editor.state.doc.content.size)

    editor.view.dispatch(moveSection(editor.state, red, dest)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('すぐ上の兄弟へ落とすと「1 つ上へ動く」（相手のまえ）', () => {
    const blue = boundaries()[4]!
    const red = boundaries()[0]!
    const dest = dropTargetPos(editor.state.doc, blue, red)!
    expect(dest).toBe(0)

    editor.view.dispatch(moveSection(editor.state, blue, dest)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('自分自身・自分の配下へは落とせない', () => {
    expect(dropTargetPos(editor.state.doc, 0, 0)).toBeNull()
    expect(dropTargetPos(editor.state.doc, 0, boundaries()[2]!)).toBeNull()
  })
})

describe('P1-3b: 階層変更', () => {
  it('見出しのレベルを下げると、配下の見出しも同じだけ下がる', () => {
    editor.view.dispatch(setSectionLevel(editor.state, 0, 2)!)
    const flat = flattenOutline(outline(editor.state.doc))
    expect(flat.map((i) => [i.title, i.level])).toEqual([
      ['あかしょう', 2],
      ['あかのせつ', 3],
      ['あおしょう', 1],
    ])
  })

  it('階層を上げると、ツリーの親子関係が変わる', () => {
    // 「あかのせつ」(level 2) を level 1 にすると、あかしょうの子ではなくなる
    editor.view.dispatch(setSectionLevel(editor.state, boundaries()[2]!, 1)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual([
      'あかしょう',
      'あかのせつ',
      'あおしょう',
    ])
  })

  it('範囲外のレベルは受け付けない', () => {
    expect(setSectionLevel(editor.state, 0, 0)).toBeNull()
    expect(setSectionLevel(editor.state, 0, 7)).toBeNull()
  })

  it('見出しでないブロックには効かない（深さは位置で決まるので移動で表す）', () => {
    expect(setSectionLevel(editor.state, boundaries()[1]!, 2)).toBeNull()
  })
})
