/**
 * 見出し記号（`## `）の規則。**ここが唯一の定義**。
 *
 * ⭐⭐ 2026-08-23 の CONCEPT Q2 改訂（ロイス指示「ア＝ソース方式」）:
 *   **記号は本物のテキストとして本文に残り、編集できる。消せば段落に戻る。**
 *   ロイスの言葉:「wysiwyg が嫌いで、メタデータはメタデータとして編集したい」。
 *
 * ⚠⚠ **これに伴い「見出しレベルの単一の真実」は `attrs.level` ではなく本文のテキストになった。**
 *   `attrs.level` は **`<h2>` を出すための表示上のヒント**にすぎず、
 *   ふるまい（ツリー・並べ替え・md 出力）は**必ずこのファイルの関数で本文から導出する**。
 *   → こうしておくと、attrs が古い doc（保存済み JSON・外から来た JSON）を読んでも
 *     **ふるまいは絶対にずれない**。二重管理が原理的に起こらない。
 */

/** `#` 1〜6 個＋半角スペース。⚠ スペースまでを記号とみなす（`#hashtag` は見出しではない）。 */
const 記号の形 = /^(#{1,6}) /

export const 最小レベル = 1
export const 最大レベル = 6

/** 本文テキストから見出しレベルを読む。見出しでなければ null。 */
export function 見出しレベル(text: string): number | null {
  const m = 記号の形.exec(text)
  return m ? m[1]!.length : null
}

/** レベルに対応する記号（末尾のスペースを含む）。 */
export function 見出し記号(level: number): string {
  const n = Math.min(最大レベル, Math.max(最小レベル, Math.trunc(level)))
  return '#'.repeat(n) + ' '
}

/** 本文テキストから記号を剥がした「題名」。見出しでなければそのまま返す。 */
export function 見出しの題名(text: string): string {
  const level = 見出しレベル(text)
  return level === null ? text : text.slice(level + 1)
}

/** 本文テキストの先頭にある記号の文字数（見出しでなければ 0）。 */
export function 記号の長さ(text: string): number {
  const level = 見出しレベル(text)
  return level === null ? 0 : level + 1
}
