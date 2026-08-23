/**
 * 組み込みパターン `builtin:image` — 画像 1 枚のパートを 1 個生む（DESIGN-v0.md 1-7-2）。
 *
 * ⚠⚠ **画像に専用のデータ構造を作らないための場所**がここである。
 *   画像は「組み込みテンプレート 1 本のインスタンス」であって、`TemplateInstance` /
 *   `derivePartsOf()` / `analyzePlacement()` は 1 行も画像を知らない。
 *   ここが窮屈だったときに捨てるのは、この 1 ファイルと `templates/image.json` だけで済む。
 *
 * ⚠ 形態は `inline`（＝1-6-2 の `inline-part`）1 種類（1-7-3）。
 *   「単独で 1 ブロックを占める画像」は **空の段落に置く**ことで表す。
 *   `section` にすると画像を置くたびに左ペインのツリーへ章が生えてしまう。
 */
import type { Inline, Part, TemplateDefinition, TemplateInstance } from '../model'

export const IMAGE_PATTERN = 'builtin:image'

/** 同梱テンプレート「画像」の id。⚠ 綴りの真実は `src/templates/image.json` 側。 */
export const IMAGE_TEMPLATE_ID = 'builtin.image'

/**
 * ⚠ パターンと同梱 JSON は **対で配布される**ので、キー名はここで知っていてよい
 *   （`templates/image.json` の `fields` と必ず一致する）。
 */
export const CAPTION_KEY = 'caption'
export const IMAGE_KEY = 'image'

/** このパターンが生むパートの `partId`。1 インスタンス＝1 画像なので固定で 1 個。 */
export const IMAGE_PART_ID = 'image'

/** §1-8 でキーを英語化する前に保存されたデータが使っていたキー名。 */
const LEGACY_KEYS: Record<string, string> = { 表示名: CAPTION_KEY, 画像: IMAGE_KEY }

/** 同上。⚠ こちらは **本文（doc）側**に `partRef` の属性として保存されている。 */
const LEGACY_PART_ID = '画像'

/**
 * 保存された本文の中の **旧 `partId` を現行のものへ読み替える**関数を作る。
 *
 * ⚠⚠ 素材側（`migrateLegacyImageKeys`）だけでは足りない。`partId` は
 *   **本文の `partRef` ノードの属性としても保存されている**ので、片方だけ直すと
 *   置いた画像が全部「行方不明のパート」になり、「未配置 N 件」も一緒に化ける。
 *   ⚠ **改名した名前が保存されている場所は 1 つとは限らない。**
 *
 * ⚠ 読み込み済みのインスタンス集合でゲートする。利用者が持ち込む定義は
 *   `画像` という partId を**正規に持ちうる**（CONCEPT S10）ので、
 *   同梱テンプレ由来の参照だけに限る。
 */
export function legacyImagePartIdRemap(
  instances: TemplateInstance[],
): (ref: { instanceId: string; partId: string }) => { partId: string } | null {
  const ids = new Set(instances.filter((i) => i.templateId === IMAGE_TEMPLATE_ID).map((i) => i.id))
  return (ref) =>
    ref.partId === LEGACY_PART_ID && ids.has(ref.instanceId) ? { partId: IMAGE_PART_ID } : null
}

/**
 * 保存済みインスタンスの **旧キーを現行キーへ読み替える**（読み込みの境界で 1 回だけ）。
 *
 * ⚠⚠ これが無いと、識別子の英語化（§1-8）が**既に保存されている素材を黙って壊す**——
 *   バイト列は残るのにキーが引けず、画面には「画像が設定されていません」と出る。
 *   ⚠ 名前の付け替えは、**保存された形が契約になっている場所では純粋な改名ではない**。
 *
 * ⚠ 対象は同梱テンプレートのインスタンスだけに限る。
 *   利用者が持ち込む定義では日本語キーを**正規に許している**（CONCEPT S10）ので、
 *   無条件に読み替えると利用者のキーを勝手に書き換えてしまう。
 */
export function migrateLegacyImageKeys(instance: TemplateInstance): TemplateInstance {
  if (instance.templateId !== IMAGE_TEMPLATE_ID) return instance

  const rename = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) {
      const now = LEGACY_KEYS[key] ?? key
      // ⚠ 現行キーが既に在るときは触らない（新しい方を勝つ側にする）。
      if (!(now in record) || now === key) out[now] = value
    }
    return out
  }

  return { ...instance, data: rename(instance.data), images: rename(instance.images) }
}

/**
 * ⚠ 画像が未設定・表示名が空でも **パートは生む**。
 *   生まないと、素材一覧からも「未配置 N 件」からも消えて
 *   **利用者が作ったはずのものが黙って居なくなる**（消したのか壊れたのか区別できない）。
 */
export function renderImagePart(instance: TemplateInstance, _def: TemplateDefinition): Part[] {
  const caption = String(instance.data[CAPTION_KEY] ?? '').trim()
  const image = instance.images[IMAGE_KEY]
  // ⚠ 表示に出る文字列は日本語のまま（§1-8-1: 英語にするのは識別子だけ）。
  const title = caption || '名前のない画像'

  const body: Inline[] = image
    ? [{ kind: 'image', image, alt: title }]
    : // 画像が入っていないことを、本文でも一覧でも同じ文字列で伝える。
      [{ kind: 'text', text: `${title}（画像が設定されていません）` }]

  return [{ instanceId: instance.id, partId: IMAGE_PART_ID, form: 'inline', title, body }]
}
