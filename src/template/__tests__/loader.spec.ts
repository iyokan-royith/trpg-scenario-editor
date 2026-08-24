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
import {
  readTemplateDefinition,
  readBundledTemplates,
  bundledTemplates,
  normalizeKeysToNfc,
} from '../loader'
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

/**
 * DESIGN-v0.md §1-8-4 規約①: **読み込みの入口でキーを NFC へ揃える。**
 *
 * ⚠⚠ ここで確かめたいのは「NFC の文字列を通したら通った」ではない。
 *   **NFD で書かれたキーを与えて、NFC のキーで引けるようになる**こと。
 *   前者は正規化を丸ごと消しても緑のままで、何も検査していない。
 */
describe('日本語キーの正規化（NFC）', () => {
  /** 「が」の 2 通りの書き方。**見た目は同じで、文字列としては別物**。 */
  const NFC = 'が' // が（合成済み・1 文字）
  const NFD = 'が' // か + 濁点（分解形・2 文字）

  it('前提: この 2 つは見た目が同じでも一致しない（陽性対照）', () => {
    expect(NFD).not.toBe(NFC)
    expect(NFD.length).toBe(2)
    // オブジェクトのキーとしても別物として扱われる＝これが防ぎたい事故
    expect(({ [NFD]: 1 } as Record<string, number>)[NFC]).toBeUndefined()
  })

  it('NFD で書かれたフィールドキーが、NFC のキーで引けるようになる', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [{ key: `${NFD}ぞう`, type: 'string' }],
      outputs: [{ kind: 'fixed', key: `${NFD}ぞう`, label: 'ひょうじ', form: 'section' }],
    })
    // 与えたテキストは確かに NFD（前提が崩れていたらこのテストは何も見ていない）
    expect(text).toContain(NFD)

    const def = readTemplateDefinition(text, 'ためし.json')

    expect(def.fields[0]!.key).toBe(`${NFC}ぞう`)
    expect(def.outputs[0]).toMatchObject({ key: `${NFC}ぞう` })
    // ⭐ 本題: NFC で書かれたデータを、定義のキーで引けること
    const instance: TemplateInstance = {
      id: 'そざい1',
      templateId: def.id,
      data: { [`${NFC}ぞう`]: 'ほんぶん' },
      images: {},
    }
    expect(derivePartsOf(instance, def)[0]!.body).toEqual([{ kind: 'text', text: 'ほんぶん' }])
  })

  /**
   * 台帳 A39: `KEY_VALUED_PROPERTIES` は `key` と `source` の 2 つを持つが、
   * `outputs[].key` は上のテストで既に押さえている一方、`kind: 'perItem'` が使う
   * `outputs[].source` は 1 件も検査されていなかった（`new Set(['key'])` に落としても緑）。
   */
  it('NFD で書かれた perItem の source が、NFC のキーで引けるようになる（outputs[].source）', () => {
    const text = JSON.stringify({
      id: 'ため.し',
      name: 'ためし',
      version: '0.1.0',
      fields: [],
      outputs: [
        { kind: 'perItem', key: 'item', source: `${NFD}ぞう`, label: 'こうもく', form: 'section' },
      ],
    })
    expect(text).toContain(NFD)

    const def = readTemplateDefinition(text, 'ためし.json')
    expect(def.outputs[0]).toMatchObject({ source: `${NFC}ぞう` })

    // ⭐ 本題: NFC で書かれたデータ（配列）を、定義の source で引けること
    const instance: TemplateInstance = {
      id: 'そざい1',
      templateId: def.id,
      data: { [`${NFC}ぞう`]: [{ id: 'a1', name: 'いちばん', body: 'ほんぶん' }] },
      images: {},
    }
    const parts = derivePartsOf(instance, def)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.body).toEqual([{ kind: 'text', text: 'ほんぶん' }])
  })

  it('オブジェクトのキー自体も NFC へ揃う（入れ子も）', () => {
    const normalized = normalizeKeysToNfc({ [NFD]: { [`${NFD}の中`]: 1 } }) as Record<
      string,
      Record<string, number>
    >
    expect(Object.keys(normalized)).toEqual([NFC])
    expect(Object.keys(normalized[NFC]!)).toEqual([`${NFC}の中`])
  })

  it('既に NFC のキー・ASCII のキー・値は 1 文字も変わらない（既存の一致判定を壊さない）', () => {
    const before = { key: `${NFC}ぞう`, label: `${NFD}めん`, nested: [{ source: 'plain' }] }
    expect(normalizeKeysToNfc(before)).toEqual(before)
    // ⚠ 値（表示名）は触らない。触ると利用者が書いたとおりに出ない場所ができる
    expect((normalizeKeysToNfc(before) as { label: string }).label).toBe(`${NFD}めん`)
  })

  /**
   * ⭐ 入れ子のフィールド宣言（P2・`array` / `object` / `enum`）。
   * ⚠ 「無いと入力欄が作れないもの」を**テンプレを書いた人**に返す（使う人が空欄を掴まない）。
   */
  describe('入れ子のフィールド宣言（P2 完了条件 #2・#3 の前提）', () => {
    function defWith(fields: unknown): string {
      return JSON.stringify({
        id: 'ため.し',
        name: 'ためし',
        version: '0.1.0',
        fields,
        outputs: [{ pattern: IMAGE_PATTERN }],
      })
    }

    it('enum に choices が無いと、どこが悪いか分かるエラーになる', () => {
      const error = readAndFail(defWith([{ key: 'mood', type: 'enum' }]), 'ためし.json')
      expect(error.message).toContain('fields[0].choices')
      expect(error.message).toContain('選択肢')
    })

    it('array / object に fields が無いと、どこが悪いか分かるエラーになる', () => {
      const error = readAndFail(
        defWith([
          { key: 'rooms', type: 'array' },
          { key: 'overview', type: 'object' },
        ]),
        'ためし.json',
      )
      expect(error.problems).toHaveLength(2)
      expect(error.message).toContain('fields[0].fields')
      expect(error.message).toContain('fields[1].fields')
    })

    it('入れ子の中の誤りも「道順つき」で出る（どの段の話か分かる）', () => {
      const error = readAndFail(
        defWith([
          {
            key: 'rooms',
            type: 'array',
            fields: [{ key: 'name', type: '文字れつ' }],
          },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('fields[0].fields[0].type')
    })

    it('⭐ 配列の要素に id という名前は使えない（採番した識別子と衝突する・P0 知見 2）', () => {
      const error = readAndFail(
        defWith([{ key: 'rooms', type: 'array', fields: [{ key: 'id', type: 'string' }] }]),
        'ためし.json',
      )
      expect(error.message).toContain('fields[0].fields[0].key')
      expect(error.message).toContain('予約')
      // ⚠ 予約は**配列の要素**だけ。入れ子（object）の中の id は普通のキーとして許す
      const ok = readTemplateDefinition(
        defWith([{ key: 'overview', type: 'object', fields: [{ key: 'id', type: 'string' }] }]),
        'ためし.json',
      )
      expect(ok.fields[0]!.fields![0]!.key).toBe('id')
    })

    it('入れ子のキーも NFC へ揃う（§1-8-4 規約①の範囲は入れ子にも及ぶ）', () => {
      const def = readTemplateDefinition(
        defWith([
          { key: 'rooms', type: 'array', fields: [{ key: `${NFD}ぞう`, type: 'string' }] },
        ]),
        'ためし.json',
      )
      expect(def.fields[0]!.fields![0]!.key).toBe(`${NFC}ぞう`)
    })

    /**
     * ドメイン型の宣言（2026-08-24・フォームその2）。
     *
     * ⚠⚠ **黙って無視する道を作らない**のがここの主題。
     *   「宣言できるが効かない」は、書いた人には**書けたように見える**ので、
     *   使う人が原因不明の欄を掴むまで誰も気づかない（この検証の目的そのもの）。
     */
    it('⭐⭐ 合成型（座標・辺参照）に fields は書けない（型が中身を決めているので黙って無視しない）', () => {
      const error = readAndFail(
        defWith([{ key: 'at', type: 'coordinate', fields: [{ key: 'x', type: 'string' }] }]),
        'ためし.json',
      )
      expect(error.message).toContain('fields[0].fields')
      expect(error.message).toContain('型が決めています')

      // ⚠ 陽性対照: 書かなければ通る（弾きすぎていない）
      const ok = readTemplateDefinition(
        defWith([
          { key: 'at', type: 'coordinate' },
          { key: 'facing', type: 'direction' },
          { key: 'from', type: 'edgeRef' },
        ]),
        'ためし.json',
      )
      expect(ok.fields.map((f) => f.type)).toEqual(['coordinate', 'direction', 'edgeRef'])
    })

    it('⭐⭐ 画像の欄は入れ子・配列の中には置けない（実体のキーが 1 段しかないため・§1-4）', () => {
      // ⚠⚠ 黙って落とすと「選んだ画像が保存されない」になり、画面には何も出ない。
      const nested = readAndFail(
        defWith([{ key: 'rooms', type: 'array', fields: [{ key: 'photo', type: 'image' }] }]),
        'ためし.json',
      )
      expect(nested.message).toContain('fields[0].fields[0]')
      expect(nested.message).toContain('image')

      const inObject = readAndFail(
        defWith([{ key: 'overview', type: 'object', fields: [{ key: 'photo', type: 'image' }] }]),
        'ためし.json',
      )
      expect(inObject.message).toContain('fields[0].fields[0]')

      // ⚠ 陽性対照: いちばん外側なら通る（CoC の顔写真がこれ・§1-3-3 の B 群）
      const ok = readTemplateDefinition(defWith([{ key: 'photo', type: 'image' }]), 'ためし.json')
      expect(ok.fields[0]!.type).toBe('image')
    })

    /**
     * 判別子付き共用体の宣言（2026-08-24・C 群）。
     *
     * ⚠ 保存形は**フラットな併合**（`{[判別子]: 値, ...共有, ...枝}`）なので、
     *   キーが 1 つでも重なると**同じ入れ物に違う型が入る**。宣言の時点で弾く。
     */
    it('⭐ oneOf は判別子と枝が要る（無ければ、どこが悪いか分かるエラー）', () => {
      const error = readAndFail(defWith([{ key: 'trap', type: 'oneOf' }]), 'ためし.json')
      expect(error.message).toContain('fields[0].discriminator')
      expect(error.message).toContain('fields[0].variants')

      // ⚠ 陽性対照: 揃っていれば通る
      const ok = readTemplateDefinition(
        defWith([
          {
            key: 'trap',
            type: 'oneOf',
            discriminator: 'name',
            variants: [{ value: '坂道', fields: [{ key: 'higherEnd', type: 'coordinate' }] }],
          },
        ]),
        'ためし.json',
      )
      expect(ok.fields[0]!.variants![0]!.value).toBe('坂道')
    })

    it('⭐⭐ 判別子・共有・枝でキーが重なったら弾く（フラットに併合されるため）', () => {
      const error = readAndFail(
        defWith([
          {
            key: 'trap',
            type: 'oneOf',
            discriminator: 'name',
            fields: [{ key: 'target', type: 'string' }],
            variants: [
              { value: '坂道', fields: [{ key: 'target', type: 'ref' }] },
              { value: '幻の路' },
            ],
          },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('target')
      expect(error.message).toContain('重複')

      // 判別子と同じ名前のフィールドも弾く
      const clash = readAndFail(
        defWith([
          {
            key: 'trap',
            type: 'oneOf',
            discriminator: 'name',
            fields: [{ key: 'name', type: 'string' }],
            variants: [{ value: '坂道' }],
          },
        ]),
        'ためし.json',
      )
      expect(clash.message).toContain('name')
    })

    it('枝の値が重複していたら弾く（どちらの枝か決まらない）', () => {
      const error = readAndFail(
        defWith([
          {
            key: 'trap',
            type: 'oneOf',
            discriminator: 'name',
            variants: [{ value: '坂道' }, { value: '坂道' }],
          },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('variants[1].value')
      expect(error.message).toContain('重複')
    })

    it('⭐⭐ ref の枝は型が持っている（宣言したら弾く・合成型の fields と同じ線）', () => {
      const error = readAndFail(
        defWith([
          { key: 'target', type: 'ref', discriminator: 'kind', variants: [{ value: 'room' }] },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('fields[0].discriminator')
      expect(error.message).toContain('fields[0].variants')
      expect(error.message).toContain('型が決めています')

      // ⚠ 陽性対照: 何も宣言しなければ通る（枝は `domain.ts` が持っている）
      const ok = readTemplateDefinition(defWith([{ key: 'target', type: 'ref' }]), 'ためし.json')
      expect(ok.fields[0]!.type).toBe('ref')
    })

    it('⭐ 内部専用の指定（tuple / choiceLabels）は利用者の JSON では書けない', () => {
      // ⚠⚠ 黙って効かせると、保存形が型の契約から外れる経路が利用者側に開く。
      const error = readAndFail(
        defWith([
          { key: 'ends', type: 'coordinate', tuple: 2 },
          { key: 'mood', type: 'enum', choices: ['はれ'], choiceLabels: { はれ: '晴れ' } },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('fields[0].tuple')
      expect(error.message).toContain('fields[1].choiceLabels')
    })

    it('枝の中のフィールドも同じ検査を通る（image は枝の中にも置けない）', () => {
      const error = readAndFail(
        defWith([
          {
            key: 'trap',
            type: 'oneOf',
            discriminator: 'name',
            variants: [{ value: '坂道', fields: [{ key: 'photo', type: 'image' }] }],
          },
        ]),
        'ためし.json',
      )
      expect(error.message).toContain('variants[0].fields[0]')
      expect(error.message).toContain('image')
    })

    it('同梱の迷宮マップ定義は、この検証を通っている', () => {
      const def = readBundledTemplates().find((d) => d.id === 'builtin.dungeon-map')!
      const rooms = def.fields.find((f) => f.key === 'rooms')!
      expect(rooms.type).toBe('array')
      expect(rooms.fields!.map((f) => f.key)).toContain('traps')
      // ⚠ ドメイン型を実際に含んでいる（C 群まで入ったので、全 13 種のうち 11 種が同梱定義に在る）
      expect(rooms.fields!.map((f) => f.type)).toContain('coordinate')
    })
  })
})
