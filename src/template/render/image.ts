/**
 * 組み込みパターン `builtin:image` — 画像 1 枚のパートを 1 個生む（DESIGN-v0.md 1-7-2）。
 *
 * ⚠⚠ **画像に専用のデータ構造を作らないための場所**がここである。
 *   画像は「組み込みテンプレート 1 本のインスタンス」であって、`TemplateInstance` /
 *   `derivePartsOf()` / `analyzePlacement()` は 1 行も画像を知らない。
 *   ここが窮屈だったときに捨てるのは、この 1 ファイルと `templates/image.json` だけで済む。
 *
 * ⚠ 形態は `本文中`（＝1-6-2 の `inline-part`）1 種類（1-7-3）。
 *   「単独で 1 ブロックを占める画像」は **空の段落に置く**ことで表す。
 *   `独立章` にすると画像を置くたびに左ペインのツリーへ章が生えてしまう。
 */
import type { Inline, Part, TemplateDefinition, TemplateInstance } from '../model'

export const 画像パターン名 = 'builtin:image'

/**
 * ⚠ パターンと同梱 JSON は **対で配布される**ので、キー名はここで知っていてよい
 *   （`templates/image.json` の `fields` と必ず一致する）。
 */
export const 表示名キー = '表示名'
export const 画像キー = '画像'

/** このパターンが生むパートの `partId`。1 インスタンス＝1 画像なので固定で 1 個。 */
export const 画像パートID = '画像'

/**
 * ⚠ 画像が未設定・表示名が空でも **パートは生む**。
 *   生まないと、素材一覧からも「未配置 N 件」からも消えて
 *   **利用者が作ったはずのものが黙って居なくなる**（消したのか壊れたのか区別できない）。
 */
export function 画像パートを生む(instance: TemplateInstance, _def: TemplateDefinition): Part[] {
  const 表示名 = String(instance.data[表示名キー] ?? '').trim()
  const 画像 = instance.images[画像キー]
  const 題 = 表示名 || '名前のない画像'

  const body: Inline[] = 画像
    ? [{ 種別: '画像', 画像, 代替文: 題 }]
    : // 画像が入っていないことを、本文でも一覧でも同じ文字列で伝える。
      [{ 種別: 'テキスト', 文: `${題}（画像が設定されていません）` }]

  return [{ instanceId: instance.id, partId: 画像パートID, form: '本文中', title: 題, body }]
}
