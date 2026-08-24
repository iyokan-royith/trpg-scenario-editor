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

/**
 * ⭐⭐ 明示的な深さ（`partRef.attrs.depth`・§1-3-3e-2）。
 *
 * ⚠⚠ **この変更で壊れうる唯一の性質は S7-3**——
 *   「同じパートを 2 箇所に置いたとき、両者が**別の深さ**になれる」。
 *   深さを**パート側**に持たせると壊れる。**ノード（配置）側**に持たせるから保たれる。
 */
describe('明示的な深さ（§1-3-3e-2）', () => {
  function docWith(content: Record<string, unknown>[]) {
    return new Editor({
      extensions: documentExtensions,
      // ⚠ 手書きの JSON を渡すので、Tiptap の型には合わせず実物の形で入れる。
      content: { type: 'doc', content } as unknown as string,
    })
  }

  it('⭐ 属性が無ければ今までどおり導出される（既存の doc・後方互換）', () => {
    // ⚠⚠ 既存の doc は `depth` を持たない。ここが壊れると、
    //   **前の版で書いた本文を開いた瞬間に階層が総崩れになる**（§1-9 で 1 度踏んだ型）。
    const ed = docWith([heading(1, 'しょう'), heading(2, 'せつ'), makeRef('ひきだし:h1')])
    const flat = flattenOutline(outline(ed.state.doc, parts))
    const ref = flat.find((i) => i.kind === 'partRef')!
    expect(ref.level).toBe(3) // 囲っている見出し（level 2）の 1 つ下
  })

  it('⭐ 属性があればその深さで出る（囲っている見出しに関わらず）', () => {
    const ed = docWith([
      heading(1, 'しょう'),
      heading(2, 'せつ'),
      { ...makeRef('ひきだし:h1'), attrs: { instanceId: 'i1', partId: 'ひきだし:h1', depth: 1 } },
    ])
    const ref = flattenOutline(outline(ed.state.doc, parts)).find((i) => i.kind === 'partRef')!
    expect(ref.level).toBe(1)
  })

  /** 同じパートへの参照を n 個並べる（深さは配置ごとに指定できる）。 */
  function refWithDepth(depth: number | null) {
    return { ...makeRef('ひきだし:h1'), attrs: { instanceId: 'i1', partId: 'ひきだし:h1', depth } }
  }

  /**
   * ⚠⚠ **このテストは S7-3 を名乗っているが、S7-3 の守り手ではない**（台帳 A72・監査が実測）。
   *
   *   並びが `[導出, 明示(5)]` なので、**深さをパート単位で持つ誤った実装でも同じ答えになる**
   *   （1 本目は明示を持たないので何も溜まらず、2 本目は自分の明示を読む）。
   *   ⚠ **変異（深さをパート単位で持つ）を当てても、この 1 本は緑のまま通る。**
   *   ⭐ **討っているのは下の 2 本**（「両方に別々の深さ」「明示 → 導出」）。
   *
   *   → **名前は主張であって、証拠ではない。** 残しているのは
   *   「同じパートが 2 箇所で別の深さになれる」という**読み物としての形**が分かりやすいからで、
   *   **検出力はそちらに無い**。⚠ ここを直すときは下の 1 本も一緒に見ること。
   */
  it('⭐ S7-3 の形（同じパートを 2 箇所に置いて、片方だけ深さを変える）', () => {
    const ed = docWith([heading(1, 'しょう'), makeRef('ひきだし:h1'), refWithDepth(5)])
    const refs = flattenOutline(outline(ed.state.doc, parts)).filter((i) => i.kind === 'partRef')
    expect(refs).toHaveLength(2)
    // 同じパート（同じ題）なのに深さが違う。
    // ⚠ **ただし「深さをパート側に持たせると必ず一致する」わけではない**——
    //   この並びでは誤実装でも一致しない（上の注記を参照）。
    expect(refs.map((r) => r.title)).toEqual([refs[0]!.title, refs[0]!.title])
    expect(refs.map((r) => r.level)).toEqual([2, 5])
  })

  /**
   * ⚠⚠ **この 2 本は「片方だけ明示」では捕まらない穴を塞ぐ**（変異で実測）。
   *   深さを**パート単位**（最初に見た値を同じパート全部に使う）で持つ実装は、
   *   上のテストを**素通りする**——1 つ目が明示を持たないので、地図に何も溜まらないから。
   *   → **両方が明示を持つ場合**と、**明示が先に来る場合**を並べる。
   */
  it('⭐⭐ 両方に別々の深さを指定できる（配置ごとに持っている）', () => {
    const ed = docWith([heading(1, 'しょう'), refWithDepth(3), refWithDepth(5)])
    const refs = flattenOutline(outline(ed.state.doc, parts)).filter((i) => i.kind === 'partRef')
    expect(refs.map((r) => r.level)).toEqual([3, 5])
  })

  /**
   * ⭐⭐⭐ **S7-3（深さは配置の属性）を実際に討っている 2 本のうちの 1 本**（台帳 A72）。
   *
   *   ⚠⚠ **消さないこと。**「上の S7-3 のテストと重複している」と読めるが、**重複ではない**——
   *   **上の（名前に S7-3 と付いている）1 本は、誤実装でも緑のまま通る。**
   *
   *   **実測（2026-08-25・深さをパート単位で持つ変異）**: 赤くなるのは **2 本**——
   *   「両方に別々の深さを指定できる」と、この 1 本。
   *   ⚠ 監査の初回実測では**この 1 本だけ**だった（もう 1 本を私が後から足したため）。
   *   ⭐ **本数は「いま在るテストの集合」に対する値であって、性質の固有値ではない。**
   *
   *   ⚠ **状態を溜める実装は、溜まる前の 1 件目では正しく振る舞う。**
   *   だから「2 件目・順序違い」を並べたこの 1 本が要る。
   */
  it('⭐⭐⭐ 明示した参照のあとに、明示していない同じパートの参照が来ても導出のまま', () => {
    const ed = docWith([heading(1, 'しょう'), refWithDepth(5), makeRef('ひきだし:h1')])
    const refs = flattenOutline(outline(ed.state.doc, parts)).filter((i) => i.kind === 'partRef')
    // ⚠ 2 つ目が 5 になったら、深さが**パートに染み出している**（配置の属性ではなくなっている）
    expect(refs.map((r) => r.level)).toEqual([5, 2])
  })

  it('範囲の外を指す属性は畳む（保存済みデータ・手書き JSON から来うる）', () => {
    const ed = docWith([
      { ...makeRef('ひきだし:h1'), attrs: { instanceId: 'i1', partId: 'ひきだし:h1', depth: 99 } },
    ])
    const ref = flattenOutline(outline(ed.state.doc, parts)).find((i) => i.kind === 'partRef')!
    expect(ref.level).toBe(6)
  })

  it('⭐ パート参照は配下を持たない（＝上げ下げで配下を気にしなくてよい根拠）', () => {
    // ⚠ 参照のあとに深い見出しが来ても、**参照の子にはならない**（祖先に積まないため）。
    const ed = docWith([heading(1, 'しょう'), makeRef('ひきだし:h1'), heading(3, 'あとのせつ')])
    const tree = outline(ed.state.doc, parts)
    const ref = flattenOutline(tree).find((i) => i.kind === 'partRef')!
    expect(ref.children).toHaveLength(0)
  })
})
