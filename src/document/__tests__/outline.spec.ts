/**
 * P1-2 / 契約: `outline(doc, parts)`（DESIGN 1-6-4）
 *
 * ⚠ 検証データは全て創作。実素材の語彙は 1 語も持ち込まない。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import { 見出し記号, 記号の長さ } from '../heading'
import { outline, flattenOutline } from '../outline'
import { PART_REF_NODE } from '../partRefExtension'
import {
  derivePartsOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../../template/model'

const 定義: TemplateDefinition = {
  id: 'ぶんぼうぐ',
  name: 'ぶんぼうぐテンプレ',
  parts: [
    { key: 'まえおき', kind: '固定', label: 'まえおき', form: '独立章' },
    { key: 'ひきだし', kind: '配列ごと', source: 'ひきだし', label: 'ひきだし', form: '独立章' },
    { key: 'ずかい', kind: '固定', label: 'ずかい', form: '図' },
  ],
}

const インスタンス: TemplateInstance = {
  id: 'i1',
  templateId: 'ぶんぼうぐ',
  data: {
    まえおき: 'まえおきの本文',
    ずかい: 'ずの本文',
    ひきだし: [
      { id: 'h1', name: 'けしごむ', body: 'けしごむの説明' },
      { id: 'h2', name: 'ものさし', body: 'ものさしの説明' },
    ],
  },
}

const parts: Part[] = derivePartsOf(インスタンス, 定義)

function 参照(partId: string) {
  return { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId } }
}

/**
 * ⚠ 2026-08-23 の CONCEPT Q2 改訂で、**見出し記号は本物のテキストとして本文に入る**。
 *   フィクスチャも記号を含む形にする（＝これが新しい仕様。テストを甘くしたのではない）。
 */
function 見出し(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: 見出し記号(level) + text }],
  }
}

function 段落(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        見出し(1, 'だいいちしょう'),
        段落('てがきの本文'),
        見出し(2, 'せつ'),
        参照('ひきだし:h1'), // 独立章 → ツリーに出る
        参照('ずかい'), // 図 → ツリーに出ない
        見出し(1, 'だいにしょう'),
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
    const 見出しの位置 = 0
    const node = editor.state.doc.nodeAt(見出しの位置)!
    // 記号のうしろ（題名の部分）だけを書き換える
    editor.view.dispatch(
      editor.state.tr.insertText(
        'かきかえ',
        見出しの位置 + 1 + 記号の長さ(node.textContent),
        見出しの位置 + node.nodeSize - 1,
      ),
    )
    expect(outline(editor.state.doc, parts)[0]!.title).toBe('かきかえ')
  })

  it('⭐ 記号を消すと見出しでなくなり、ツリーから消える（完了条件 #1 の後半）', () => {
    const node = editor.state.doc.nodeAt(0)!
    editor.view.dispatch(editor.state.tr.delete(1, 1 + 記号の長さ(node.textContent)))
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
    const 参照項目 = flat.find((i) => i.kind === 'パート参照')!
    expect(参照項目.title).toBe('ひきだし けしごむ')
    // 深さは「どこに置いたか」で決まる（囲っている見出し level 2 の 1 つ下）
    expect(参照項目.level).toBe(3)
  })

  it('doc 側には見出し文字列が入っていない（キャッシュしていないことの裏取り）', () => {
    expect(JSON.stringify(editor.getJSON())).not.toContain('けしごむ')
  })

  it('⭐ 同じ見出しの下に連続配置した独立章パートは、同じ深さの兄弟になる', () => {
    // DESIGN 1-6-5 のカノニカルケース（配列 1 件ごとに独立章を生む宣言）はこの形。
    // ⚠ 深さは「どこに置いたか」で決まる（DESIGN 1-6-3）。
    //   「何番目に置いたか」で決まってはいけない（＝階段になってはいけない）。
    const 連続 = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [見出し(1, 'しょう'), 参照('まえおき'), 参照('ひきだし:h1'), 参照('ひきだし:h2')],
      },
    })
    const tree = outline(連続.state.doc, parts)
    連続.destroy()

    expect(tree).toHaveLength(1)
    const 章 = tree[0]!
    // ⭐ root の children 数で照合する（階段になっていると 1 個に潰れる）
    expect(章.children).toHaveLength(3)
    expect(章.children.map((i) => i.title)).toEqual([
      'まえおき',
      'ひきだし けしごむ',
      'ひきだし ものさし',
    ])
    expect(章.children.map((i) => i.level)).toEqual([2, 2, 2])
    // 互いに入れ子になっていない
    expect(章.children.every((i) => i.children.length === 0)).toBe(true)
  })

  it('⭐ 見出しを挟むと、パート参照の深さはその見出しに従う（位置で決まる）', () => {
    const 混在 = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [見出し(1, 'しょう'), 参照('ひきだし:h1'), 見出し(2, 'せつ'), 参照('ひきだし:h2')],
      },
    })
    const flat = flattenOutline(outline(混在.state.doc, parts))
    混在.destroy()

    expect(flat.map((i) => [i.title, i.level])).toEqual([
      ['しょう', 1],
      ['ひきだし けしごむ', 2],
      ['せつ', 2],
      ['ひきだし ものさし', 3],
    ])
  })

  it('データ側から消えたパートはツリーに出ない（dangling の判定は analyzePlacement の責務）', () => {
    const 減った = parts.filter((p) => p.partId !== 'ひきだし:h1')
    const titles = flattenOutline(outline(editor.state.doc, 減った)).map((i) => i.title)
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
