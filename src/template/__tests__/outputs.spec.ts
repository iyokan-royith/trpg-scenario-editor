/**
 * `outputs` の評価器（DESIGN-v0.md 1-6-2 の文法）の単体テスト。
 *
 * ⚠ 検証データは全て創作（`spike/sample/` の語彙は持ち込まない）。
 *   実データでの検算は `render/__tests__/dungeonMap.spec.ts` が担う。
 */
import { describe, it, expect } from 'vitest'
import { evaluateOutputs, type OutputNode } from '../outputs'
import { inlineText, type Part, type TemplateInstance } from '../model'

/** 「1 個だけ生まれる」ことも同時に主張する取り出し（`undefined` を素通りさせない）。 */
function onlyPart(parts: Part[]): Part {
  expect(parts).toHaveLength(1)
  return parts[0] as Part
}

function instanceOf(data: Record<string, unknown>, images: Record<string, Blob> = {}) {
  return { id: 'i1', templateId: 't1', data, images } satisfies TemplateInstance
}

describe('part（S4 の 3 形態）', () => {
  it('blockPart は form: section で、key がそのまま partId になる', () => {
    const nodes: OutputNode[] = [
      { node: 'blockPart', key: 'summary', title: [{ node: 'text', text: 'まとめ' }], body: [] },
    ]
    expect(evaluateOutputs(nodes, instanceOf({}))).toEqual([
      { instanceId: 'i1', partId: 'summary', form: 'section', title: 'まとめ', body: [] },
    ])
  })

  it('inlinePart は form: inline で、title を持たない', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'note', body: [{ node: 'text', text: 'ひとこと' }] },
    ]
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({})))
    expect(part.form).toBe('inline')
    expect(part.title).toBe('')
    expect(inlineText(part.body)).toBe('ひとこと')
  })

  it('figurePart は「宣言だけ」でもパートとして生まれる（S8-2・描画は P4）', () => {
    const nodes: OutputNode[] = [
      {
        node: 'figurePart',
        key: 'plan',
        title: [{ node: 'text', text: 'みとりず' }],
        renderer: 'grid',
      },
    ]
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({})))
    expect(part.form).toBe('figure')
    expect(part.title).toBe('みとりず')
    // ⚠ 数に入ることが本質。中身は P4 まで置き換わらない。
    expect(inlineText(part.body)).toContain('描画されません')
  })
})

describe('repeat — 件数がデータで決まる', () => {
  const nodes: OutputNode[] = [
    {
      node: 'repeat',
      key: 'boxes',
      over: 'boxes',
      body: {
        node: 'blockPart',
        key: 'boxes',
        title: [{ node: 'fieldRef', path: 'label' }],
        body: [[{ node: 'fieldRef', path: 'memo' }]],
      },
    },
  ]

  it('配列の要素数だけ生まれ、partId は key:要素id になる', () => {
    const parts = evaluateOutputs(
      nodes,
      instanceOf({
        boxes: [
          { id: 'a', label: 'あか', memo: 'ひとつめ' },
          { id: 'b', label: 'あお', memo: 'ふたつめ' },
        ],
      }),
    )
    expect(parts.map((p) => p.partId)).toEqual(['boxes:a', 'boxes:b'])
    expect(parts.map((p) => p.title)).toEqual(['あか', 'あお'])
    expect(parts.map((p) => inlineText(p.body))).toEqual(['ひとつめ', 'ふたつめ'])
  })

  it('要素を消しても、残った要素の partId は動かない（添字ではなく id で作る）', () => {
    const before = evaluateOutputs(
      nodes,
      instanceOf({
        boxes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      }),
    )
    const after = evaluateOutputs(nodes, instanceOf({ boxes: [{ id: 'b' }, { id: 'c' }] }))
    expect(before.map((p) => p.partId)).toEqual(['boxes:a', 'boxes:b', 'boxes:c'])
    expect(after.map((p) => p.partId)).toEqual(['boxes:b', 'boxes:c'])
  })

  it('配列が無い・配列でないときは 0 個（黙って壊れた値を数えない）', () => {
    expect(evaluateOutputs(nodes, instanceOf({}))).toHaveLength(0)
    expect(evaluateOutputs(nodes, instanceOf({ boxes: 'はいれつではない' }))).toHaveLength(0)
  })
})

describe('inline — field-ref / image-ref / inline-repeat', () => {
  it('field-ref はドット区切りで入れ子を辿る', () => {
    const nodes: OutputNode[] = [
      {
        node: 'inlinePart',
        key: 'p',
        body: [{ node: 'fieldRef', path: 'outer.inner.value' }],
      },
    ]
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({ outer: { inner: { value: 42 } } })))
    expect(inlineText(part.body)).toBe('42')
  })

  it('field-ref が途中で切れても落ちず、空文字になる', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'a.b.c' }] },
    ]
    expect(inlineText(onlyPart(evaluateOutputs(nodes, instanceOf({}))).body)).toBe('')
  })

  it('field-ref が座標を指すと「行-列」で出る（型で決まる表示）', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'spot' }] },
    ]
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({ spot: { row: 'D', col: 7 } })))
    expect(inlineText(part.body)).toBe('D-7')
  })

  it('image-ref は Blob をそのまま body に載せる（文字列に焼かない）', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'imageRef', key: 'pic', alt: 'えだ' }] },
    ]
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({}, { pic: blob })))
    expect(part.body).toEqual([{ kind: 'image', image: blob, alt: 'えだ' }])
  })

  it('image-ref の実体が無いときは、何が無いかを本文に出す（黙って消さない）', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'imageRef', key: 'pic', alt: 'えだ' }] },
    ]
    expect(inlineText(onlyPart(evaluateOutputs(nodes, instanceOf({}))).body)).toBe(
      'えだ（画像が設定されていません）',
    )
  })

  it('inline-repeat は配列を順序どおりに畳み、区切りを挟む（S7-4）', () => {
    const nodes: OutputNode[] = [
      {
        node: 'inlinePart',
        key: 'p',
        body: [
          {
            node: 'inlineRepeat',
            over: 'items',
            separator: '、',
            body: [{ node: 'fieldRef', path: 'name' }],
          },
        ],
      },
    ]
    const part = onlyPart(
      evaluateOutputs(
        nodes,
        instanceOf({ items: [{ name: 'いち' }, { name: 'に' }, { name: 'さん' }] }),
      ),
    )
    // ⚠ 順序は yaml の並びがそのまま出る（パートを生む配列との違い）。
    expect(inlineText(part.body)).toBe('いち、に、さん')
  })

  it('inline-repeat の対象が無いときは何も出ない', () => {
    const nodes: OutputNode[] = [
      {
        node: 'inlinePart',
        key: 'p',
        body: [{ node: 'inlineRepeat', over: 'items', separator: '、', body: [] }],
      },
    ]
    expect(onlyPart(evaluateOutputs(nodes, instanceOf({}))).body).toEqual([])
  })
})

describe('field-ref の default（フィールドが無いときの既定値・DESIGN 1-6-10）', () => {
  it('パスが解決できないときだけ default を使う', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'missing', default: 'きめうち' }] },
    ]
    expect(inlineText(onlyPart(evaluateOutputs(nodes, instanceOf({}))).body)).toBe('きめうち')
  })

  it('値が実在するときは default を無視する', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'v', default: 'つかわれない' }] },
    ]
    expect(inlineText(onlyPart(evaluateOutputs(nodes, instanceOf({ v: 'ほんもの' }))).body)).toBe('ほんもの')
  })

  it('⚠ default はデータに書き込まれない（宣言側だけの値）', () => {
    const data = instanceOf({})
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'missing', default: 0 }] },
    ]
    evaluateOutputs(nodes, data)
    expect(data.data).toEqual({})
  })
})

describe('derived（1-3 の 4 点セット）と roomStats（1-6-10）', () => {
  it('useDisplayed が真なら displayed を、偽なら computed を出す', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'v' }] },
    ]
    const displayed = evaluateOutputs(
      nodes,
      instanceOf({ v: { computed: 1, displayed: 9, useDisplayed: true } }),
    )
    const computed = evaluateOutputs(
      nodes,
      instanceOf({ v: { computed: 1, displayed: 9, useDisplayed: false } }),
    )
    expect(inlineText(displayed[0]!.body)).toBe('9')
    expect(inlineText(computed[0]!.body)).toBe('1')
  })

  it('v0 では computed が null（未計算）なので、useDisplayed が偽だと空文字になる', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'v' }] },
    ]
    const part = onlyPart(
      evaluateOutputs(nodes, instanceOf({ v: { computed: null, displayed: 9, useDisplayed: false } })),
    )
    expect(inlineText(part.body)).toBe('')
  })

  it('⚠⚠ reason は本文に出さない（偽装トラップの「見分けが付かないこと」自体が効果のため）', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'v' }] },
    ]
    const part = onlyPart(
      evaluateOutputs(
        nodes,
        instanceOf({ v: { computed: null, displayed: 0, useDisplayed: true, reason: '偽装の理由' } }),
      ),
    )
    expect(inlineText(part.body)).toBe('0')
    expect(inlineText(part.body)).not.toContain('偽装の理由')
  })

  it('roomStats は「トラップ数 X／エネミー数 Y」の1行にまとまる', () => {
    const nodes: OutputNode[] = [
      { node: 'inlinePart', key: 'p', body: [{ node: 'fieldRef', path: 'roomStats' }] },
    ]
    const part = onlyPart(
      evaluateOutputs(
        nodes,
        instanceOf({
          roomStats: {
            trapCount: { computed: null, displayed: 3, useDisplayed: true },
            enemyCount: { computed: null, displayed: 5, useDisplayed: true },
          },
        }),
      ),
    )
    expect(inlineText(part.body)).toBe('トラップ数 3／エネミー数 5')
  })

  it('⭐⭐ roomStats を持たないフィールドに default（NO_ROOM_STATS 相当）を渡すと T0/E0 になる', () => {
    const nodes: OutputNode[] = [
      {
        node: 'inlinePart',
        key: 'p',
        body: [
          {
            node: 'fieldRef',
            path: 'roomStats',
            default: {
              trapCount: { computed: null, displayed: 0, useDisplayed: true },
              enemyCount: { computed: null, displayed: 0, useDisplayed: true },
            },
          },
        ],
      },
    ]
    // ⚠ 変異確認: この default を外すと `formatValue(undefined)` → `''` になり、
    //   本テストは「トラップ数 ／エネミー数 」ではなく空文字を見て落ちるはず（＝検査が当たっている証拠）。
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({})))
    expect(inlineText(part.body)).toBe('トラップ数 0／エネミー数 0')
  })
})

describe('blockPart の段落', () => {
  const nodes: OutputNode[] = [
    {
      node: 'blockPart',
      key: 'p',
      title: [{ node: 'text', text: 'みだし' }],
      body: [[{ node: 'fieldRef', path: 'first' }], [{ node: 'fieldRef', path: 'second' }]],
    },
  ]

  it('段落は改行で繋がる', () => {
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({ first: 'いち', second: 'に' })))
    expect(inlineText(part.body)).toBe('いち\nに')
  })

  it('空になった段落は落ちる（省略可フィールドの跡が空行にならない）', () => {
    const part = onlyPart(evaluateOutputs(nodes, instanceOf({ second: 'に' })))
    expect(inlineText(part.body)).toBe('に')
  })
})
