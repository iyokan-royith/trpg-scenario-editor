/**
 * P1-2 / 契約: `outline(doc, parts)`（DESIGN 1-6-4）
 *
 * ⚠ 検証データは全て創作。実素材の語彙は 1 語も持ち込まない。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import { outline, flattenOutline } from '../outline'
import { PART_REF_NODE } from '../../p0/partRefExtension'
import {
  derivePartsOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../../p0/model'

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

function 見出し(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
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
    editor.view.dispatch(
      editor.state.tr.insertText('かきかえ', 見出しの位置 + 1, 見出しの位置 + node.nodeSize - 1),
    )
    expect(outline(editor.state.doc, parts)[0]!.title).toBe('かきかえ')
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

  it('データ側から消えたパートはツリーに出ない（dangling の判定は analyzePlacement の責務）', () => {
    const 減った = parts.filter((p) => p.partId !== 'ひきだし:h1')
    const titles = flattenOutline(outline(editor.state.doc, 減った)).map((i) => i.title)
    expect(titles).not.toContain('ひきだし けしごむ')
  })
})
