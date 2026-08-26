/**
 * **テンプレの内部見出しを「配置された階層」に合わせてずらす**（DESIGN-v0.md §1-13-1d・移行 P-c）。
 *
 * ⭐ **式は仕様の決定そのもの**（§1-13-1d 決定1b）:
 *   **出力の深さ = 基準レベル + (テンプレ内の見出しレベル − 1)**
 *   テンプレの先頭 `#`（レベル1）は**基準レベルそのもの**になる。
 *
 * ⚠⚠ **これは「導出時」の変換である**（決定1・案イ）。生成時に焼き込まない。
 *   焼き込むと、章を動かしたときに古い深さのまま残る＝**画面は同じなのに囲む見出しを
 *   変えたときだけ片方が追随しない**という見えない状態が生まれる（台帳 A71 と同型）。
 *   → だから**純関数**であり、状態を持たず、呼ぶたびに現在の基準レベルから作り直す。
 *
 * ⚠ **基準レベルに何を渡すかはこのモジュールの責務ではない**（§1-13-1d）。
 *   ずらす基準は `depthUnder(enclosing)` ではなく `outline.ts` が解決した**最終の `level`**
 *   （明示の深さ `attrs.depth` が優先される・§1-3-3e-2）だが、
 *   **どちらを渡すかは UI 接続フェーズの責務**なので引数で受け取るだけにしてある。
 *
 * ⚠⚠ **深さ 6 超過は clamp せずエラーにする**（決定2）。
 *   clamp は「階層が黙って消える」＝§1-3-3b で直した無音の壊れ方と同型。**テンプレ作者に鳴らす。**
 *
 * ## なぜ手書きの行走査にしないか（設計の中心）
 *
 * ⚠ 行頭の `#` を正規表現で拾うと、**コードフェンスの中の `#` を見出しとして書き換える**。
 *   md のテンプレはシェルコマンドや別の md の例を平気で含むので、これは想像上の危険ではない。
 *   → **見出しの検出は `markdown-it` に任せ**、`heading_open` トークンの `map`（行範囲）が
 *     指した行だけを書き換える line surgery にしてある。
 *
 * ⭐ `token.map` の**実測**（2026-08-26・移行 P-c で確認。推測ではない）:
 *   - `map[0]` は**ソース文字列の絶対行番号**（0 始まり）。引用・リストの中でも絶対行を指す
 *   - コードフェンス（``` / ~~~・引用の中のものも）と字下げコードブロックの `#` は
 *     **`heading_open` を出さない**＝この経路には最初から入ってこない
 *   - setext（`===` / `---`）は `map = [本文の開始行, 下線行 + 1]`・`markup` が `=` か `-`。
 *     **本文が複数行になりうる**（`alpha\nbravo\n=====`）
 *   - CRLF 入力でも行の分割位置は同じ（各行の末尾に `\r` が残るだけ）
 */
import MarkdownIt from 'markdown-it'
import { MAX_LEVEL, MIN_LEVEL } from '../../document/heading'

/** 見出しの検出にだけ使う（レンダリングはしない）。既定の md 方言で十分。 */
const parser = new MarkdownIt()

/**
 * ずらした結果が上限 6 を超えたときに投げる。
 *
 * ⚠ **文面は `LiquidError` に揃えてある**（`engine.ts` の「そのまま利用者に見せられる」水準）:
 *   `message` は一行で末尾が `, line:N, col:M`、**該当行と `^` の抜粋は `stack` 側**。
 *   実測した liquidjs の形（`undefined variable: nope, line:2, col:4` ＋ stack に抜粋）と同じ。
 *
 * ⚠ **`line` はレンダリング後の md の行番号であって、テンプレの行番号ではない。**
 *   `{% for %}` が展開された後の文字列を見ているので、両者は一致しない。
 *   **だから見出しのテキストを必ず message に載せる**——テンプレ作者が現物を探す手掛かりは
 *   行番号ではなくそちらになる。
 */
export class HeadingLevelOverflowError extends Error {
  override readonly name = 'HeadingLevelOverflowError'
  /** レンダリング後の md における 1 始まりの行番号。 */
  readonly line: number
  /** その行の中の 1 始まりの桁（見出し記号の開始位置）。 */
  readonly col: number
  /** 記号を剥がした見出しのテキスト。 */
  readonly headingText: string
  /** ずらした結果の深さ（`MAX_LEVEL` を超えている）。 */
  readonly attemptedLevel: number

  constructor(args: {
    line: number
    col: number
    headingText: string
    attemptedLevel: number
    context: string
  }) {
    super(
      `見出しの深さが ${args.attemptedLevel} になり、上限 ${MAX_LEVEL} を超えました: ` +
        `"${args.headingText}", line:${args.line}, col:${args.col}`,
    )
    this.line = args.line
    this.col = args.col
    this.headingText = args.headingText
    this.attemptedLevel = args.attemptedLevel
    this.stack = `${this.message}\n${args.context}\n${this.name}: ${this.message}\n${this.stack ?? ''}`
  }
}

/** 呼び出し側のバグ（テンプレ作者の誤りと同じ型にしない）。 */
function assertBaseLevel(baseLevel: number): void {
  if (!Number.isInteger(baseLevel) || baseLevel < MIN_LEVEL || baseLevel > MAX_LEVEL) {
    throw new RangeError(
      `基準レベルは ${MIN_LEVEL}〜${MAX_LEVEL} の整数でなければならない: ${baseLevel}`,
    )
  }
}

/** liquidjs と同じ形の抜粋（前後 2 行＋`>>` 印＋`^`）を作る。 */
function excerptOf(lines: string[], lineIndex: number, colIndex: number): string {
  const from = Math.max(0, lineIndex - 2)
  const to = Math.min(lines.length - 1, lineIndex + 2)
  const width = String(to + 1).length
  const out: string[] = []
  for (let i = from; i <= to; i++) {
    const no = String(i + 1).padStart(width)
    const body = lines[i]!.replace(/\r$/, '')
    out.push(i === lineIndex ? `>> ${no}| ${body}` : `   ${no}| ${body}`)
    if (i === lineIndex) out.push(`   ${' '.repeat(width)}| ${' '.repeat(colIndex)}^`)
  }
  return out.join('\n')
}

/** 行頭の引用・リストの前置き（`> ` `> > ` `  ` など）。⚠ ここに `#` は現れない。 */
function prefixOfAtx(line: string, level: number): { prefix: string; rest: string; col: number } {
  const at = line.indexOf('#')
  if (at < 0 || line.slice(at, at + level) !== '#'.repeat(level)) {
    // markdown-it が見出しと言った行に記号が無いのは、この関数の前提が崩れている証拠。
    // 黙って素通しすると「ずれない見出し」が 1 本だけ混ざるので、バグとして鳴らす。
    throw new Error(`ATX 見出しの記号を行の中に見つけられなかった: ${JSON.stringify(line)}`)
  }
  return { prefix: line.slice(0, at), rest: line.slice(at + level), col: at }
}

/**
 * レンダリング後の md 文字列の見出しを、基準レベルに合わせてずらす。
 *
 * @param markdown liquid が返した md 文字列
 * @param baseLevel そのパートの**解決済み** `level`（1〜6）
 * @throws {HeadingLevelOverflowError} ずらした結果が 6 を超える見出しがあるとき（最初の 1 件）
 * @throws {RangeError} `baseLevel` が 1〜6 の整数でないとき
 *
 * ⚠ **`baseLevel === 1` でも恒等写像ではない**。setext は ATX へ変換される。
 *   基準レベルによって出力の**形**が変わらないようにするため（シフト 0 のときだけ
 *   `===` が残ると、同じテンプレが置き場所で別の見た目になる）。
 *
 * ⚠ 違反が複数あっても**最初の 1 件で投げる**（liquidjs と同じ）。
 *   全件集めても、1 件目を直せば行番号が動くので同時には使えない。
 */
export function offsetMarkdownHeadings(markdown: string, baseLevel: number): string {
  assertBaseLevel(baseLevel)

  const lines = markdown.split('\n')
  /** 行番号 → 差し替える行（空配列＝その行を消す）。 */
  const rewritten = new Map<number, string[]>()

  const tokens = parser.parse(markdown, {})
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type !== 'heading_open' || !token.map) continue

    const level = Number(token.tag.slice(1)) // 'h1'..'h6' — ATX でも setext でも同じ
    const newLevel = baseLevel + (level - 1)
    const startLine = token.map[0]!
    // 記号を剥がした見出しの文字列は inline トークンが持っている
    // （`## closed ##` の閉じ記号や引用の `> ` は markdown-it が落としてくれる）。
    const headingText = (tokens[i + 1]?.content ?? '').replace(/\r/g, '')
    const isAtx = token.markup.startsWith('#')

    const col = isAtx
      ? prefixOfAtx(lines[startLine]!, level).col
      : (/^[>\s]*/.exec(lines[startLine]!)?.[0].length ?? 0)

    if (newLevel > MAX_LEVEL) {
      throw new HeadingLevelOverflowError({
        line: startLine + 1,
        col: col + 1,
        headingText: headingText.split('\n')[0]!,
        attemptedLevel: newLevel,
        context: excerptOf(lines, startLine, col),
      })
    }

    const mark = '#'.repeat(newLevel)
    if (isAtx) {
      const { prefix, rest } = prefixOfAtx(lines[startLine]!, level)
      rewritten.set(startLine, [`${prefix}${mark}${rest}`])
      continue
    }

    // setext（`===` / `---`）は ATX に変換する。黙って無視すると決定2「黙って潰さない」に反する。
    // ⚠ 本文が複数行になりうるので、1 行の ATX に畳む（前置きは先頭行のものを使う）。
    const firstLine = lines[startLine]!
    const firstText = headingText.split('\n')[0]!
    const at = firstText === '' ? -1 : firstLine.indexOf(firstText)
    const prefix = at >= 0 ? firstLine.slice(0, at) : (/^[>\s]*/.exec(firstLine)?.[0] ?? '')
    const eol = firstLine.endsWith('\r') ? '\r' : ''
    const text = headingText
      .split('\n')
      .map((s) => s.trim())
      .join(' ')

    rewritten.set(startLine, [`${prefix}${mark} ${text}${eol}`])
    // 残りの本文行と下線行を消す（`map[1]` は下線行の次を指す）。
    for (let line = startLine + 1; line < token.map[1]!; line++) rewritten.set(line, [])
  }

  if (rewritten.size === 0) return markdown

  const out: string[] = []
  for (let line = 0; line < lines.length; line++) {
    const replacement = rewritten.get(line)
    if (replacement) out.push(...replacement)
    else out.push(lines[line]!)
  }
  return out.join('\n')
}
