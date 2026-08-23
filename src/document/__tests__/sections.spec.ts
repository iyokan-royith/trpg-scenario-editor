/**
 * P1-3: 左ペインからの並べ替え・階層変更で、本文の順序が実際に変わる。
 *
 * ⚠ ここで検証しているのは **ドキュメントへの操作**であって、
 *   マウスのドラッグ操作（DOM イベント）ではない。
 *   要検証[実際のブラウザ（npm run dev）で、左ペインの項目をドラッグして
 *          並べ替え・階層変更ができることを目視確認する]
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import { moveSection, sectionRangeAt, setSectionLevel, topLevelBoundaries } from '../sections'
import { flattenOutline, outline } from '../outline'

function 見出し(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}
function 段落(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

let editor: Editor

/** doc 直下のブロックの開始位置（並び順） */
function 境界(): number[] {
  return topLevelBoundaries(editor.state.doc)
}

function 本文の並び(): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => out.push(node.textContent))
  return out
}

beforeEach(() => {
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        見出し(1, 'あかしょう'),
        段落('あかの本文'),
        見出し(2, 'あかのせつ'),
        段落('あかのせつの本文'),
        見出し(1, 'あおしょう'),
        段落('あおの本文'),
      ],
    },
  })
})

describe('節の範囲', () => {
  it('見出しの範囲は、次の同レベル以上の見出しの手前まで（配下を全部含む）', () => {
    const range = sectionRangeAt(editor.state.doc, 0)!
    expect(range.level).toBe(1)
    // 「あかしょう」節は 4 ブロック（見出し・本文・小見出し・本文）
    expect(range.from).toBe(境界()[0])
    expect(range.to).toBe(境界()[4])
  })

  it('見出しでないブロックはそのブロック 1 個だけ', () => {
    const 段落の位置 = 境界()[1]!
    const range = sectionRangeAt(editor.state.doc, 段落の位置)!
    expect(range.level).toBeNull()
    expect(range.to).toBe(境界()[2])
  })
})

describe('P1-3a: 並べ替え', () => {
  it('あとの節を先頭へ移すと、本文の順序が実際に変わる', () => {
    const あお = 境界()[4]!
    const tr = moveSection(editor.state, あお, 0)!
    editor.view.dispatch(tr)

    expect(本文の並び()).toEqual([
      'あおしょう',
      'あおの本文',
      'あかしょう',
      'あかの本文',
      'あかのせつ',
      'あかのせつの本文',
    ])
  })

  it('節を動かすとツリーも追従する（ツリーは別データを持たない）', () => {
    editor.view.dispatch(moveSection(editor.state, 境界()[4]!, 0)!)
    expect(outline(editor.state.doc).map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
  })

  it('見出しを動かすと配下も一緒に動く', () => {
    editor.view.dispatch(moveSection(editor.state, 0, editor.state.doc.content.size)!)
    const tree = outline(editor.state.doc)
    expect(tree.map((i) => i.title)).toEqual(['あおしょう', 'あかしょう'])
    expect(tree[1]!.children.map((i) => i.title)).toEqual(['あかのせつ'])
  })

  it('自分自身の内側へは移せない（移せたら節が消える）', () => {
    const 自分の中 = 境界()[2]!
    expect(moveSection(editor.state, 0, 自分の中)).toBeNull()
  })

  it('ブロック境界でない位置は受け付けない', () => {
    expect(moveSection(editor.state, 0, 1)).toBeNull()
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
    editor.view.dispatch(setSectionLevel(editor.state, 境界()[2]!, 1)!)
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
    expect(setSectionLevel(editor.state, 境界()[1]!, 2)).toBeNull()
  })
})
