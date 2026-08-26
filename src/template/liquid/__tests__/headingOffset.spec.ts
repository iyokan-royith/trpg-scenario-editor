/**
 * `offsetMarkdownHeadings` — テンプレ内部の見出しを配置深さに合わせてずらす（§1-13-1d・移行 P-c）。
 *
 * ⭐⭐ **このファイルが守っているのは 2 つの性質**で、どちらも変異で赤になることを実証してある:
 *   ① **見出しでないものを書き換えない**（コードフェンス・字下げコード）
 *      → 変異「トークンを使わず行頭 `#` の正規表現で全行を書き換える」で赤になる
 *   ② **6 を超えたら黙って潰さず投げる**（決定2）
 *      → 変異「throw を `Math.min(newLevel, 6)` に差し替える」で赤になる
 *
 * ⚠ アサーションは**文字列全体の等値**で書く。substring で見ると
 *   「触ってはいけない行が無傷か」という**裏側の性質**が検査から落ちる（①がまさにそれ）。
 */
import { describe, it, expect } from 'vitest'
import { offsetMarkdownHeadings, HeadingLevelOverflowError } from '../headingOffset'

describe('式（§1-13-1d 決定1b）: 出力の深さ = 基準レベル + (テンプレ内の見出しレベル − 1)', () => {
  it('先頭の `#` は基準レベルそのものになる（案ア）', () => {
    expect(offsetMarkdownHeadings('# 部屋\n\n本文\n', 3)).toBe('### 部屋\n\n本文\n')
  })

  it('テンプレ内の相対関係がそのまま保たれる', () => {
    const src = '# 部屋\n\n## 仕掛け\n\n### 判定\n'
    expect(offsetMarkdownHeadings(src, 2)).toBe('## 部屋\n\n### 仕掛け\n\n#### 判定\n')
  })

  it('基準レベル 1 では ATX 見出しが 1 文字も動かない（シフト 0）', () => {
    const src = '# 部屋\n\n## 仕掛け\n'
    expect(offsetMarkdownHeadings(src, 1)).toBe(src)
  })

  it('先頭が `##` のテンプレも素直にずれる（「先頭は必ず `#`」は規約であって強制しない）', () => {
    // 基準 3・テンプレ `##` → 3 + (2 − 1) = 4
    expect(offsetMarkdownHeadings('## 途中から\n', 3)).toBe('#### 途中から\n')
  })

  it('仕様に書かれた計算例がそのまま通る（囲む見出しが 4 → 基準 5 → `###` は 7）', () => {
    expect(() => offsetMarkdownHeadings('# 部屋\n\n### 判定\n', 5)).toThrow(
      HeadingLevelOverflowError,
    )
  })

  it('境界: 基準 5 + `##` = 6 はエラーにならない', () => {
    expect(offsetMarkdownHeadings('# 部屋\n\n## 仕掛け\n', 5)).toBe('##### 部屋\n\n###### 仕掛け\n')
  })
})

describe('⭐ 見出しでないものを書き換えない（手書きの行走査にしなかった理由）', () => {
  it('コードフェンスの中の `#` は見出しではない', () => {
    const src = ['# 部屋', '', '```sh', '# コメント', '## これも', '```', '', '## 仕掛け', ''].join(
      '\n',
    )
    const want = [
      '## 部屋',
      '',
      '```sh',
      '# コメント',
      '## これも',
      '```',
      '',
      '### 仕掛け',
      '',
    ].join('\n')
    expect(offsetMarkdownHeadings(src, 2)).toBe(want)
  })

  it('`~~~` のフェンスでも同じ', () => {
    const src = ['# 部屋', '', '~~~', '# コメント', '~~~', ''].join('\n')
    const want = ['### 部屋', '', '~~~', '# コメント', '~~~', ''].join('\n')
    expect(offsetMarkdownHeadings(src, 3)).toBe(want)
  })

  it('引用の中のフェンスでも同じ', () => {
    const src = ['# 部屋', '', '> ```', '> # コメント', '> ```', ''].join('\n')
    const want = ['## 部屋', '', '> ```', '> # コメント', '> ```', ''].join('\n')
    expect(offsetMarkdownHeadings(src, 2)).toBe(want)
  })

  it('字下げコードブロックの `#` も見出しではない', () => {
    const src = ['# 部屋', '', '    # 字下げ', ''].join('\n')
    const want = ['## 部屋', '', '    # 字下げ', ''].join('\n')
    expect(offsetMarkdownHeadings(src, 2)).toBe(want)
  })

  it('`#hashtag`（スペースが無い）は見出しではない', () => {
    expect(offsetMarkdownHeadings('# 部屋\n\n#タグ\n', 2)).toBe('## 部屋\n\n#タグ\n')
  })

  it('見出しが 1 つも無ければ入力をそのまま返す', () => {
    const src = '本文だけ\n\n```\n# no\n```\n'
    expect(offsetMarkdownHeadings(src, 4)).toBe(src)
  })
})

describe('引用・リストの前置きを保つ', () => {
  it('`> # 見出し` は `> ` を残して記号だけ増える', () => {
    expect(offsetMarkdownHeadings('> # 引用の見出し\n', 3)).toBe('> ### 引用の見出し\n')
  })

  it('入れ子の引用でも前置きが保たれる', () => {
    expect(offsetMarkdownHeadings('> > # 深い引用\n', 2)).toBe('> > ## 深い引用\n')
  })

  it('閉じ記号付き（`## x ##`）は先頭の記号だけ書き換える', () => {
    expect(offsetMarkdownHeadings('## 閉じ付き ##\n', 2)).toBe('### 閉じ付き ##\n')
  })

  it('記号のあとの空白は元のまま残る（本文は触らない）', () => {
    expect(offsetMarkdownHeadings('#    余白つき\n', 2)).toBe('##    余白つき\n')
  })
})

describe('setext（`===` / `---`）は ATX に変換してずらす（黙って無視しない）', () => {
  it('`===` は h1 として扱われ ATX になる', () => {
    expect(offsetMarkdownHeadings('見出し\n=====\n', 3)).toBe('### 見出し\n')
  })

  it('`---` は h2 として扱われる', () => {
    expect(offsetMarkdownHeadings('見出し\n-----\n', 3)).toBe('#### 見出し\n')
  })

  it('⭐ 基準レベル 1（シフト 0）でも ATX に変換する（置き場所で形が変わらないように）', () => {
    expect(offsetMarkdownHeadings('見出し\n=====\n', 1)).toBe('# 見出し\n')
  })

  it('本文が複数行の setext は 1 行の ATX に畳まれる', () => {
    expect(offsetMarkdownHeadings('あるふぁ\nぶらぼー\n=====\n', 2)).toBe('## あるふぁ ぶらぼー\n')
  })

  it('引用の中の setext も前置きを保ったまま ATX になる', () => {
    expect(offsetMarkdownHeadings('> 見出し\n> =====\n', 2)).toBe('> ## 見出し\n')
  })

  it('setext が消えても後続の本文の行がずれない', () => {
    const src = '見出し\n=====\n\n本文\n\n次\n---\n\nおしまい\n'
    expect(offsetMarkdownHeadings(src, 2)).toBe('## 見出し\n\n本文\n\n### 次\n\nおしまい\n')
  })

  it('setext も 6 超過でエラーになる', () => {
    expect(() => offsetMarkdownHeadings('見出し\n-----\n', 6)).toThrow(HeadingLevelOverflowError)
  })
})

describe('⭐ 6 超過は clamp せずエラー（決定2・黙って潰さない）', () => {
  it('深さ 7 になる見出しで投げる', () => {
    expect(() => offsetMarkdownHeadings('# 部屋\n\n## 仕掛け\n', 6)).toThrow(
      HeadingLevelOverflowError,
    )
  })

  it('message に「行番号」と「該当見出しのテキスト」が載る（§1-13-1d の要求）', () => {
    let caught: HeadingLevelOverflowError | undefined
    try {
      offsetMarkdownHeadings('# 部屋\n\n### 判定\n', 5)
    } catch (e) {
      caught = e as HeadingLevelOverflowError
    }
    expect(caught).toBeInstanceOf(HeadingLevelOverflowError)
    expect(caught!.message).toBe(
      '見出しの深さが 7 になり、上限 6 を超えました: "判定", line:3, col:1',
    )
    expect(caught!.line).toBe(3)
    expect(caught!.col).toBe(1)
    expect(caught!.headingText).toBe('判定')
    expect(caught!.attemptedLevel).toBe(7)
  })

  it('stack に該当行と `^` の抜粋が載る（LiquidError と同じ水準）', () => {
    let caught: HeadingLevelOverflowError | undefined
    try {
      offsetMarkdownHeadings('# 部屋\n\n> ### 判定\n', 5)
    } catch (e) {
      caught = e as HeadingLevelOverflowError
    }
    // `> ` のぶん桁がずれ、キャレットが記号の先頭を指す
    expect(caught!.col).toBe(3)
    expect(caught!.stack).toContain(
      ['   1| # 部屋', '   2| ', '>> 3| > ### 判定', '    |   ^', '   4| '].join('\n'),
    )
  })

  it('違反が 2 件あるときは最初の 1 件で投げる', () => {
    let caught: HeadingLevelOverflowError | undefined
    try {
      offsetMarkdownHeadings('### さき\n\n#### あと\n', 5)
    } catch (e) {
      caught = e as HeadingLevelOverflowError
    }
    expect(caught!.headingText).toBe('さき')
    expect(caught!.line).toBe(1)
  })

  it('先に有効な見出しがあっても、部分適用された文字列は返さない', () => {
    // `# 部屋` は基準 5 なら `#####` になる**有効な**見出し。あとの `### 判定` が 7 で違反する。
    // ⚠ ここで「途中まで書き換えた文字列」が返ると、利用者は壊れた md を受け取ったまま気づけない。
    let result: string | undefined
    expect(() => {
      result = offsetMarkdownHeadings('# 部屋\n\n### 判定\n', 5)
    }).toThrow(HeadingLevelOverflowError)
    expect(result).toBeUndefined()
  })
})

describe('呼び出し側のバグは別のエラーにする', () => {
  it.each([0, 7, 1.5, Number.NaN])('基準レベル %s は RangeError', (bad) => {
    expect(() => offsetMarkdownHeadings('# x\n', bad)).toThrow(RangeError)
  })

  it('RangeError は HeadingLevelOverflowError ではない（テンプレ作者の誤りと混ぜない）', () => {
    expect(() => offsetMarkdownHeadings('# x\n', 0)).not.toThrow(HeadingLevelOverflowError)
  })
})

describe('本文を壊さない', () => {
  it('CRLF の改行が保たれる', () => {
    const src = '# 部屋\r\n\r\n本文\r\n\r\n## 仕掛け\r\n'
    expect(offsetMarkdownHeadings(src, 2)).toBe('## 部屋\r\n\r\n本文\r\n\r\n### 仕掛け\r\n')
  })

  it('末尾に改行が無くても壊れない', () => {
    expect(offsetMarkdownHeadings('# 部屋\n\n## 仕掛け', 2)).toBe('## 部屋\n\n### 仕掛け')
  })

  it('空文字列はそのまま', () => {
    expect(offsetMarkdownHeadings('', 3)).toBe('')
  })

  it('表・リスト・強調などの本文は 1 文字も変わらない', () => {
    const src = [
      '# 部屋',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- **強調**',
      '',
    ].join('\n')
    const want = [
      '### 部屋',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- **強調**',
      '',
    ].join('\n')
    expect(offsetMarkdownHeadings(src, 3)).toBe(want)
  })
})
