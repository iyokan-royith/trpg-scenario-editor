/**
 * テンプレのフォーム（DESIGN-v0.md §4 の P2 完了条件 #2・#3・#5・#6）を**画面の側から**通す。
 *
 * ⚠⚠ 純ロジックが緑でも、**入力欄が 1 つも出ていなければ何も入力できない**。
 *   ここは必ず「欄を探す → 打つ → 保存を押す」の側から触る。
 *
 * ⚠ 検証データは全て創作（同梱定義を読む 1 本を除く）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TemplateForm from '../TemplateForm.vue'
import type { FieldDef, TemplateDefinition } from '../../template/model'
import { bundledTemplates, readTemplateDefinition } from '../../template/loader'
import { FIELD_TYPE_LABELS } from '../../template/form'

/** ⚠ 配布されている当のテキスト（同梱一覧から引く）。手で書き写さない。 */
const dungeonMapText = bundledTemplates.find((t) => t.source.includes('dungeon-map'))!.text

const ITEM_FIELDS: FieldDef[] = [
  { key: 'name', type: 'string', label: 'なまえ' },
  { key: 'weight', type: 'integer', label: 'おもさ' },
]

/** 基本型 7 種を全部持つ定義。⚠ **loader を通す**（`{key,type}` を手で作らない）。 */
const ALL_BASIC = readTemplateDefinition(
  JSON.stringify({
    id: 'test.basic',
    name: 'ためしの型',
    version: '0.1.0',
    fields: [
      { key: 'title', type: 'string', label: '題' },
      { key: 'count', type: 'integer', label: '数' },
      { key: 'secret', type: 'boolean', label: '秘密' },
      { key: 'note', type: 'text', label: '覚え書き' },
      { key: 'mood', type: 'enum', label: '気分', choices: ['はれ', 'あめ'] },
      {
        key: 'nest',
        type: 'object',
        label: '入れ子',
        fields: [{ key: 'inner', type: 'string', label: '中身' }],
      },
      { key: 'items', type: 'array', label: 'もちもの', fields: ITEM_FIELDS },
    ],
    outputs: [{ kind: 'fixed', key: 'title', label: '題', form: 'section' }],
  }),
  'test.basic',
)

function mountForm(def: TemplateDefinition) {
  return mount(TemplateForm, { props: { def } })
}

/** 保存を押して、渡ってきた data を取り出す。 */
async function save(wrapper: ReturnType<typeof mountForm>): Promise<Record<string, unknown>> {
  await wrapper.find('form').trigger('submit')
  const events = wrapper.emitted('save')
  expect(events).toBeTruthy()
  return events![events!.length - 1]![0] as Record<string, unknown>
}

describe('基本型 7 種がすべて入力できる（完了条件 #2）', () => {
  it('7 種ぶんの入力欄が出て、打った値が保存される', async () => {
    const wrapper = mountForm(ALL_BASIC)

    await wrapper.find('.field--string input').setValue('まよいの森')
    await wrapper.find('.field--integer input').setValue('3')
    await wrapper.find('.field--boolean input').setValue(true)
    await wrapper.find('.field--text textarea').setValue('ここに長い文\nを書く')
    await wrapper.find('.field--enum select').setValue('あめ')
    // 入れ子（object）の中の欄
    await wrapper.find('.field--object .field--string input').setValue('おくのもの')
    // 配列（array）に 1 件足してから打つ
    await wrapper.find('.field--array .field__add').trigger('click')
    const itemInputs = wrapper.findAll('.field--array .field__item input')
    await itemInputs[0]!.setValue('なわばしご')
    await itemInputs[1]!.setValue('5')

    const data = await save(wrapper)
    expect(data.title).toBe('まよいの森')
    expect(data.count).toBe(3)
    expect(data.secret).toBe(true)
    expect(data.note).toBe('ここに長い文\nを書く')
    expect(data.mood).toBe('あめ')
    expect(data.nest).toEqual({ inner: 'おくのもの' })
    expect(data.items).toHaveLength(1)
    expect(data.items as unknown[]).toMatchObject([{ name: 'なわばしご', weight: 5 }])
  })

  it('enum は「選んでいません」から始まる（先頭の値が黙って入らない）', async () => {
    const wrapper = mountForm(ALL_BASIC)
    const select = wrapper.find('.field--enum select')
    expect((select.element as HTMLSelectElement).value).toBe('')
    const data = await save(wrapper)
    expect('mood' in data).toBe(false)
  })

  it('別のテンプレに切り替えると下書きが作り直される', async () => {
    const wrapper = mountForm(ALL_BASIC)
    await wrapper.find('.field--string input').setValue('のこるな')
    const other = readTemplateDefinition(
      JSON.stringify({
        id: 'test.other',
        name: 'べつの型',
        version: '0.1.0',
        fields: [{ key: 'title', type: 'string', label: '題' }],
        outputs: [{ kind: 'fixed', key: 'title', label: '題', form: 'section' }],
      }),
      'test.other',
    )
    await wrapper.setProps({ def: other })
    expect((wrapper.find('.field--string input').element as HTMLInputElement).value).toBe('')
  })
})

describe('配列の足し引きと入れ子（完了条件 #3・#5）', () => {
  it('要素を足す／消すことができ、件数が画面に出る', async () => {
    const wrapper = mountForm(ALL_BASIC)
    const add = wrapper.find('.field--array .field__add')
    await add.trigger('click')
    await add.trigger('click')
    expect(wrapper.findAll('.field--array .field__item')).toHaveLength(2)
    expect(wrapper.find('.field--array legend').text()).toContain('2 件')

    await wrapper.findAll('.field--array .field__itemHead button')[0]!.trigger('click')
    expect(wrapper.findAll('.field--array .field__item')).toHaveLength(1)
  })

  it('⭐ 真ん中を消しても、残った要素の id が変わらない（添字ではない・P0 知見 2）', async () => {
    const wrapper = mountForm(ALL_BASIC)
    const add = wrapper.find('.field--array .field__add')
    for (let i = 0; i < 3; i += 1) await add.trigger('click')

    const names = wrapper.findAll('.field--array .field__item .field--string input')
    await names[0]!.setValue('いち')
    await names[1]!.setValue('に')
    await names[2]!.setValue('さん')
    const before = (await save(wrapper)).items as { id: string; name: string }[]
    expect(before.map((i) => i.name)).toEqual(['いち', 'に', 'さん'])

    // 真ん中を消す
    await wrapper.findAll('.field--array .field__itemHead button')[1]!.trigger('click')
    const after = (await save(wrapper)).items as { id: string; name: string }[]

    expect(after.map((i) => i.name)).toEqual(['いち', 'さん'])
    // ⚠⚠ ここが本体。添字で採番していると `さん` の id が 1 つ前へずれ、
    //   本文に置かれた参照が**別のパートを指す**（＝配置が黙って壊れる）。
    expect(after[0]!.id).toBe(before[0]!.id)
    expect(after[1]!.id).toBe(before[2]!.id)
    expect(after.map((i) => i.id)).not.toContain(before[1]!.id)
  })

  it('入れ子の中の配列も編集できる（再帰が 2 段目で切れていない）', async () => {
    const def = readTemplateDefinition(
      JSON.stringify({
        id: 'test.deep',
        name: 'ふかい型',
        version: '0.1.0',
        fields: [
          {
            key: 'rooms',
            type: 'array',
            label: '部屋',
            fields: [
              { key: 'name', type: 'string', label: '名前' },
              {
                key: 'traps',
                type: 'array',
                label: 'トラップ',
                fields: [{ key: 'name', type: 'string', label: '名前' }],
              },
            ],
          },
        ],
        outputs: [{ kind: 'perItem', key: 'rooms', source: 'rooms', label: '部屋', form: 'section' }],
      }),
      'test.deep',
    )
    const wrapper = mountForm(def)
    await wrapper.find('.field--array .field__add').trigger('click')
    // 部屋の中のトラップを 1 件足す
    await wrapper.findAll('.field--array .field--array .field__add')[0]!.trigger('click')
    const inputs = wrapper.findAll('.field--array .field--array .field__item input')
    await inputs[0]!.setValue('おとしあな')

    const data = await save(wrapper)
    const rooms = data.rooms as { id: string; traps: { id: string; name: string }[] }[]
    expect(rooms[0]!.traps).toHaveLength(1)
    expect(rooms[0]!.traps[0]!.name).toBe('おとしあな')
    expect(rooms[0]!.traps[0]!.id).toBeTruthy()
  })
})

/**
 * 配列は要素が 0 件だと中身を描かないので、**各配列に 1 件ずつ足してから**見る。
 * ⚠ 2 周するのは入れ子の配列（`rooms[].traps`）が 1 周目には存在しないため。
 */
async function expandAllArrays(wrapper: ReturnType<typeof mountForm>) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const add of wrapper.findAll('.field__add')) await add.trigger('click')
  }
}

describe('未対応の型があってもフォームが開ける（完了条件 #6）', () => {
  it('⭐ 同梱の迷宮マップ定義（ドメイン型を 6 種含む）でフォームが出る', async () => {
    // ⚠ C 群（`oneOf` / `ref`）が入り、**未対応の欄は 1 つも残っていない**。
    //   ⚠⚠ 分岐そのものは残してある（新しい型が足されたときの受け皿）。
    // ⚠ 手で作った定義ではなく**配布されている当のもの**を読む。
    //   ここが落ちると、実機で「テンプレを選んだ瞬間に画面が真っ白」になる。
    const def = readTemplateDefinition(dungeonMapText, 'src/templates/dungeon-map.json')
    const wrapper = mountForm(def)
    expect(wrapper.find('form').exists()).toBe(true)
    // 入力できる欄（overview.name 等）は出ている
    expect(wrapper.findAll('.field--string input').length).toBeGreaterThan(0)

    await expandAllArrays(wrapper)
    expect(wrapper.findAll('.field__unsupported')).toHaveLength(0)
  })

  it('⭐ 同梱定義の欄に「まだ入力できません」は 1 つも出ない（C 群で未対応が空になった）', async () => {
    const def = readTemplateDefinition(dungeonMapText, 'src/templates/dungeon-map.json')
    const wrapper = mountForm(def)
    await expandAllArrays(wrapper)
    // ⚠⚠ 文字列そのもので見る（クラス名だけだと、文言を残したまま別のクラスへ移しても通る）
    expect(wrapper.text()).not.toContain('まだ入力できません')
    // ⚠ 内部の型名が画面に漏れていないこと（§1-8-2c）は、未対応が空になっても要る
    for (const internal of ['coordinate', 'edgeRef', 'oneOf', 'ref', 'derived'] as const) {
      expect(wrapper.text()).not.toContain(internal)
    }
    // 導出値だけは「尋ねない」と出ている（`FIELD_TYPE_LABELS` は日本語）
    expect(wrapper.text()).toContain(FIELD_TYPE_LABELS.derived)
  })

  /**
   * ⚠⚠ **この 1 本は「入力できないから無い」→「空だから無い」に意味が変わった。**
   *   旧版は `at` / `facing` が入力できない前提で `['id']` を期待していたが、
   *   4 種が入力できるようになった今も**空のままなら緑になる**（＝検査として死んでいる）。
   *   → 「打っていなければ書かれない」と「打てば書かれる」を**両方**置く。
   */
  it('⭐ 打っていないドメイン欄は保存されない（`ref` / `oneOf` も現れない）', async () => {
    const def = readTemplateDefinition(dungeonMapText, 'src/templates/dungeon-map.json')
    const wrapper = mountForm(def)
    await wrapper.find('.field--array .field__add').trigger('click') // entrances を 1 件
    const data = await save(wrapper)
    const entrances = data.entrances as Record<string, unknown>[]
    expect(entrances).toHaveLength(1)
    expect(Object.keys(entrances[0]!)).toEqual(['id'])
  })

  it('⭐ 打ったドメイン欄は構造のまま保存される（同梱定義の `entrances[]`）', async () => {
    const def = readTemplateDefinition(dungeonMapText, 'src/templates/dungeon-map.json')
    const wrapper = mountForm(def)
    const entrances = wrapper
      .findAll('.field--array')
      .find((f) => f.find('legend').text().startsWith('入口'))!
    await entrances.find('.field__add').trigger('click')

    // 位置（座標）＝行と列、向き（方向）
    await entrances.find('.field--coordinate .field--enum select').setValue('B')
    await entrances.find('.field--coordinate .field--integer input').setValue('3')
    await entrances.find('.field--direction select').setValue('右下')

    const data = await save(wrapper)
    const rows = data.entrances as Record<string, unknown>[]
    expect(rows[0]!.at).toEqual({ row: 'B', col: 3 })
    expect(rows[0]!.facing).toBe('右下')
  })
})

/**
 * ドメイン型 A 群・B 群の入力欄（§1-3-3）。
 *
 * ⚠⚠ 純ロジックが緑でも、**欄が出ていなければ何も入力できない**。
 *   ここは必ず「欄を探す → 打つ → 保存を押す」の側から触る。
 */
const DOMAIN_DEF = readTemplateDefinition(
  JSON.stringify({
    id: 'test.domain',
    name: 'ドメイン型',
    version: '0.1.0',
    fields: [
      { key: 'at', type: 'coordinate', label: '位置' },
      { key: 'facing', type: 'direction', label: '向き' },
      { key: 'from', type: 'edgeRef', label: '始点' },
      { key: 'photo', type: 'image', label: '顔写真' },
      { key: 'trapCount', type: 'derived', label: 'トラップ数' },
    ],
    outputs: [{ kind: 'fixed', key: 'facing', label: '向き', form: 'section' }],
  }),
  'test.domain',
)

/** 保存を押して、渡ってきた images を取り出す。⚠ `data` とは別の引数（§1-4）。 */
async function saveImages(
  wrapper: ReturnType<typeof mountForm>,
): Promise<Record<string, Blob>> {
  await wrapper.find('form').trigger('submit')
  const events = wrapper.emitted('save')!
  return events[events.length - 1]![1] as Record<string, Blob>
}

describe('ドメイン型 A 群が入力できる（§1-3-3）', () => {
  it('⭐ 座標は行（A〜Z の選択）と列（数）の 2 つを尋ねる', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const at = wrapper.find('.field--coordinate')
    expect(at.exists()).toBe(true)
    const rowOptions = at.findAll('.field--enum option').map((o) => o.text())
    // 「（選んでいません）」＋ A〜Z
    expect(rowOptions).toHaveLength(27)
    expect(rowOptions).toContain('A')
    expect(rowOptions).toContain('Z')

    await at.find('.field--enum select').setValue('C')
    await at.find('.field--integer input').setValue('4')
    expect((await save(wrapper)).at).toEqual({ row: 'C', col: 4 })
  })

  it('⭐ 方向は 8 つ（斜めを含む）。値は日本語＝読む側（サンプル）と同じ語彙', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const select = wrapper.find('.field--direction select')
    const options = select.findAll('option')
    expect(options).toHaveLength(9) // 「（選んでいません）」＋ 8 方向
    const labels = options.map((o) => o.text())
    expect(labels).toEqual(
      expect.arrayContaining(['上', '右上', '右', '右下', '下', '左下', '左', '左上']),
    )
    // ⚠⚠ 画面にも保存にも英語が出ない（§1-8-2c）。方向は識別子ではなく**値**である。
    for (const label of labels) expect(label).not.toMatch(/[a-zA-Z]/)

    await select.setValue('左上')
    expect((await save(wrapper)).facing).toBe('左上')
  })

  it('⭐⭐ 辺参照は座標＋方向の合成——独自の入力欄を持たない（`A2右下` に潰さない）', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const from = wrapper.find('.field--edgeRef')
    // ⚠ 中身は既存 2 型の欄そのもの（新しい概念を足していないことが画面からも見える）
    expect(from.find('.field--coordinate').exists()).toBe(true)
    expect(from.find('.field--direction').exists()).toBe(true)

    await from.find('.field--coordinate .field--enum select').setValue('A')
    await from.find('.field--coordinate .field--integer input').setValue('1')
    await from.find('.field--direction select').setValue('下')

    expect((await save(wrapper)).from).toEqual({ at: { row: 'A', col: 1 }, direction: '下' })
  })

  it('半分だけの座標は保存されず、理由が画面に出る（打った値は消えない）', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    await wrapper.find('.field--coordinate .field--enum select').setValue('C')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeFalsy()
    const errors = wrapper.find('.tform__errors')
    expect(errors.exists()).toBe(true)
    expect(errors.text()).toContain('行と列')
    // 打った行は残っている
    expect((wrapper.find('.field--coordinate .field--enum select').element as HTMLSelectElement).value).toBe('C')
  })
})

describe('ドメイン型 B 群（画像）が入力できる（§1-3-3）', () => {
  /** ⚠ jsdom の `<input type="file">` は代入できないので、`files` を差し込む。 */
  function chooseFile(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
  }

  it('⭐ フォームの中でファイルを選べ、実体は `data` ではなく images 側へ渡る（§1-4）', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const input = wrapper.find('.field--image input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(wrapper.find('.field--image').text()).toContain('画像を選んでいません')

    const file = new File([new Uint8Array([7, 7])], 'かお.png', { type: 'image/png' })
    chooseFile(input.element as HTMLInputElement, file)
    await wrapper.vm.$nextTick()
    // 選んだことが画面に出る（何も起きないと「押せていない」と区別が付かない）
    expect(wrapper.find('.field--image').text()).toContain('かお.png')

    await wrapper.find('form').trigger('submit')
    const events = wrapper.emitted('save')!
    const [data, images] = events[events.length - 1]! as [
      Record<string, unknown>,
      Record<string, Blob>,
    ]
    // ⚠⚠ data には**絶対に**入らない（Blob が md・zip・保存の全経路へ紛れ込む）
    expect('photo' in data).toBe(false)
    expect(images.photo).toBe(file)
  })

  it('選んだ画像を外せる（未選択に戻る）', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const input = wrapper.find('.field--image input[type="file"]')
    chooseFile(input.element as HTMLInputElement, new File(['x'], 'け.png', { type: 'image/png' }))
    await wrapper.vm.$nextTick()

    await wrapper.find('.field--image button').trigger('click')
    expect(wrapper.find('.field--image').text()).toContain('画像を選んでいません')
    expect(await saveImages(wrapper)).toEqual({})
  })

  it('⭐ 何も選ばなければ images は空（否定形の述語）', async () => {
    expect(await saveImages(mountForm(DOMAIN_DEF))).toEqual({})
  })
})

describe('⭐⭐ 導出値は尋ねない（§1-3-3）', () => {
  it('入力欄が出ず、「まだ」ではないと分かる文言が出る', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const derived = wrapper.find('.field__derived')
    expect(derived.exists()).toBe(true)
    expect(derived.text()).toContain('トラップ数') // label
    expect(derived.text()).toContain('自動で決まるので入力しません')
    // ⚠⚠ 「まだ」と言わない——待っていれば入力できるようになる、という嘘になる
    expect(derived.text()).not.toContain('まだ')
    // ⚠ 未対応型の枠にも入っていない（同じ文言・同じクラスに畳まない）
    expect(wrapper.find('.field--derived .field__unsupported').exists()).toBe(false)
    // ⚠ 内部の型名が漏れない（§1-8-2c）
    expect(derived.text()).not.toContain('derived')
    // 入力欄そのものが無い
    expect(wrapper.find('.field--derived input').exists()).toBe(false)
    expect(wrapper.find('.field--derived select').exists()).toBe(false)
  })

  it('導出値は保存されるデータに現れない（導出したものをデータ側に持たせない・P0 知見 1）', async () => {
    const wrapper = mountForm(DOMAIN_DEF)
    const data = await save(wrapper)
    expect('trapCount' in data).toBe(false)
  })
})

/**
 * 整数の検証を**画面の経路で**通す（§1-3-1 の決定 4）。
 *
 * ⚠⚠ 純ロジックが緑でも、**フォームが `validateDraft()` を呼んでいなければ素通りする**
 *   （実測: `.field--integer input` に `3.5` を打って保存すると `{ count: 3.5 }` が保存されていた）。
 */
describe('整数でない値は保存されない（§1-3-1 決定 4）', () => {
  it('⭐ 小数を打って保存を押すと、保存されず、理由が画面に出る', async () => {
    const wrapper = mountForm(ALL_BASIC)
    await wrapper.find('.field--integer input').setValue('3.5')
    await wrapper.find('form').trigger('submit')

    // ⚠⚠ 保存されない（黙って 3 に切り詰めるのでも、3.5 のまま通すのでもない）
    expect(wrapper.emitted('save')).toBeFalsy()
    const errors = wrapper.find('.tform__errors')
    expect(errors.exists()).toBe(true)
    expect(errors.text()).toContain('整数')
    expect(errors.text()).toContain('数') // label
    // フォームは開いたまま（打った値を失わせない）
    expect((wrapper.find('.field--integer input').element as HTMLInputElement).value).toBe('3.5')
  })

  it('整数へ直すと保存でき、知らせも消える（弾きっぱなしにならない）', async () => {
    const wrapper = mountForm(ALL_BASIC)
    await wrapper.find('.field--integer input').setValue('3.5')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('.tform__errors').exists()).toBe(true)

    await wrapper.find('.field--integer input').setValue('4')
    const data = await save(wrapper)
    expect(data.count).toBe(4)
    expect(wrapper.find('.tform__errors').exists()).toBe(false)
  })

  it('空欄は弾かない（未入力は誤りではない・`fieldRef.default` の経路を殺さない）', async () => {
    const wrapper = mountForm(ALL_BASIC)
    await wrapper.find('.field--integer input').setValue('')
    const data = await save(wrapper)
    expect('count' in data).toBe(false)
  })
})

/**
 * C 群: 判別子付き共用体（`oneOf`）と参照（`ref`）を**画面の側から**通す（§1-3-3c）。
 *
 * ⚠ ここでいちばん大事なのは「選択肢を選ぶと追加項目が出る」ことと、
 *   **枝を切り替えても前の枝の値が失われない**こと（§1-9-3a の逐一確認が不要である根拠）。
 */
const VARIANT_DEF = readTemplateDefinition(
  JSON.stringify({
    id: 'test.variant',
    name: '共用体',
    version: '0.1.0',
    fields: [
      {
        key: 'encounter',
        type: 'oneOf',
        label: '遭遇',
        fields: [{ key: 'kind', type: 'enum', label: '種別', choices: ['友好', '敵対'] }],
        discriminator: 'shape',
        variants: [
          {
            value: 'enemies',
            label: '敵の列挙',
            fields: [
              {
                key: 'enemies',
                type: 'array',
                label: '敵',
                fields: [{ key: 'name', type: 'string', label: '名前' }],
              },
            ],
          },
          {
            value: 'battlefield',
            label: '戦場',
            fields: [{ key: 'battlefield', type: 'string', label: '戦場' }],
          },
        ],
      },
      { key: 'target', type: 'ref', label: '対象' },
    ],
    outputs: [{ kind: 'fixed', key: 'target', label: '対象', form: 'section' }],
  }),
  'test.variant',
)

describe('判別子付き共用体が入力できる（§1-3-3 C 群）', () => {
  /**
   * その `oneOf` の「種類」（判別子）の select。
   * ⚠ 判別子は `visibleFieldsOf()` が**必ず先頭に置く**ので、最初の enum がこれ。
   *   共有フィールド（種別）は 2 つ目——取り違えると別の欄を打つので、ここで名前を付けておく。
   */
  function kindSelect(wrapper: ReturnType<typeof mountForm>, root = '.field--oneOf') {
    return wrapper.findAll(`${root} .field--enum select`)[0]!
  }

  it('⭐ 種類の選択肢は日本語で出て、保存される値は宣言どおり（`enemies`）', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    const labels = wrapper.findAll('.field--oneOf .field--enum option').map((o) => o.text())
    expect(labels).toContain('敵の列挙')
    expect(labels).toContain('戦場')
    // ⚠⚠ 画面に内部値が出ていない（§1-8-2c）
    expect(labels.join('')).not.toContain('enemies')

    await kindSelect(wrapper).setValue('enemies')
    const data = await save(wrapper)
    expect((data.encounter as Record<string, unknown>).shape).toBe('enemies')
  })

  it('⭐⭐ 種類を選ぶと、その枝の追加項目が出る（選ぶ前は出ていない）', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    // 選ぶ前: 枝の欄はどこにも無い
    expect(wrapper.find('.field--oneOf .field--array').exists()).toBe(false)

    await kindSelect(wrapper).setValue('enemies')
    expect(wrapper.find('.field--oneOf .field--array').exists()).toBe(true)

    // 別の枝へ切り替えると、前の枝の欄は消えて新しい枝の欄が出る
    await kindSelect(wrapper).setValue('battlefield')
    expect(wrapper.find('.field--oneOf .field--array').exists()).toBe(false)
    expect(wrapper.findAll('.field--oneOf .field--string').length).toBeGreaterThan(0)
  })

  it('⭐⭐ 枝を切り替えて戻すと、前に打った値が戻る（切り替えは破壊操作ではない）', async () => {
    // ⚠⚠ これが「§1-9-3a の逐一確認は要らない」と判断した根拠そのもの。
    //   ここが赤くなったら、切り替えは**下書きが失われる操作**なので確認を出す側へ回る。
    const wrapper = mountForm(VARIANT_DEF)
    await kindSelect(wrapper).setValue('enemies')
    await wrapper.find('.field--oneOf .field--array .field__add').trigger('click')
    await wrapper.find('.field--oneOf .field--array .field--string input').setValue('スライム')

    await kindSelect(wrapper).setValue('battlefield')
    await kindSelect(wrapper).setValue('enemies')

    const input = wrapper.find('.field--oneOf .field--array .field--string input')
    expect((input.element as HTMLInputElement).value).toBe('スライム')
  })

  it('⭐ 保存されるのは選ばれた枝だけ（隠れた枝の値は保存されない）', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    await kindSelect(wrapper).setValue('enemies')
    await wrapper.find('.field--oneOf .field--array .field__add').trigger('click')
    await wrapper.find('.field--oneOf .field--array .field--string input').setValue('スライム')
    await kindSelect(wrapper).setValue('battlefield')

    const encounter = (await save(wrapper)).encounter as Record<string, unknown>
    expect(encounter.shape).toBe('battlefield')
    // ⚠⚠ 打ったのに保存されない、が**意図した挙動**（判別子が値を定義する）
    expect('enemies' in encounter).toBe(false)
  })

  it('共有フィールド（種別）はどちらの枝でも出る', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    const shared = () => wrapper.findAll('.field--oneOf .field--enum')[1]!
    expect(shared().text()).toContain('種別')
    await kindSelect(wrapper).setValue('battlefield')
    expect(shared().text()).toContain('種別')
  })

  it('⭐ `ref` は種類を選ぶと座標の欄が出る（通路は座標が 2 つ）', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    const select = wrapper.find('.field--ref .field--enum select')
    await select.setValue('room')
    expect(wrapper.findAll('.field--ref .field--coordinate')).toHaveLength(1)
    expect(wrapper.find('.field--ref .field--tuple').exists()).toBe(false)

    await select.setValue('corridor')
    // ⚠ 固定長（`ends`）。⚠⚠ 「足す」ボタンは出さない（並びに意味がある）
    expect(wrapper.find('.field--ref .field--tuple').exists()).toBe(true)
    expect(wrapper.findAll('.field--ref .field--tuple .field--coordinate')).toHaveLength(2)
    expect(wrapper.find('.field--ref .field__add').exists()).toBe(false)

    const coordinates = wrapper.findAll('.field--ref .field--tuple .field--coordinate')
    await coordinates[0]!.find('.field--enum select').setValue('A')
    await coordinates[0]!.find('.field--integer input').setValue('2')
    await coordinates[1]!.find('.field--enum select').setValue('B')
    await coordinates[1]!.find('.field--integer input').setValue('3')

    expect((await save(wrapper)).target).toEqual({
      kind: 'corridor',
      ends: [
        { row: 'A', col: 2 },
        { row: 'B', col: 3 },
      ],
    })
  })

  it('片端だけの通路は保存されず、理由が画面に出る', async () => {
    const wrapper = mountForm(VARIANT_DEF)
    await wrapper.find('.field--ref .field--enum select').setValue('corridor')
    const first = wrapper.findAll('.field--ref .field--tuple .field--coordinate')[0]!
    await first.find('.field--enum select').setValue('A')
    await first.find('.field--integer input').setValue('2')

    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeFalsy()
    expect(wrapper.find('.tform__errors').text()).toContain('2 つとも')
  })
})
