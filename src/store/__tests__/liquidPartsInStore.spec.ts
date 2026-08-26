/**
 * ⭐⭐ **liquid の出力が画面のデータフローに載っていること**（DESIGN-v0.md §1-13-1e/1f・移行 P-d1）。
 *
 * P-a/P-b の時点で `deriveLiquidPartsOf` は完成していたが、**呼び出し元が 0 件**で
 * アプリからは一切見えなかった。ここが繋がったことの述語がこのファイル。
 *
 * ⚠⚠ **確かめたい性質は「同期と非同期が両立していること」の 1 点**である:
 *   ① 同期のパートは liquid を待たずに出る
 *   ② liquid のパートは遅れて合流する
 *   ③ **描画中・エラー中でも、直前に成功した結果は消えない**（§1-13-1f 決定1）
 *   ④ エラーは握りつぶさず、**liquidjs の文面のまま**外へ出る（§1-13-1c）
 *   ⑤ 追い越された描画の結果で新しい結果を上書きしない
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { Liquid } from 'liquidjs'
import { usePartStore } from '../partStore'
import { markdownLiquidEngine } from '../../template/liquid/engine'
import { readMayoiParkSample } from '../../samples'
import {
  inlineText,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../../template/model'

/** テンプレ文字列を評価する代わりに、こちらが握った Promise を返す偽エンジン。 */
function engineOf(render: () => Promise<string>): Liquid {
  return { parseAndRender: () => render() } as unknown as Liquid
}

interface Gate {
  promise: Promise<string>
  resolve: (value: string) => void
}

/** 解決の瞬間をテストが決められる Promise（＝「描画の途中」を実際に作るための道具）。 */
function gateOf(): Gate {
  let resolve!: (value: string) => void
  const promise = new Promise<string>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function defOf(template: string): TemplateDefinition {
  return {
    id: 'test.liquid',
    name: 'ためし',
    version: '0.1.0',
    fields: [],
    outputs: [],
    liquidOutputs: [{ kind: 'liquid', key: 'sheet', label: 'シート', form: 'section', template }],
  }
}

function instanceOf(data: Record<string, unknown>): TemplateInstance {
  return { id: 'i1', templateId: 'test.liquid', data, images: {} }
}

/** パートの中身を 1 本の文字列へ（照合用）。 */
function bodiesOf(parts: Part[]): string {
  return parts.map((p) => inlineText(p.body)).join('\n---\n')
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('同期経路と liquid 経路が合流する（P-d1 の合格条件）', () => {
  it('⭐ 同梱の迷宮マップ＋サンプルで、liquid のパートが遅れて増える', async () => {
    const store = usePartStore()
    store.registerBundledTemplates()
    store.upsertInstance(readMayoiParkSample())

    // ① 同期のパートは liquid を待たない。この時点で liquid はまだ 1 件も来ていない。
    expect(store.parts).toHaveLength(11)
    expect(store.liquidParts).toHaveLength(0)

    await flushPromises()

    // ② 部屋 9 室ぶんの liquid パートが後から合流する（同梱テンプレのたたき台）。
    expect(store.liquidParts).toHaveLength(9)
    expect(store.parts).toHaveLength(20)
    expect(store.liquidStatus).toBe('ready')
    expect(store.liquidFailures).toEqual([])

    // ⚠ 中身まで見る（件数だけだと「空文字が 9 件」でも通ってしまう）。
    const sheet = store.liquidParts[0]!
    expect(sheet.partId).toBe('roomSheet:room-1')
    expect(inlineText(sheet.body)).toContain('# C3: 入場ゲート')

    // ⚠ 反証: 同期経路のパートは 1 件も入れ替わっていない（並存が壊れていない）。
    expect(store.findPart('sample-mayoi-park', 'overview')).toBeDefined()
    expect(store.findPart('sample-mayoi-park', 'rooms:room-1')).toBeDefined()
    // ⭐ liquid のパートも `findPart` から引ける＝本文へ置いた参照が解決できる。
    expect(store.findPart('sample-mayoi-park', 'roomSheet:room-1')).toBeDefined()
  })

  it('エンジンは md 側を明示的に選んでいる（`outputEscape` が掛からない）', () => {
    const store = usePartStore()
    expect(store.liquidEngine).toBe(markdownLiquidEngine)
  })
})

describe('⭐⭐ 描画中でも本文を空にしない（§1-13-1f 決定1）', () => {
  it('次の描画が終わるまで、直前に成功した結果が出続ける', async () => {
    const store = usePartStore()
    store.liquidEngine = engineOf(() => Promise.resolve('さいしょ'))
    store.registerDefinition(defOf('{{ name }}'))
    store.upsertInstance(instanceOf({ name: 'ろうか' }))
    await flushPromises()
    expect(bodiesOf(store.parts)).toContain('さいしょ')

    // 2 回目の描画を「終わらせない」状態にして、その最中を観測する。
    const gate = gateOf()
    store.liquidEngine = engineOf(() => gate.promise)
    store.upsertInstance(instanceOf({ name: 'ひろま' }))
    await flushPromises()

    expect(store.liquidStatus).toBe('rendering')
    // ⚠⚠ ここが決定そのもの。描画を始めた時点で捨てると、ロイスが止めた
    //   「あ！消えちゃった！」が本文で起きる。
    expect(store.liquidParts).toHaveLength(1)
    expect(bodiesOf(store.parts)).toContain('さいしょ')

    gate.resolve('つぎ')
    await flushPromises()
    expect(store.liquidStatus).toBe('ready')
    expect(bodiesOf(store.parts)).toContain('つぎ')
    expect(bodiesOf(store.parts)).not.toContain('さいしょ')
  })

  it('⚠ 追い越された描画の結果で、新しい結果を上書きしない', async () => {
    const store = usePartStore()
    const slow = gateOf()
    store.liquidEngine = engineOf(() => slow.promise)
    store.registerDefinition(defOf('{{ name }}'))
    store.upsertInstance(instanceOf({ name: 'ふるい' }))
    await flushPromises()

    store.liquidEngine = engineOf(() => Promise.resolve('あたらしい'))
    store.upsertInstance(instanceOf({ name: 'あたらしい' }))
    await flushPromises()
    expect(bodiesOf(store.parts)).toContain('あたらしい')

    // 遅れて着地した古い描画。ここで巻き戻ったら、利用者から見ると
    // 「直したはずの内容が勝手に戻る」という無音の壊れ方になる。
    slow.resolve('ふるい')
    await flushPromises()
    expect(bodiesOf(store.parts)).toContain('あたらしい')
    expect(bodiesOf(store.parts)).not.toContain('ふるい')
  })
})

describe('⭐⭐ エラーは握りつぶさない（§1-13-1c のロイス決定）', () => {
  it('壊れたテンプレは liquidjs の文面のまま `liquidFailures` に出る', async () => {
    const store = usePartStore()
    store.registerDefinition(defOf('{{ name }}'))
    store.upsertInstance(instanceOf({ name: 'ろうか' }))
    await flushPromises()
    expect(store.liquidStatus).toBe('ready')

    // テンプレ作者が未定義の変数を書いた（strictVariables なので黙って空文字にならない）。
    store.registerDefinition(defOf('{{ nope }}'))
    await flushPromises()

    expect(store.liquidStatus).toBe('error')
    expect(store.liquidFailures).toHaveLength(1)
    const failure = store.liquidFailures[0]!
    expect(failure.instanceId).toBe('i1')
    expect(failure.templateId).toBe('test.liquid')
    // ⚠⚠ **文面をラップも和訳もしない**ことが述語である（決定「特に日本語化とかする必要はないです」）。
    //   行・列が付いていることまで見る——ここが消えると作者は現物へ辿り着けない。
    expect(failure.message).toBe('undefined variable: nope, line:1, col:4')
    expect(failure.context).toContain('^')

    // ⚠ エラー中も直前に成功した結果は消えない（決定1 はエラー側にも効く）。
    expect(bodiesOf(store.parts)).toContain('ろうか')
  })

  it('壊れた素材 1 つで、他の素材の liquid パートまで消えない', async () => {
    const store = usePartStore()
    store.registerDefinition(defOf('{{ nope }}'))
    store.registerDefinition({ ...defOf('{{ name }}'), id: 'test.ok' })
    store.upsertInstance(instanceOf({ name: 'こわれる' }))
    store.upsertInstance({ id: 'i2', templateId: 'test.ok', data: { name: 'ぶじ' }, images: {} })
    await flushPromises()

    expect(store.liquidFailures).toHaveLength(1)
    expect(store.liquidFailures[0]!.instanceId).toBe('i1')
    // ⚠ `deriveLiquidPartsOf` は 1 件目の例外で throw するので、素材ごとに分けて呼ばないとここが 0 になる。
    expect(bodiesOf(store.parts)).toContain('ぶじ')
  })

  it('エラーが直ってから描き直すと、状態も件数も戻る', async () => {
    const store = usePartStore()
    store.registerDefinition(defOf('{{ nope }}'))
    store.upsertInstance(instanceOf({ name: 'ろうか' }))
    await flushPromises()
    expect(store.liquidStatus).toBe('error')
    expect(store.liquidParts).toHaveLength(0)

    store.registerDefinition(defOf('なおった {{ name }}'))
    await flushPromises()
    expect(store.liquidStatus).toBe('ready')
    expect(store.liquidFailures).toEqual([])
    expect(bodiesOf(store.parts)).toContain('なおった ろうか')
  })
})
