/**
 * 独立監査の差し戻し（identifier 英語化・`7b87007` 直前の監査）で見つかった、
 * `image.ts` の移行ガードに対する否定側のテスト。
 *
 * ⚠⚠ 監査の指摘: `legacyImagePartIdRemap` はインスタンス側（`templateId`）を見るガードには
 *   否定側のテスト（`user.something` は移行されない）があるのに、
 *   本文側（`ids.has(instanceId)`）を見るガードには無かった——
 *   `ids.has(ref.instanceId)` を外してもテストは全部緑のままだった。
 *   このガードが守っているのは CONCEPT S10 が正規と認めた「利用者が書いた `画像` という partId」。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { legacyImagePartIdRemap, migrateLegacyImageKeys, IMAGE_TEMPLATE_ID } from '../image'
import type { TemplateInstance } from '../../model'

describe('legacyImagePartIdRemap — 本文側のガード（ids.has(instanceId)）', () => {
  const instances: TemplateInstance[] = [
    { id: 'そざい1', templateId: IMAGE_TEMPLATE_ID, data: {}, images: {} },
    // ⚠ 利用者が持ち込んだ定義。partId『画像』を正規に持ちうる（CONCEPT S10）。
    { id: 'そざい2', templateId: 'user.something', data: {}, images: {} },
  ]
  const remap = legacyImagePartIdRemap(instances)

  it('同梱テンプレのインスタンスなら、旧 partId を現行へ読み替える', () => {
    expect(remap({ instanceId: 'そざい1', partId: '画像' })).toEqual({ partId: 'image' })
  })

  it('⭐ 利用者持ち込みのインスタンスが partId『画像』を使っていても、触らない', () => {
    // ⚠ このガード（ids.has）を外すと、ここが { partId: 'image' } になって赤くなる。
    expect(remap({ instanceId: 'そざい2', partId: '画像' })).toBeNull()
  })

  it('存在しない instanceId への参照（dangling）も触らない', () => {
    expect(remap({ instanceId: '存在しない', partId: '画像' })).toBeNull()
  })

  it('partId が『画像』でなければ、同梱テンプレのインスタンスでも触らない', () => {
    expect(remap({ instanceId: 'そざい1', partId: 'image' })).toBeNull()
  })
})

/**
 * 台帳 A38: 新旧キーが両方在る record の挙動（`rename()` の分岐）が無検査だった。
 *
 * ⚠ 現行の実装は判定を `out`（書き込み先）ではなく `record`（元の入力）に対して行うため、
 *   本来は挿入順に依存しない。**それを確かめるため、あえて 2 通りの順序**で当てる
 *   （1 通りだけだと、判定を `out` に対して行う順序依存の実装でも偶然緑になりうる）。
 */
describe('migrateLegacyImageKeys — 新旧キーが両方在るとき（台帳 A38）', () => {
  function instanceWith(data: Record<string, unknown>): TemplateInstance {
    return { id: 'そざい1', templateId: IMAGE_TEMPLATE_ID, data, images: {} }
  }

  it('旧キーが先・現行キーが後でも、現行キーの値が勝つ', () => {
    const migrated = migrateLegacyImageKeys(instanceWith({ 表示名: '旧い値', caption: '新しい値' }))
    expect(migrated.data).toEqual({ caption: '新しい値' })
  })

  it('現行キーが先・旧キーが後でも、現行キーの値が勝つ（順序を入れ替えた対称形）', () => {
    const migrated = migrateLegacyImageKeys(instanceWith({ caption: '新しい値', 表示名: '旧い値' }))
    expect(migrated.data).toEqual({ caption: '新しい値' })
  })
})
