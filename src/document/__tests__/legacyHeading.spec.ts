/**
 * 旧版形式の doc（**記号を持たない `heading`**）の扱い。
 *
 * ⚠⚠ 2026-08-23・3巡目監査の差し戻し。
 *   CONCEPT Q2 改訂の前（＝記号を消す方式）に保存された doc、および外から来た JSON には
 *   **記号の無い見出し**が入っている。これに対して 3 つの層が 3 通りの答えを出していた:
 *     `markdown.ts` = 見出しとして出す ／ `outline.ts` = 黙って落とす ／ `HeadingSync` = 段落へ降格
 *
 *   ⚠ 実害は「見た目が違う」ではなく **書いたものが消えること**だった——
 *     左ペインから消え、1 文字打った瞬間に段落へ降格し、自動保存で確定する。
 *
 * → **入口で記号を補う**（`heading.ts` の不変条件）。ここから内側に記号の無い見出しは存在しない。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions, documentSchema } from '../schema'
import { restoreHeadingMarksInJson, restoreHeadingMarks } from '../heading'
import { outline } from '../outline'
import { docToMd } from '../markdown'

/** 旧版が保存していた形（記号が本文に無く、レベルは attrs にしかない）。 */
const legacyContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'まえがき' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'ほんぶんです' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'そのいち' }] },
  ],
}

function legacyDoc() {
  return documentSchema.nodeFromJSON(legacyContent)
}

describe('restoreHeadingMarks（入口の不変条件）', () => {
  it('記号の無い見出しに、attrs のレベルから記号を起こす', () => {
    const fixed = restoreHeadingMarks(legacyDoc())
    expect(fixed.child(0).textContent).toBe('# まえがき')
    expect(fixed.child(2).textContent).toBe('## そのいち')
  })

  it('段落には手を出さない', () => {
    expect(restoreHeadingMarks(legacyDoc()).child(1).textContent).toBe('ほんぶんです')
  })

  it('もう記号がある doc は素通り（同じ実体が返る＝余計な書き換えをしない）', () => {
    const doc = documentSchema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '# あります' }] },
      ],
    })
    expect(restoreHeadingMarks(doc)).toBe(doc)
  })

  it('読めない JSON はそのまま返す（開けなくなる方が損）', () => {
    const broken = { type: 'doc', content: [{ type: 'そんなノードは無い' }] }
    expect(restoreHeadingMarksInJson(broken, documentSchema)).toBe(broken)
  })

  it('JSON を返す（Editor は別スキーマを持つので、ノードを渡すと黙って捨てられる）', () => {
    const fixed = restoreHeadingMarksInJson(legacyContent, documentSchema) as {
      content: Array<{ content?: Array<{ text: string }> }>
    }
    expect(fixed.content[0]!.content![0]!.text).toBe('# まえがき')
  })
})

describe('⭐ 3 つの層が同じ答えを出す（差し戻しの本体）', () => {
  const fixed = () => restoreHeadingMarks(legacyDoc())

  it('ツリー: 見出しとして出る（以前は黙って落ちていた）', () => {
    expect(outline(fixed()).map((i) => i.title)).toEqual(['まえがき'])
    expect(outline(fixed())[0]!.children.map((i) => i.title)).toEqual(['そのいち'])
  })

  it('md: 見出しとして出る（記号は 1 組だけ）', () => {
    const md = docToMd(fixed())
    expect(md).toContain('# まえがき')
    expect(md).toContain('## そのいち')
    expect(md).not.toContain('# # ')
  })

  it('編集: 1 文字打っても段落へ降格しない（以前はここで消えた）', () => {
    const editor = new Editor({ extensions: documentExtensions, content: fixed().toJSON() })
    editor.view.dispatch(editor.state.tr.insertText('あ', editor.state.doc.content.size - 1))

    const nodeNames: string[] = []
    editor.state.doc.forEach((n) => nodeNames.push(n.type.name))
    editor.destroy()
    expect(nodeNames.slice(0, 3)).toEqual(['heading', 'paragraph', 'heading'])
  })

  it('⭐ docToMd に直接渡しても、ツリーと同じ答えになる（層ごとの分岐を持たない）', () => {
    // 入口を通していない生の旧版 doc を、それぞれの層へそのまま渡す
    const raw = legacyDoc()
    const inMd = docToMd(raw).includes('# まえがき')
    const inTree = outline(restoreHeadingMarks(raw)).length > 0
    expect(inMd).toBe(inTree)
  })
})
