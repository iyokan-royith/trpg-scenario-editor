/**
 * 完了条件 #1 の裏側（同梱 JSON が loader 経由で読まれている）と #6（壊れた JSON に分かるエラー）。
 *
 * ⚠⚠ ここでいちばん確かめたいのは Q6 ——**同梱品もユーザー持ち込みも同じ経路**であること。
 *   同梱テンプレを「オブジェクトとして import」してしまうと、同梱品だけが検証を素通りし、
 *   「同梱品が動く＝機構が検証される」という Q6 の狙いが**成立していないのに緑になる**。
 *   → 下の「同梱テンプレのテキストを、ユーザー持ち込みと同じ関数へ渡す」テストが陽性対照にあたる。
 *
 * ⚠ 検証データは全て創作。
 */
import { describe, it, expect } from 'vitest'
import { テンプレ定義を読む, 同梱テンプレを読む, 同梱テンプレの一覧 } from '../loader'
import { TemplateDefinitionError } from '../schema'
import { derivePartsOf, type TemplateInstance } from '../model'
import { 画像パターン名 } from '../render/image'

describe('同梱テンプレ', () => {
  it('同梱の画像テンプレが読める（id・fields・outputs が設計どおり）', () => {
    const defs = 同梱テンプレを読む()
    const 画像 = defs.find((d) => d.id === 'builtin.image')
    expect(画像).toBeDefined()
    expect(画像?.name).toBe('画像')
    expect(画像?.fields.map((f) => f.key)).toEqual(['表示名', '画像'])
    expect(画像?.fields.map((f) => f.型)).toEqual(['文字列', '画像'])
    expect(画像?.outputs).toEqual([{ pattern: 画像パターン名 }])
  })

  it('同梱品は「オブジェクト」ではなく「テキスト」で持たれていて、持ち込みと同じ関数を通る', () => {
    // ⭐ ここが Q6 の実地検証。同梱品のテキストを、利用者が選んだファイルと同じ入口へ渡す。
    for (const { text, 出所 } of 同梱テンプレの一覧) {
      expect(typeof text).toBe('string')
      const 直接読んだもの = テンプレ定義を読む(text, 出所)
      expect(直接読んだもの).toEqual(同梱テンプレを読む().find((d) => d.id === 直接読んだもの.id))
    }
  })
})

/** 読み込みに失敗させて、その例外を返す（`expect` を catch の中に置かないため）。 */
function 読んで失敗させる(text: string, 出所: string): TemplateDefinitionError {
  try {
    テンプレ定義を読む(text, 出所)
  } catch (error) {
    return error as TemplateDefinitionError
  }
  throw new Error(`${出所} は例外を投げるはずでした`)
}

describe('壊れた定義には、どこが悪いか分かるエラーが出る（完了条件 #6）', () => {
  it('JSON として壊れている', () => {
    const error = 読んで失敗させる('{ "id": ', 'こわれ.json')
    expect(error).toBeInstanceOf(TemplateDefinitionError)
    expect(error.message).toContain('こわれ.json') // どのファイルか
    expect(error.message).toContain('JSON として読めません') // 何が起きたか
  })

  it('未知のフィールド型は、名前と使える型の一覧を出す', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [{ key: 'なまえ', 型: '文字れつ' }],
      outputs: [{ pattern: 画像パターン名 }],
    })
    const error = 読んで失敗させる(text, 'ためし.json')
    expect(error.message).toContain('fields[0].型') // どこが
    expect(error.message).toContain('文字れつ') // 何が
    expect(error.message).toContain('文字列') // どうすればよいか
  })

  it('未知の組み込みパターンは、使えるパターン名を出す', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [],
      outputs: [{ pattern: 'builtin:imag' }],
    })
    const error = 読んで失敗させる(text, 'ためし.json')
    expect(error.message).toContain('outputs[0].pattern')
    expect(error.message).toContain('builtin:imag')
    expect(error.message).toContain(画像パターン名)
  })

  it('問題は最初の 1 件で止めずに全部集める', () => {
    const text = JSON.stringify({ id: '', name: 'ためし', fields: 'はい', outputs: [] })
    const error = 読んで失敗させる(text, 'ためし.json')
    // id が空・version が無い・fields が配列でない・outputs が空 の 4 件
    expect(error.問題).toHaveLength(4)
    expect(error.問題.join('\n')).toContain('version')
  })

  it('黙って落とさない（壊れた定義が「テンプレ 0 件」として素通りしない）', () => {
    expect(() => テンプレ定義を読む('[]', 'はいれつ.json')).toThrow(
      /いちばん外側がオブジェクトではありません/,
    )
  })
})

describe('builtin:image は画像パートを 1 個生む', () => {
  const def = 同梱テンプレを読む()[0]!

  function インスタンス(images: Record<string, Blob>): TemplateInstance {
    return { id: 'そざい1', templateId: def.id, data: { 表示名: 'ねこの写真' }, images }
  }

  it('画像が入っていれば、その Blob を持つ「本文中」パートになる', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const parts = derivePartsOf(インスタンス({ 画像: blob }), def)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.form).toBe('本文中') // ⚠ 独立章にしない（1-7-3: ツリーに章が生えてしまう）
    expect(parts[0]!.title).toBe('ねこの写真')
    expect(parts[0]!.body).toEqual([{ 種別: '画像', 画像: blob, 代替文: 'ねこの写真' }])
  })

  it('画像が未設定でもパートは消えない（消えると作ったものが黙って居なくなる）', () => {
    const parts = derivePartsOf(インスタンス({}), def)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.body).toEqual([
      { 種別: 'テキスト', 文: 'ねこの写真（画像が設定されていません）' },
    ])
  })
})
