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
import { Fragment, Node as PMNode, type Schema } from '@tiptap/pm/model'

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

/**
 * ⭐⭐ **不変条件: この層より内側に「記号を持たない heading ノード」は存在しない。**
 *
 * ⚠⚠ なぜ入口で直すのか（2026-08-23・3巡目監査の差し戻し）:
 *
 *   記号を持たない heading は **2 通りの意味を持ちうる**——
 *   ①**外から入ってきた**（旧版が保存した doc・他所で作られた JSON）＝「見出しのつもり」なので**直す**
 *   ②**編集中に記号が消された**＝「もう見出しではない」ので**段落へ降ろす**（完了条件 #1 の後半）
 *
 *   **形は同じで、意味を分けるのは「いつ来たか」だけ**。だから編集の規則（HeadingSync）の中では
 *   区別できず、**入口で①を潰しておくしかない**。潰した後は、編集中に記号が無いものは
 *   ②しかありえなくなる。
 *
 * ⚠ これを入口に置かなかったせいで、**同じ doc に 3 つの層が 3 通りの答えを出していた**
 *   （md は見出しとして出し・ツリーは黙って落とし・編集を 1 文字入れると段落へ降格して自動保存で確定）。
 *   ⚠ 私は `markdown.ts` の中でだけこの場合に気づいて処理しており、
 *   **「気づいて 1 箇所だけ直した」のが 3 通りに分かれた原因**だった。
 *
 * → **記号にまつわる判断はこのファイルにしか置かない。**
 *   新しい層が増えても、その層は「記号があるか」だけを見ればよく、
 *   **「記号が無い heading をどう解釈するか」を各層が決める必要が二度と生じない**。
 *
 * ⚠ 呼ぶ場所は **doc が外から入ってくる所すべて**（現在 3 つ）:
 *   ①保存された内容の読み込み ②md の解釈 ③md への書き出しの入力。
 */
export function 記号を補う(doc: PMNode): PMNode {
  const 見出し = doc.type.schema.nodes.heading
  if (!見出し) return doc

  const blocks: PMNode[] = []
  let 変えた = false
  doc.forEach((node) => {
    if (node.type !== 見出し || 見出しレベル(node.textContent) !== null) {
      blocks.push(node)
      return
    }
    // 記号が無い＝外から来た見出し。attrs.level を「元の書き手の意図」として読み、記号に起こす。
    // ⚠ attrs.level をふるまいに使うのは **ここだけ**。ここを通った後は誰も読まない。
    const 記号 = doc.type.schema.text(見出し記号(Number(node.attrs.level) || 1))
    blocks.push(node.copy(Fragment.from(記号).append(node.content)))
    変えた = true
  })
  return 変えた ? doc.copy(Fragment.fromArray(blocks)) : doc
}

/**
 * 保存された JSON を、**記号を補ってから** JSON として返す。
 *
 * ⚠ 返すのが JSON なのは意図的。`Node` を返すと呼び手が Editor に渡したくなるが、
 *   **Editor は自分の Schema を別に持っている**ので、別スキーマのノードは黙って捨てられる
 *   （P1 実装中に踏んだ「例外も出さずに何も起きない」型）。JSON はスキーマに依存しない。
 *
 * ⚠ 読めない JSON はそのまま返す（fail-open）。ここで投げると**開けなくなる**方が損。
 */
export function 保存内容の記号を補う(json: unknown, schema: Schema): unknown {
  try {
    return 記号を補う(PMNode.fromJSON(schema, json as never)).toJSON()
  } catch {
    return json
  }
}
