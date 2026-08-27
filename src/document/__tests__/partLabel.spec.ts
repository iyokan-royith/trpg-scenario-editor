/**
 * **畳んだパート参照のラベル**（DESIGN-v0.md §1-13-1i・移行 P-e）。
 *
 * ⚠⚠ **このファイルの合格条件は「見出しが取れること」ではない。**
 *   見出しが取れる例だけを並べると、`/^#+\s*(.*)$/` の 1 行実装でも全部緑になる。
 *   → **その実装だと落ちる例**（コードフェンスの中の `#`・setext・閉じ記号）と、
 *     **退避が起きる例**（見出しが無い・本文が空・画像だけ）を対で置く。
 */
import { describe, it, expect } from 'vitest'
import { firstHeadingText, partLabelOf, UNTITLED_PART_LABEL } from '../partLabel'
import type { Inline } from '../../template/model'

function textBody(text: string): Inline[] {
  return [{ kind: 'text', text }]
}

function imageBody(alt: string): Inline[] {
  return [{ kind: 'image', image: new Blob(['x']), alt }]
}

describe('firstHeadingText — md の第一見出し', () => {
  it('ATX の見出しを記号を剥がして返す', () => {
    expect(firstHeadingText('# C3: 入場ゲート\n\n本文\n')).toBe('C3: 入場ゲート')
  })

  it('先頭が見出しでなくても、最初に現れた見出しを返す', () => {
    expect(firstHeadingText('前書き\n\n## 遭遇\n\n* 種別: なし\n')).toBe('遭遇')
  })

  it('見出しが複数あっても最初の 1 つだけを返す', () => {
    expect(firstHeadingText('# さき\n\n## あと\n')).toBe('さき')
  })

  it('閉じ記号つきの ATX（`## x ##`）でも記号が残らない', () => {
    expect(firstHeadingText('## かめのこう ##\n')).toBe('かめのこう')
  })

  it('setext（`===`）も拾う', () => {
    expect(firstHeadingText('しんりんエリア\n=====\n\n本文\n')).toBe('しんりんエリア')
  })

  it('setext の本文が複数行でも 1 行に畳む（ラベルは 1 行しか出せない）', () => {
    expect(firstHeadingText('alpha\nbravo\n=====\n')).toBe('alpha bravo')
  })

  it('⭐⭐ コードフェンスの中の `#` を見出しにしない（正規表現実装だとここが落ちる）', () => {
    const md = [
      '```sh',
      '# これはシェルのコメント',
      'echo hi',
      '```',
      '',
      '## 本物の見出し',
      '',
    ].join('\n')
    expect(firstHeadingText(md)).toBe('本物の見出し')
  })

  it('⭐ 見出しがコードフェンスの中にしか無ければ `null`（フェンスを見出しに数えていない証拠）', () => {
    expect(firstHeadingText('```\n# ぜんぶコメント\n```\n')).toBeNull()
  })

  it('字下げコードブロックの `#` も見出しにしない', () => {
    expect(firstHeadingText('    # 字下げ 4 個\n')).toBeNull()
  })

  it('見出しが 1 つも無ければ `null`', () => {
    expect(firstHeadingText('ただの本文です。\n\n* 箇条書き\n')).toBeNull()
  })

  it('空文字なら `null`', () => {
    expect(firstHeadingText('')).toBeNull()
  })

  it('中身が空の見出し（`#` だけ）は飛ばして次の見出しを見る', () => {
    expect(firstHeadingText('#\n\n## つぎ\n')).toBe('つぎ')
  })

  it('中身が空の見出ししか無ければ `null`', () => {
    expect(firstHeadingText('#\n')).toBeNull()
  })
})

describe('partLabelOf — 退避の順（見出し → title → 既定）', () => {
  it('見出しが取れればそれを使う（title は使わない）', () => {
    expect(
      partLabelOf({
        title: '部屋シート（たたき台） 入場ゲート',
        body: textBody('# C3: 入場ゲート\n'),
      }),
    ).toBe('C3: 入場ゲート')
  })

  it('見出しが取れなければ `title` へ退避する', () => {
    expect(partLabelOf({ title: '部屋シート 入場ゲート', body: textBody('本文だけ\n') })).toBe(
      '部屋シート 入場ゲート',
    )
  })

  it('本文が空なら `title` へ退避する', () => {
    expect(partLabelOf({ title: '空のパート', body: [] })).toBe('空のパート')
  })

  it('⭐ 画像だけのパートは `title` へ退避する', () => {
    expect(partLabelOf({ title: 'ねこ.png', body: imageBody('ねこ.png') })).toBe('ねこ.png')
  })

  it('⭐⭐ 画像の `alt` が md の見出しに見えても、見出しとして読まない', () => {
    // alt は「画面に出す代替文字」であって md ではない。ここを `inlineText()` で
    // 畳むと alt が見出しに化ける（`partLabel.ts` の `markdownOf` がその防波堤）。
    expect(partLabelOf({ title: 'ねこの写真', body: imageBody('# にせ見出し') })).toBe('ねこの写真')
  })

  it('見出しも title も無ければ既定の文字列（空ラベルの行を作らない）', () => {
    expect(partLabelOf({ title: '   ', body: textBody('本文\n') })).toBe(UNTITLED_PART_LABEL)
  })

  it('画像とテキストが混ざっていても、テキスト側の見出しは拾う', () => {
    const body: Inline[] = [
      { kind: 'image', image: new Blob(['x']), alt: 'ねこ.png' },
      { kind: 'text', text: '# 混在の見出し\n' },
    ]
    expect(partLabelOf({ title: 'まざりもの', body })).toBe('混在の見出し')
  })
})
