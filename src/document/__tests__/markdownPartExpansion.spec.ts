/**
 * ⭐⭐ **md 書き出しでパート参照を展開する**（DESIGN-v0.md §1-13-1h のロイス決定・移行 P-d2）。
 *
 * ここが `offsetMarkdownHeadings`（P-c）の**唯一の消費者**である。
 * P-c を入れた時点では呼び出し元が 1 つも無く、**台帳 A105（決定1b の実機確認）が
 * 原理的に観測できなかった**——「実装が未完成」ではなく「md の見出しとして
 * 実体化する場所が設計上まだ無かった」。この経路がその場所。
 *
 * ⚠⚠ **このファイルの主眼は「展開されること」ではなく「深さが配置ごとに決まること」**である。
 *   展開だけなら固定レベルでも緑になる。**同じパートを 2 箇所に置いたとき（S7-3）に
 *   両者が別の深さになる**ことだけが、`levelByPos` を使っている証拠になる。
 *
 * ⚠ 検証データは全て創作。実素材の語彙は 1 語も持ち込まない。
 */
import { describe, it, expect } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/vue-3'
import { documentExtensions } from '../schema'
import { headingMark } from '../heading'
import { docToMd, mdToDoc } from '../markdown'
import { outline, flattenOutline } from '../outline'
import { PART_REF_INLINE_NODE, PART_REF_NODE } from '../partRefExtension'
import { HeadingLevelOverflowError } from '../../template/liquid/headingOffset'
import type { Part } from '../../template/model'

/**
 * パートの本文は **liquid が返した md 文字列**（`liquidPartToPart` が `{kind:'text'}` 1 個に畳む）。
 * ⚠ 先頭は必ず `#`（§1-13-1d の規約）。ここが「パートの見出しそのもの」になる錨。
 */
function sectionPart(partId: string, title: string, body: string): Part {
  return {
    instanceId: 'i1',
    partId,
    form: 'section',
    title,
    body: [{ kind: 'text', text: body }],
  }
}

const SHEET_BODY = [
  '# かめのこう',
  '',
  'こうらの説明。',
  '',
  '## もよう',
  '',
  'ろっかくけい。',
].join('\n')

const parts: Part[] = [
  sectionPart('しーと', 'かめのこう', SHEET_BODY),
  sectionPart(
    'ふかい',
    'ふかいシート',
    ['# ふかい', '', '## ふたつめ', '', '### みっつめ'].join('\n'),
  ),
  {
    instanceId: 'i1',
    partId: 'ずかい',
    form: 'figure',
    title: 'ずかい',
    // ⚠ **記号を含める**（監査 A113）。`#` が 1 文字も無い本文だと、
    //   オフセットされていても緑になり「オフセットしない」を検査できない。
    body: [{ kind: 'text', text: ['# ずかい', '', 'ずの本文'].join('\n') }],
  },
  {
    instanceId: 'i1',
    partId: 'ひとくち',
    form: 'inline',
    title: 'ひとくち',
    body: [{ kind: 'text', text: 'ひとくちメモ' }],
  },
]

function heading(level: number, text: string): JSONContent {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: headingMark(level) + text }],
  }
}

function paragraph(...content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content }
}

function text(value: string): JSONContent {
  return { type: 'text', text: value }
}

function ref(partId: string, depth: number | null = null): JSONContent {
  return { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId, depth } }
}

function inlineRef(partId: string): JSONContent {
  return { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'i1', partId, depth: null } }
}

function docOf(content: JSONContent[]) {
  return new Editor({ extensions: documentExtensions, content: { type: 'doc', content } }).state.doc
}

describe('パート参照は md 本文へ展開される（§1-13-1h）', () => {
  it('⭐ コメントではなく中身が出る（`parts` を渡したとき）', () => {
    const doc = docOf([heading(1, 'だいいちしょう'), ref('しーと')])
    const md = docToMd(doc, { parts })
    expect(md).not.toContain('<!-- partRef')
    expect(md).toContain('こうらの説明。')
    expect(md).toContain('ろっかくけい。')
  })

  it('⚠ 反証: `parts` を渡さなければ従来どおりコメント（既存経路は 1 ミリも変わらない）', () => {
    const doc = docOf([heading(1, 'だいいちしょう'), ref('しーと')])
    expect(docToMd(doc)).toContain('<!-- partRef i1 しーと -->')
  })

  it('素材から消えた参照（dangling）は黙って消さずコメントで残す', () => {
    const doc = docOf([heading(1, 'しょう'), ref('もういない')])
    const md = docToMd(doc, { parts })
    expect(md).toContain('<!-- partRef i1 もういない -->')
  })
})

describe('⭐⭐ 見出しの深さは「配置された階層」で決まる（§1-13-1d 決定1b）', () => {
  it('`#` の下に置くと `##` から始まる（先頭 `#` はパートの深さそのもの）', () => {
    const doc = docOf([heading(1, 'だいいちしょう'), ref('しーと')])
    const md = docToMd(doc, { parts })
    // 基準レベル = depthUnder(1) = 2 → 先頭 `#` は `##`、内部の `##` は `###`
    // ⚠ 行頭・行末で見る（`toContain('## …')` は `#### …` にも当たる）
    expect(md.match(/^#+ かめのこう$/m)![0]).toBe('## かめのこう')
    expect(md.match(/^#+ もよう$/m)![0]).toBe('### もよう')
  })

  it('⭐⭐⭐ S7-3: 同じパートを別の階層に置くと、それぞれ別の深さで出る', () => {
    const doc = docOf([
      heading(1, 'あさ'),
      ref('しーと'),
      heading(1, 'ひる'),
      heading(2, 'ゆうがた'),
      heading(3, 'よる'),
      ref('しーと'),
    ])
    const md = docToMd(doc, { parts })
    // 1 つ目: 囲みが `#` → 基準 2 ／ 2 つ目: 囲みが `###` → 基準 4
    expect(md.match(/^#+ もよう$/gm)).toEqual(['### もよう', '##### もよう'])
    // ⚠ **固定値の実装はここで捕まる**——固定なら 2 つの見出しが同じ深さで 2 回出る
    expect(md.match(/^#+ かめのこう$/gm)).toEqual(['## かめのこう', '#### かめのこう'])
  })

  /**
   * ⭐⭐⭐ **上の S7-3 では、配列＋カーソルを選んだ理由は守られていない。**
   *
   * 上のテストは JSON から**別々に**参照ノードを組み立てるので、`Node` の実体が 2 つある。
   * つまり **`Map<PMNode, level>` の実装でも緑になる**（実測: 549 本すべて緑のまま通る）。
   *
   * ⚠⚠ **コピー＆ペーストは `Slice` の中のノードをそのまま挿す**ので、
   *   同じ位置から切って別の場所へ入れると **2 箇所が同一オブジェクト**になる。
   *   このときだけ `Map` は「後から入れた方の深さ」で両方を上書きし、
   *   **例外も出さずに片方の深さが間違う**——`markdown.ts` が配列＋カーソルにしてある理由そのもの。
   *
   * → **この経路でしか、その理由に述語が付かない。**
   */
  it('⭐⭐⭐ 同一の `Node` 実体が 2 箇所にあっても、深さは位置ごとに決まる（コピペ経路）', () => {
    const editor = new Editor({
      extensions: documentExtensions,
      content: {
        type: 'doc',
        content: [
          heading(1, 'あさ'),
          ref('しーと'),
          heading(1, 'ひる'),
          heading(2, 'ゆうがた'),
          heading(3, 'よる'),
        ],
      },
    })
    const state = editor.state
    let refPos = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === PART_REF_NODE && refPos < 0) refPos = pos
    })
    expect(refPos).toBeGreaterThanOrEqual(0)

    // 切って末尾へ挿す＝コピー＆ペーストと同じ経路（`Slice` の中のノードがそのまま入る）
    const original = state.doc.nodeAt(refPos)!
    const slice = state.doc.slice(refPos, refPos + original.nodeSize)
    const doc = state.tr.insert(state.doc.content.size, slice.content).doc

    // ⚠ **前提の確認**: 本当に同一オブジェクトになっているか。
    //   別実体なら、このテストは `Map` 実装を捕まえられない（＝何も検査していない）。
    const found: (typeof original)[] = []
    doc.descendants((node) => {
      if (node.type.name === PART_REF_NODE) found.push(node)
    })
    expect(found).toHaveLength(2)
    expect(found[0] === found[1]).toBe(true)

    // 1 つ目は `#` の下（基準 2）／2 つ目は `###` の下（基準 4）
    const md = docToMd(doc, { parts })
    expect(md.match(/^#+ かめのこう$/gm)).toEqual(['## かめのこう', '#### かめのこう'])
    expect(md.match(/^#+ もよう$/gm)).toEqual(['### もよう', '##### もよう'])
  })

  it('⭐ 明示の深さ（左ペインの上げ下げ・`attrs.depth`）が導出より優先される（§1-3-3e-2）', () => {
    const doc = docOf([heading(1, 'あさ'), ref('しーと', 4)])
    const md = docToMd(doc, { parts })
    // 導出なら 2 になるところを、明示の 4 が勝つ
    // ⚠ 行頭で見る。`toContain('## かめのこう')` は `#### かめのこう` にも当たってしまう
    expect(md.match(/^#+ かめのこう$/m)![0]).toBe('#### かめのこう')
    expect(md.match(/^#+ もよう$/m)![0]).toBe('##### もよう')
  })

  it('見出しの外（章の前）に置くと最上位（基準 1）になる', () => {
    const doc = docOf([ref('しーと'), heading(1, 'あと')])
    const md = docToMd(doc, { parts })
    expect(md.match(/^#+ かめのこう$/m)![0]).toBe('# かめのこう')
    expect(md.match(/^#+ もよう$/m)![0]).toBe('## もよう')
  })

  it('⚠ 深さ 6 を超えたら黙って潰さずエラー（§1-13-1d 決定2）', () => {
    // 基準 5（`####` の下）＋ テンプレ内 `###` → 5+2 = 7
    const doc = docOf([
      heading(1, 'あ'),
      heading(2, 'い'),
      heading(3, 'う'),
      heading(4, 'え'),
      ref('ふかい'),
    ])
    expect(() => docToMd(doc, { parts })).toThrow(HeadingLevelOverflowError)
    // ⚠ 文面には見出しのテキストが載る（テンプレ作者が現物を探す手掛かり）
    expect(() => docToMd(doc, { parts })).toThrow(/みっつめ/)
  })
})

describe('章にならないパートは見出しの深さを持たない', () => {
  it('⭐ 図（`form: "figure"`）は展開されるが、見出しはずらされない（`outline()` に出ないため）', () => {
    // ⚠ 囲みは `#` なので、章として扱われていれば `##` になるはず。**ならないことが性質**。
    const md = docToMd(docOf([heading(1, 'しょう'), ref('ずかい')]), { parts })
    expect(md).toContain('ずの本文')
    expect(md.match(/^#+ ずかい$/m)![0]).toBe('# ずかい')

    // ⚠ **反証**: 同じ本文を `section` のパートとして置けばずれる
    //   （＝「この md には元々 `#` しか無い」ではなく「図だからずらされない」と言える）
    const asSection: Part[] = [
      { ...parts.find((p) => p.partId === 'ずかい')!, partId: 'しょうとして', form: 'section' },
    ]
    const md2 = docToMd(docOf([heading(1, 'しょう'), ref('しょうとして')]), { parts: asSection })
    expect(md2.match(/^#+ ずかい$/m)![0]).toBe('## ずかい')
  })

  it('⭐ 文中の参照（inline）は展開されるが、段落の途中なのでオフセットしない', () => {
    const doc = docOf([
      heading(1, 'しょう'),
      paragraph(text('まえ、'), inlineRef('ひとくち'), text('、あと。')),
    ])
    const md = docToMd(doc, { parts })
    expect(md).toContain('まえ、ひとくちメモ、あと。')
  })

  it('⚠ 走査の位置が `outline()` と一致している（inline の参照が 2 つあっても対応がずれない）', () => {
    const doc = docOf([
      heading(1, 'しょう'),
      paragraph(text('A'), inlineRef('しーと'), text('B'), inlineRef('ひとくち')),
    ])
    // 前提の確認: `outline()` は inline の section パートを拾っている
    const placed = flattenOutline(outline(doc, parts)).filter((i) => i.kind === 'partRef')
    expect(placed.map((i) => i.title)).toEqual(['かめのこう'])
    // 2 つとも展開され、順番も入れ替わらない
    const md = docToMd(doc, { parts })
    expect(md).toContain('A# かめのこう')
    expect(md).toContain('Bひとくちメモ')
  })
})

describe('⚠ 捨てた範囲を正確に守る（§1-13-1h の表）', () => {
  it('⭐ 手書き本文の往復は無傷（`mdToDoc` は 1 文字も変わっていない）', () => {
    const source = [
      '# てがき',
      '',
      'ほんぶんです。**ふとじ**もある。',
      '',
      '## せつ',
      '',
      '* はこ',
    ].join('\n')
    const roundTrip = docToMd(mdToDoc(source), { parts })
    expect(roundTrip.trim()).toBe(source.trim())
  })

  it('⚠ 書き出した md を読み戻すとパート参照には戻らない（捨てたのはここだけ）', () => {
    const doc = docOf([heading(1, 'しょう'), ref('しーと')])
    const back = mdToDoc(docToMd(doc, { parts }))
    let refs = 0
    back.descendants((node) => {
      if (node.type.name === PART_REF_NODE || node.type.name === PART_REF_INLINE_NODE) refs += 1
    })
    expect(refs).toBe(0)
    // ⚠ ただし**中身は失われていない**（手書き本文として入っている）
    expect(back.textContent).toContain('こうらの説明。')
  })

  it('⭐ 保存データ（doc）は書き出しで変化しない（単一の真実は `doc`・§1-2）', () => {
    const doc = docOf([heading(1, 'しょう'), ref('しーと')])
    const before = JSON.stringify(doc.toJSON())
    docToMd(doc, { parts })
    expect(JSON.stringify(doc.toJSON())).toBe(before)
  })
})
