/**
 * **畳んだパート参照に出す 1 行のラベル**（DESIGN-v0.md §1-13-1i・移行 P-e）。
 *
 * ⭐ ラベルは **パート本文（md）の第一見出し**。取れなければ `part.title` へ退避する。
 *   ⚠⚠ これは `part.title` を捨てる決定である——`title` は
 *   `部屋シート（たたき台） 入場ゲート` のように**テンプレの名前**を含むので、
 *   本文の中では「どのテンプレから生まれたか」を毎行くり返すだけになり、
 *   本文先頭行（`# C3: 入場ゲート`）と**同じ部屋名を 2 箇所に出す**（台帳 A105）。
 *   → 本文の中で人が探す手掛かりは**見出しの側**なので、そちらを既定にする。
 *
 * ## なぜ正規表現で `^#` を拾わないか
 *
 * ⚠ `headingOffset.ts` と**同じ理由**（あちらのコメントが単一の真実）:
 *   md のテンプレはコードフェンスの中にシェルコマンドや別の md の例を平気で含むので、
 *   行頭の `#` を素で拾うと**コードフェンスの中の `#` をラベルにする**。
 *   → 見出しの検出は `markdown-it` に任せ、`heading_open` の**次の inline トークン**の
 *     `content` を読む（記号の剥がし・`## closed ##` の閉じ記号・引用の `> ` は向こうが落とす）。
 *
 * ⚠ **ずらす前の md を見てよい**（`offsetMarkdownHeadings` は通さない）。
 *   ラベルに要るのは見出しの**文字列**だけで、深さは関係ない。
 *   ずらした後を見ると「置き場所によってラベルが変わる」ことになりかねない。
 */
import MarkdownIt from 'markdown-it'
import type { Inline, Part } from '../template/model'

/** 見出しの検出にだけ使う（レンダリングはしない）。⚠ `headingOffset.ts` と同じ方言。 */
const parser = new MarkdownIt()

/** ラベルが 1 文字も作れなかったときに出す文字列。⚠ 空文字を出すと押せない行になる。 */
export const UNTITLED_PART_LABEL = '（無題のパート）'

/**
 * md 文字列の**第一見出し**のテキスト。見出しが 1 つも無ければ `null`。
 *
 * ⚠ 「先頭行が見出しか」ではなく「**最初に現れる見出し**」を返す。
 *   テンプレは前書きから始まってもよい（`{% if %}` で先頭が空になる形もある）。
 *
 * ⚠ setext（`===` / `---`）も拾う。本文が複数行になりうるので**1 行に畳む**
 *   （ラベルは 1 行だけを出す場所なので、改行が入ると畳んだ意味が消える）。
 */
export function firstHeadingText(markdown: string): string | null {
  const tokens = parser.parse(markdown, {})
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== 'heading_open') continue
    const text = (tokens[i + 1]?.content ?? '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' ')
    // ⚠ `#` だけの行は markdown-it が見出しと認めるが中身が空。
    //   空をラベルにすると「開けない空行」になるので、次の見出しを探す。
    if (text !== '') return text
  }
  return null
}

/**
 * パート本文のうち**文字の部分**だけを 1 本に繋ぐ。
 *
 * ⚠ `inlineText()` を使わない。あちらは画像を **alt 文字列に畳む**ので、
 *   `alt` が `# ねこ.png` のような文字列だったときに**画像を見出しとして読む**。
 *   ラベルの元は「md として書かれた文字」だけである。
 */
function markdownOf(body: readonly Inline[]): string {
  return body.map((item) => (item.kind === 'text' ? item.text : '')).join('')
}

/**
 * そのパートを 1 行で表すラベル。
 *
 * 順に ①本文の第一見出し ②`part.title` ③`UNTITLED_PART_LABEL`。
 * ⚠ ③まで用意してあるのは、**利用者が自作したテンプレでは `label` が空になりうる**から
 *   （同梱テンプレしか見ていないと ② で必ず埋まるように見える）。
 */
export function partLabelOf(part: Pick<Part, 'title' | 'body'>): string {
  const heading = firstHeadingText(markdownOf(part.body))
  if (heading !== null) return heading
  const title = part.title.trim()
  if (title !== '') return title
  return UNTITLED_PART_LABEL
}
