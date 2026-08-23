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
import { readTemplateDefinition, readBundledTemplates, bundledTemplates } from '../loader'
import { TemplateDefinitionError } from '../schema'
import { derivePartsOf, type TemplateInstance } from '../model'
import { IMAGE_PATTERN } from '../render/image'

describe('同梱テンプレ', () => {
  it('同梱の画像テンプレが読める（id・fields・outputs が設計どおり）', () => {
    const defs = readBundledTemplates()
    const imageDef = defs.find((d) => d.id === 'builtin.image')
    expect(imageDef).toBeDefined()
    expect(imageDef?.name).toBe('画像')
    expect(imageDef?.fields.map((f) => f.key)).toEqual(['caption', 'image'])
    expect(imageDef?.fields.map((f) => f.type)).toEqual(['string', 'image'])
    expect(imageDef?.outputs).toEqual([{ pattern: IMAGE_PATTERN }])
  })

  it('同梱品は「オブジェクト」ではなく「テキスト」で持たれていて、持ち込みと同じ関数を通る', () => {
    // ⭐ ここが Q6 の実地検証。同梱品のテキストを、利用者が選んだファイルと同じ入口へ渡す。
    for (const { text, source } of bundledTemplates) {
      expect(typeof text).toBe('string')
      const direct = readTemplateDefinition(text, source)
      expect(direct).toEqual(readBundledTemplates().find((d) => d.id === direct.id))
    }
  })
})

/** 読み込みに失敗させて、その例外を返す（`expect` を catch の中に置かないため）。 */
function readAndFail(text: string, source: string): TemplateDefinitionError {
  try {
    readTemplateDefinition(text, source)
  } catch (error) {
    return error as TemplateDefinitionError
  }
  throw new Error(`${source} は例外を投げるはずでした`)
}

describe('壊れた定義には、どこが悪いか分かるエラーが出る（完了条件 #6）', () => {
  it('JSON として壊れている', () => {
    const error = readAndFail('{ "id": ', 'こわれ.json')
    expect(error).toBeInstanceOf(TemplateDefinitionError)
    expect(error.message).toContain('こわれ.json') // どのファイルか
    expect(error.message).toContain('JSON として読めません') // 何が起きたか
  })

  it('未知のフィールド型は、名前と使える型の一覧を出す', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [{ key: 'なまえ', type: '文字れつ' }],
      outputs: [{ pattern: IMAGE_PATTERN }],
    })
    const error = readAndFail(text, 'ためし.json')
    expect(error.message).toContain('fields[0].type') // どこが
    expect(error.message).toContain('文字れつ') // 何が
    expect(error.message).toContain('string') // どうすればよいか
  })

  it('未知の組み込みパターンは、使えるパターン名を出す', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [],
      outputs: [{ pattern: 'builtin:imag' }],
    })
    const error = readAndFail(text, 'ためし.json')
    expect(error.message).toContain('outputs[0].pattern')
    expect(error.message).toContain('builtin:imag')
    expect(error.message).toContain(IMAGE_PATTERN)
  })

  it('問題は最初の 1 件で止めずに全部集める', () => {
    const text = JSON.stringify({ id: '', name: 'ためし', fields: 'はい', outputs: [] })
    const error = readAndFail(text, 'ためし.json')
    // id が空・version が無い・fields が配列でない・outputs が空 の 4 件
    expect(error.problems).toHaveLength(4)
    expect(error.problems.join('\n')).toContain('version')
  })

  it('黙って落とさない（壊れた定義が「テンプレ 0 件」として素通りしない）', () => {
    expect(() => readTemplateDefinition('[]', 'はいれつ.json')).toThrow(
      /いちばん外側がオブジェクトではありません/,
    )
  })
})

describe('builtin:image は画像パートを 1 個生む', () => {
  const def = readBundledTemplates()[0]!

  function instanceWith(images: Record<string, Blob>): TemplateInstance {
    return { id: 'そざい1', templateId: def.id, data: { caption: 'ねこの写真' }, images }
  }

  it('画像が入っていれば、その Blob を持つ「本文中」パートになる', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const parts = derivePartsOf(instanceWith({ image: blob }), def)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.form).toBe('inline') // ⚠ 独立章にしない（1-7-3: ツリーに章が生えてしまう）
    expect(parts[0]!.title).toBe('ねこの写真')
    expect(parts[0]!.body).toEqual([{ kind: 'image', image: blob, alt: 'ねこの写真' }])
  })

  it('画像が未設定でもパートは消えない（消えると作ったものが黙って居なくなる）', () => {
    const parts = derivePartsOf(instanceWith({}), def)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.body).toEqual([
      { kind: 'text', text: 'ねこの写真（画像が設定されていません）' },
    ])
  })
})
