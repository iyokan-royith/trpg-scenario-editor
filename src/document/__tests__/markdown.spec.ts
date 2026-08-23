/**
 * P1-4 / P1-5: md の入出力。
 *
 * ⚠ 検証データは全て創作。
 * ⚠ `partRef` を含む md の往復は P3 の責務。ここでは手書き本文だけを対象にする。
 */
import { describe, it, expect } from 'vitest'
import { documentSchema } from '../schema'
import { docToMd, markdownSlice, mdToDoc } from '../markdown'
import { 見出しの題名, 見出しレベル } from '../heading'
import { PART_REF_NODE } from '../../p0/partRefExtension'

const みほんのmd = [
  '# あかしょう',
  '',
  'あかの本文です。**ふとじ**と*ななめ*が混ざります。',
  '',
  '## あかのせつ',
  '',
  '* ひとつめ',
  '* ふたつめ',
  '',
  '1. さいしょ',
  '2. つぎ',
  '',
  '> ひきよう',
  '',
  '```ts',
  'const あたい = 1',
  '```',
  '',
  '[りんく](https://example.invalid/) と `こーど`。',
  '',
  '---',
  '',
  '# あおしょう',
  '',
  'あおの本文です。',
].join('\n')

function ブロックの種類(doc: ReturnType<typeof mdToDoc>): string[] {
  const out: string[] = []
  doc.forEach((node) => out.push(node.type.name))
  return out
}

describe('P1-4: md はブロックに分解される（1 個のテキスト塊にならない）', () => {
  it('見出し・段落・箇条書き・引用・コードブロックがそれぞれのブロックになる', () => {
    const doc = mdToDoc(みほんのmd)
    expect(ブロックの種類(doc)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'paragraph',
      'horizontalRule',
      'heading',
      'paragraph',
    ])
  })

  it('見出しのレベルが保たれる', () => {
    const doc = mdToDoc(みほんのmd)
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(2).attrs.level).toBe(2)
  })

  it('強調・リンク・インラインコードがマークになる', () => {
    const doc = mdToDoc(みほんのmd)
    const marks = new Set<string>()
    doc.descendants((node) => {
      for (const m of node.marks) marks.add(m.type.name)
    })
    expect(marks).toContain('bold')
    expect(marks).toContain('italic')
    expect(marks).toContain('link')
    expect(marks).toContain('code')
  })

  it('貼り付け用の Slice が複数ブロックを持つ（＝塊にならない）', () => {
    const slice = markdownSlice(みほんのmd)
    expect(slice.content.childCount).toBeGreaterThan(1)
    expect(slice.openStart).toBe(0)
    expect(slice.openEnd).toBe(0)
  })

  it('一行だけの貼り付けはカーソル位置に流し込める形（開いた Slice）になる', () => {
    const slice = markdownSlice('ただのいちぎょう')
    expect(slice.content.childCount).toBe(1)
    expect(slice.openStart).toBeGreaterThan(0)
  })
})

describe('P1-5: md へ書き出して読み戻すと一致する（往復）', () => {
  it('doc → md → doc が同じドキュメントになる', () => {
    const もと = mdToDoc(みほんのmd)
    const 戻り = mdToDoc(docToMd(もと))
    // ⚠ md 文字列の等値では見ない（記号の揺れで落ちる）。ドキュメントとして同じかを見る。
    expect(戻り.eq(もと)).toBe(true)
  })

  it('見出し階層と本文が一致する', () => {
    const 戻り = mdToDoc(docToMd(mdToDoc(みほんのmd)))
    const 見出し: Array<[number, string]> = []
    戻り.forEach((node) => {
      if (node.type.name === 'heading') {
        // ⚠ 記号は本文に入っているので、題名の照合では剥がす（CONCEPT Q2 改訂）
        見出し.push([見出しレベル(node.textContent)!, 見出しの題名(node.textContent)])
      }
    })
    expect(見出し).toEqual([
      [1, 'あかしょう'],
      [2, 'あかのせつ'],
      [1, 'あおしょう'],
    ])
    expect(戻り.textContent).toContain('あかの本文です。')
    expect(戻り.textContent).toContain('あおの本文です。')
  })

  it('md → doc → md が安定する（2 周目で文字列が変わらない）', () => {
    const 一周 = docToMd(mdToDoc(みほんのmd))
    const 二周 = docToMd(mdToDoc(一周))
    expect(二周).toBe(一周)
  })
})

describe('P1-5 の穴を塞ぐ: パート参照を黙って捨てない', () => {
  it('partRef があると md に痕跡が残る（展開は P3 の責務）', () => {
    const doc = documentSchema.node('doc', null, [
      documentSchema.node('heading', { level: 1 }, documentSchema.text('しょう')),
      documentSchema.node(PART_REF_NODE, { instanceId: 'i1', partId: 'ひきだし:h1' }),
    ])
    const md = docToMd(doc)
    expect(md).toContain('partRef')
    expect(md).toContain('ひきだし:h1')
  })
})

/**
 * ⭐⭐ CONCEPT Q2 改訂（2026-08-23・ソース方式）の陰性テスト。
 *
 * 方針メモの「これが誤りなら何が観測されるはずか」に対応する:
 *   アが破れているなら **md 書き出しに記号の二重化（`## ## みだし`）が出る**はず。
 */
describe('P1-1 改訂: 記号は本文にあり、md では二重にならない', () => {
  const 見出し入り = ['# あかしょう', '', 'ほんぶん。', '', '### ふかいせつ'].join('\n')

  it('md を読むと、記号が本文のテキストとして入っている', () => {
    const doc = mdToDoc(見出し入り)
    expect(doc.child(0).textContent).toBe('# あかしょう')
    expect(doc.child(2).textContent).toBe('### ふかいせつ')
  })

  it('⭐ 書き出しても記号が二重にならない', () => {
    const md = docToMd(mdToDoc(見出し入り))
    expect(md).not.toContain('# # ')
    expect(md).not.toContain('## ## ')
    expect(md).toContain('# あかしょう')
    expect(md).toContain('### ふかいせつ')
  })

  it('⭐ 記号がエスケープされない（`\\#` にならない）', () => {
    expect(docToMd(mdToDoc(見出し入り))).not.toContain('\\#')
  })

  it('往復しても記号は 1 組のまま（2 周しても増えない）', () => {
    const 一周 = docToMd(mdToDoc(見出し入り))
    const 二周 = docToMd(mdToDoc(一周))
    expect(二周).toBe(一周)
    expect(mdToDoc(二周).child(0).textContent).toBe('# あかしょう')
  })

  it('記号を持たない heading（外から来た JSON）でも、記号を補って出す', () => {
    const doc = documentSchema.node('doc', null, [
      documentSchema.node('heading', { level: 2 }, documentSchema.text('きごうなし')),
    ])
    expect(docToMd(doc)).toContain('## きごうなし')
  })
})
