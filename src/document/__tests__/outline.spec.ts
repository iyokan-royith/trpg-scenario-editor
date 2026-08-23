/**
 * P1-2 / 契約: `outline(doc, parts)`（DESIGN 1-6-4）
 *
 * ⚠ 検証データは全て創作。実素材の語彙は 1 語も持ち込まない。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import { headingMark, markLength } from '../heading'
import { outline, flattenOutline } from '../outline'
import { PART_REF_INLINE_NODE, PART_REF_NODE } from '../partRefExtension'
import {
  derivePartsOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../../template/model'

const definition: TemplateDefinition = {
  id: 'ぶんぼうぐ',
  name: 'ぶんぼうぐテンプレ',
  version: '0.1.0',
  fields: [],
  outputs: [
    { key: 'まえおき', kind: 'fixed', label: 'まえおき', form: 'section' },
    { key: 'ひきだし', kind: 'perItem', source: 'ひきだし', label: 'ひきだし', form: 'section' },
    { key: 'ずかい', kind: 'fixed', label: 'ずかい', form: 'figure' },
  ],
}

const instance: TemplateInstance = {
  id: 'i1',
  templateId: 'ぶんぼうぐ',
  images: {},
  data: {
    まえおき: 'まえおきの本文',
    ずかい: 'ずの本文',
    ひきだし: [
      { id: 'h1', name: 'けしごむ', body: 'けしごむの説明' },
      { id: 'h2', name: 'ものさし', body: 'ものさしの説明' },
    ],
  },
}

const parts: Part[] = derivePartsOf(instance, definition)

function makeRef(partId: string) {
  return { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId } }
}

/**
 * ⚠ 2026-08-23 の CONCEPT Q2 改訂で、**見出し記号は本物のテキストとして本文に入る**。
 *   フィクスチャも記号を含む形にする（＝これが新しい仕様。テストを甘くしたのではない）。
 */
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

beforeEach(() => {
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        heading(1, 'だいいちしょう'),
        paragraph('てがきの本文'),
        heading(2, 'せつ'),
        makeRef('ひきだし:h1'), // 独立chapter → treeOfに出る
        makeRef('ずかい'), // 図 → treeOfに出ない
        heading(1, 'だいにしょう'),
      ],
    },
  })
})

describe('P1-2: ツリーは doc から導出される（別データを持たない）', () => {
  it('見出しの階層がそのままツリーになる', () => {
    const tree = outline(editor.state.doc, parts)
    expect(tree.map((i) => i.title)).toEqual(['だいいちしょう', 'だいにしょう'])
    expect(tree[0]!.children.map((i) => i.title)).toEqual(['せつ'])
  })

  it('本文を編集するとツリーが追従する（ツリー側を触っていない）', () => {
    const headingPos = 0
    const node = editor.state.doc.nodeAt(headingPos)!
    // 記号のうしろ（題名の部分）だけを書き換える
    editor.view.dispatch(
      editor.state.tr.insertText(
        'かきかえ',
        headingPos + 1 + markLength(node.textContent),
        headingPos + node.nodeSize - 1,
      ),
    )
    expect(outline(editor.state.doc, parts)[0]!.title).toBe('かきかえ')
  })

  it('⭐ 記号を消すと見出しでなくなり、ツリーから消える（完了条件 #1 の後半）', () => {
    const node = editor.state.doc.nodeAt(0)!
    editor.view.dispatch(editor.state.tr.delete(1, 1 + markLength(node.textContent)))
    expect(outline(editor.state.doc, parts).map((i) => i.title)).not.toContain('だいいちしょう')
  })

  it('⭐ 記号の数を変えると、その場でレベルが変わる', () => {
    editor.view.dispatch(editor.state.tr.insertText('###', 1, 2))
    expect(outline(editor.state.doc, parts)[0]!.level).toBe(3)
  })

  it('図のパートは見出しではないのでツリーに出ない', () => {
    const titles = flattenOutline(outline(editor.state.doc, parts)).map((i) => i.title)
    expect(titles).not.toContain('ずかい')
  })
})

describe('P1-契約: outline は doc だけでは作れない（parts を受け取る）', () => {
  it('⚠ parts を渡さないと、配置した独立章パートの見出しがツリーに現れない', () => {
    const titles = flattenOutline(outline(editor.state.doc)).map((i) => i.title)
    expect(titles).toEqual(['だいいちしょう', 'せつ', 'だいにしょう'])
    expect(titles).not.toContain('ひきだし けしごむ')
  })

  it('parts を渡すと現れる（＝見出し文字列は Part 側にしか無い）', () => {
    const flat = flattenOutline(outline(editor.state.doc, parts))
    expect(flat.map((i) => i.title)).toEqual([
      'だいいちしょう',
      'せつ',
      'ひきだし けしごむ',
      'だいにしょう',
    ])
    const refItem = flat.find((i) => i.kind === 'partRef')!
    expect(refItem.title).toBe('ひきだし けしごむ')
    // 深さは「どこに置いたか」で決まる（囲っている見出し level 2 の 1 つ下）
    expect(refItem.level).toBe(3)
  })

  it('doc 側には見出し文字列が入っていない（キャッシュしていないことの裏取り）', () => {
    expect(JSON.stringify(editor.getJSON())).not.toContain('けしごむ')
  })

  it('⭐ 同じ見出しの下に連続配置した独立章パートは、同じ深さの兄弟になる', () => {
    // DESIGN 1-6-5 のカノニカルケース（配列 1 件ごとに独立章を生む宣言）はこの形。
    // ⚠ 深さは「どこに置いたか」で決まる（DESIGN 1-6-3）。
    //   「何番目に置いたか」で決まってはいけない（＝階段になってはいけない）。
    const consecutive = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'しょう'),
          makeRef('まえおき'),
          makeRef('ひきだし:h1'),
          makeRef('ひきだし:h2'),
        ],
      },
    })
    const tree = outline(consecutive.state.doc, parts)
    consecutive.destroy()

    expect(tree).toHaveLength(1)
    const chapter = tree[0]!
    // ⭐ root の children 数で照合する（階段になっていると 1 個に潰れる）
    expect(chapter.children).toHaveLength(3)
    expect(chapter.children.map((i) => i.title)).toEqual([
      'まえおき',
      'ひきだし けしごむ',
      'ひきだし ものさし',
    ])
    expect(chapter.children.map((i) => i.level)).toEqual([2, 2, 2])
    // 互いに入れ子になっていない
    expect(chapter.children.every((i) => i.children.length === 0)).toBe(true)
  })

  it('⭐ 見出しを挟むと、パート参照の深さはその見出しに従う（位置で決まる）', () => {
    const mixed = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'しょう'),
          makeRef('ひきだし:h1'),
          heading(2, 'せつ'),
          makeRef('ひきだし:h2'),
        ],
      },
    })
    const flat = flattenOutline(outline(mixed.state.doc, parts))
    mixed.destroy()

    expect(flat.map((i) => [i.title, i.level])).toEqual([
      ['しょう', 1],
      ['ひきだし けしごむ', 2],
      ['せつ', 2],
      ['ひきだし ものさし', 3],
    ])
  })

  it('データ側から消えたパートはツリーに出ない（dangling の判定は analyzePlacement の責務）', () => {
    const fewerParts = parts.filter((p) => p.partId !== 'ひきだし:h1')
    const titles = flattenOutline(outline(editor.state.doc, fewerParts)).map((i) => i.title)
    expect(titles).not.toContain('ひきだし けしごむ')
  })
})

/**
 * ⭐ CONCEPT Q2 改訂（2026-08-23）の陰性テスト。
 * 方針メモ:「アが破れているなら **ツリーの見出し文字列に記号が混ざる**はず」。
 */
describe('P1-2 改訂: ツリーには記号を出さない（記号を剥がす層）', () => {
  it('⭐ 左ペインに `## みだし` とは出ない（題名だけが出る）', () => {
    const flat = flattenOutline(outline(editor.state.doc, parts))
    for (const item of flat) {
      expect(item.title).not.toMatch(/^#/)
      expect(item.title).not.toContain('# ')
    }
    expect(flat.map((i) => i.title)).toContain('だいいちしょう')
  })

  it('本文側には記号が残っている（剥がしたのはツリーだけ）', () => {
    expect(editor.state.doc.child(0).textContent).toBe('# だいいちしょう')
  })
})

/**
 * P2: ツリーの走査は inline 版の参照も見る（DESIGN 1-6-3 / §2 の「inline 版を足す」）。
 *
 * ⚠ inline 版は**段落の中**に居るので、doc の直下だけを見る走査では 1 個も見つからない。
 *   気づけない壊れ方（独立章のパートを文中に置いた場合だけツリーから消える）なので、
 *   block 版と同じ結果になることを直接当てる。
 */
describe('P2: 走査は inline 版の参照も対象にする', () => {
  function treeOf(node: object) {
    const ed = new Editor({
      extensions: documentExtensions,
      content: { type: 'doc', content: [heading(1, 'しょう'), node] },
    })
    const flat = flattenOutline(outline(ed.state.doc, parts))
    ed.destroy()
    return flat
  }

  it('独立章のパートを段落の中に置いても、ブロックで置いたのと同じ項目が出る', () => {
    const block = treeOf(makeRef('まえおき'))
    const inline = treeOf({
      type: 'paragraph',
      content: [{ type: PART_REF_INLINE_NODE, attrs: { instanceId: 'i1', partId: 'まえおき' } }],
    })

    expect(block.map((i) => [i.kind, i.title, i.level])).toEqual([
      ['heading', 'しょう', 1],
      ['partRef', 'まえおき', 2],
    ])
    expect(inline.map((i) => [i.kind, i.title, i.level])).toEqual(
      block.map((i) => [i.kind, i.title, i.level]),
    )
  })

  it('本文中のパート（画像など）はツリーに出ない（章ではないため・1-7-3）', () => {
    const figureRef = {
      type: 'paragraph',
      content: [{ type: PART_REF_INLINE_NODE, attrs: { instanceId: 'i1', partId: 'ずかい' } }],
    }
    expect(treeOf(figureRef).map((i) => i.kind)).toEqual(['heading'])
  })
})
