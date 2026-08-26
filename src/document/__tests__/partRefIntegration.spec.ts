/**
 * P0: 技術検証（DESIGN-v0.md §P0）＋ P2: その検証を **inline 版 partRef へそのまま当てる**。
 *
 * 確かめる断言（これが破れたら「ブロック配列＋パート参照」の設計そのものが破れる）:
 *   1. 1 インスタンスから N 個のパートが生まれる（配列の件数だけ増える）
 *   2. 同じパートを 2 箇所に置いても、データを直せば両方が追従する
 *   3. データから要素が消えたら、置かれた参照を「行方不明」として検出できる
 *   4. ドキュメントの走査だけで「未配置 N 件」が数えられる
 *   5. 参照ノードを別の位置へ移しても attrs（紐付け）が保たれる
 *
 * ⚠⚠ **同じ本文を 2 通りの参照ノードで回す**（DESIGN 1-6-3 の `要検証`）。
 *   P0 が実証したのは block 版だけで、inline 版（段落の中に置ける版）は未実証だった。
 *   ⭐ **テストを書き写さずに同じ関数を 2 回回す**のが要点——
 *     写すと、写した側だけがこっそり緩い断言になっていても誰も気づけない。
 *
 * ⚠ inline 版の配置は **文の途中** と **空の段落に単独** の両方を含む（完了条件 #2）。
 *
 * ⚠ 検証データは全て創作。実素材の語彙は 1 語も持ち込まない。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  PartRef,
  PartRefInline,
  PART_REF_NODE,
  PART_REF_INLINE_NODE,
  collectPlacedRefs,
} from '../partRefExtension'
import { usePartStore } from '../../store/partStore'
import { analyzePlacement } from '../placement'
import type { TemplateDefinition, TemplateInstance } from '../../template/model'

const definition: TemplateDefinition = {
  id: 'みほん',
  name: 'みほんテンプレ',
  version: '0.1.0',
  fields: [],
  outputs: [
    { key: 'まえがき', kind: 'fixed', label: '全体の説明', form: 'section' },
    { key: '区画', kind: 'perItem', over: '区画', label: '区画', form: 'section' },
    { key: 'ぜんたいず', kind: 'fixed', label: '全体図', form: 'figure' },
  ],
}

function makeInstance(): TemplateInstance {
  return {
    id: 'i1',
    templateId: 'みほん',
    images: {},
    data: {
      まえがき: 'まえがきの本文',
      ぜんたいず: 'ずの本文',
      区画: [
        { id: 'k1', name: 'カステラ', body: 'カステラの説明' },
        { id: 'k2', name: 'どらやき', body: 'どらやきの説明' },
        { id: 'k3', name: 'もなか', body: 'もなかの説明' },
      ],
    },
  }
}

/** EditorContent を含む最小のラッパ。NodeView は Vue コンポーネントとして描画される。 */
const Host = defineComponent({
  props: { editor: { type: Object, required: true } },
  setup(props) {
    return () => h(EditorContent, { editor: props.editor as Editor })
  },
})

/** strict な index アクセスを毎回書かないための小道具（テスト内でのみ使う）。 */
function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} が見つかりません`)
  return value
}

interface variant {
  label: string
  nodeName: string
  /** 「参照を 2 箇所に置いた本文」。両版で **同じ地の文**を持つ */
  body: () => object
  /** 末尾に 1 個足すときの挿入位置（inline はブロックの直下に置けない） */
  endPos: (doc: PMNode) => number
}

function makeRef(nodeName: string, instanceId: string, partId: string) {
  return { type: nodeName, attrs: { instanceId, partId } }
}

function textNode(text: string) {
  return { type: 'text', text }
}

const variants: variant[] = [
  {
    label: 'block 版（P0 で実証済み）',
    nodeName: PART_REF_NODE,
    body: () => ({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [textNode('手書きの前段')] },
        makeRef(PART_REF_NODE, 'i1', '区画:k2'),
        { type: 'paragraph', content: [textNode('手書きの間の文章')] },
        makeRef(PART_REF_NODE, 'i1', '区画:k2'), // S7-3: 同じパートを 2 箇所に置く
        { type: 'paragraph', content: [textNode('手書きの後段')] },
      ],
    }),
    endPos: (doc) => doc.content.size,
  },
  {
    label: 'inline 版（P2 で初めて当てる）',
    nodeName: PART_REF_INLINE_NODE,
    body: () => ({
      type: 'doc',
      content: [
        // ⭐ 完了条件 #2 その 1: **文の途中**
        {
          type: 'paragraph',
          content: [
            textNode('手書きの前段'),
            makeRef(PART_REF_INLINE_NODE, 'i1', '区画:k2'),
            textNode('のつづき'),
          ],
        },
        { type: 'paragraph', content: [textNode('手書きの間の文章')] },
        // ⭐ 完了条件 #2 その 2: **単独の段落**（1-7-3 が「ブロックの素材」を表す形と決めたもの）
        { type: 'paragraph', content: [makeRef(PART_REF_INLINE_NODE, 'i1', '区画:k2')] },
        { type: 'paragraph', content: [textNode('手書きの後段')] },
      ],
    }),
    // ⚠ inline ノードは doc の直下に入れない。末尾の段落の**中**へ挿す。
    endPos: (doc) => doc.content.size - 1,
  },
]

describe.each(variants)('$label', (variant) => {
  let pinia: Pinia
  let editor: Editor
  let wrapper: VueWrapper

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    const store = usePartStore()
    store.registerDefinition(definition)
    store.upsertInstance(makeInstance())

    editor = new Editor({
      extensions: [Document, Paragraph, Text, PartRef, PartRefInline],
      content: variant.body(),
    })
    wrapper = mount(Host, { props: { editor }, global: { plugins: [pinia] } })
  })

  afterEach(() => {
    wrapper?.unmount()
    editor?.destroy()
  })

  describe('P0-1: 1 インスタンスから N 個のパートが生まれる', () => {
    it('固定 2 個 ＋ 配列 3 件 = 5 パート', () => {
      const store = usePartStore()
      expect(store.parts).toHaveLength(5)
      expect(store.parts.map((p) => p.partId)).toEqual([
        'まえがき',
        '区画:k1',
        '区画:k2',
        '区画:k3',
        'ぜんたいず',
      ])
    })

    it('配列に 1 件足すとパートも 1 個増える', () => {
      const store = usePartStore()
      const inst = must(store.instances.i1, 'インスタンス i1')
      ;(inst.data.区画 as unknown[]).push({ id: 'k4', name: 'ようかん', body: 'ようかんの説明' })
      expect(store.parts).toHaveLength(6)
    })
  })

  describe('P0-2: 同じパートを 2 箇所に置いても、データ変更に両方が追従する', () => {
    it('初期表示が 2 箇所とも同じ内容で出る', () => {
      const views = wrapper.findAll('.part-ref')
      expect(views).toHaveLength(2)
      for (const v of views) {
        expect(v.text()).toContain('どらやき')
        expect(v.text()).toContain('どらやきの説明')
      }
    })

    it('ストア側の値を変えると、置かれた 2 箇所とも変わる', async () => {
      const store = usePartStore()
      const sections = must(store.instances.i1, 'インスタンス i1').data.区画 as Array<
        Record<string, unknown>
      >
      const target = must(sections[1], '区画 k2')
      target.name = 'きんつば'
      target.body = 'きんつばの説明'
      await nextTick()

      const views = wrapper.findAll('.part-ref')
      expect(views).toHaveLength(2)
      for (const v of views) {
        expect(v.text()).toContain('きんつば')
        expect(v.text()).not.toContain('どらやき')
      }
    })
  })

  describe('P0-3: データから消えたら、置かれた参照を行方不明として検出できる', () => {
    it('配列から要素を消すと dangling に出る', async () => {
      const store = usePartStore()
      const inst = must(store.instances.i1, 'インスタンス i1')
      inst.data.区画 = (inst.data.区画 as Array<Record<string, unknown>>).filter(
        (r) => r.id !== 'k2',
      )
      await nextTick()

      const report = analyzePlacement(editor.state.doc, store.parts)
      expect(report.dangling).toHaveLength(2)
      expect(report.dangling.every((r) => r.partId === '区画:k2')).toBe(true)
      expect(wrapper.findAll('.part-ref__missing')).toHaveLength(2)
    })
  })

  describe('P0-4: ドキュメントの走査だけで未配置件数が数えられる', () => {
    it('5 パート中 1 個だけ置かれている → 未配置 4 件・重複 1 件', () => {
      const store = usePartStore()
      const report = analyzePlacement(editor.state.doc, store.parts)
      expect(report.unplaced.map((p) => p.partId)).toEqual([
        'まえがき',
        '区画:k1',
        '区画:k3',
        'ぜんたいず',
      ])
      expect(report.duplicated).toEqual(['i1/区画:k2'])
    })

    it('1 個置くと未配置が 1 件減る', () => {
      const store = usePartStore()
      editor
        .chain()
        .insertContentAt(
          variant.endPos(editor.state.doc),
          makeRef(variant.nodeName, 'i1', '区画:k1'),
        )
        .run()
      expect(analyzePlacement(editor.state.doc, store.parts).unplaced).toHaveLength(3)
    })
  })

  describe('P0-5: 参照ノードを別の位置へ移しても紐付けが保たれる', () => {
    it('削除＋挿入で移動しても attrs と表示が保たれる', async () => {
      const before = collectPlacedRefs(editor.state.doc)
      expect(before).toHaveLength(2)

      // 先頭側の参照を、末尾へ移す（ドラッグ操作の実体はこの 2 手）
      const target = must(before[0], '移動元の参照')
      const node = must(editor.state.doc.nodeAt(target.pos), '移動元のノード')

      const tr = editor.state.tr.delete(target.pos, target.pos + node.nodeSize)
      tr.insert(variant.endPos(tr.doc), node)
      editor.view.dispatch(tr)
      await nextTick()

      const after = collectPlacedRefs(editor.state.doc)
      expect(after).toHaveLength(2)
      expect(after.map((r) => `${r.instanceId}/${r.partId}`)).toEqual(['i1/区画:k2', 'i1/区画:k2'])
      // 位置は変わっている（＝本当に移動した）
      expect(must(after[1], '移動後の 2 個目').pos).toBeGreaterThan(
        must(before[1], '移動前の 2 個目').pos,
      )
      for (const v of wrapper.findAll('.part-ref')) {
        expect(v.text()).toContain('どらやき')
      }
    })
  })

  describe('P0-6: 本文には参照しか保存されない', () => {
    it('getJSON に partRef の attrs だけが出て、パートの中身は出ない', () => {
      const json = JSON.stringify(editor.getJSON())
      expect(json).toContain('"partId":"区画:k2"')
      expect(json).not.toContain('どらやきの説明')
    })
  })
})

describe('inline 版の DOM', () => {
  /**
   * ⚠ `<p>` の中に `<div>` が入ると HTML として不正で、ブラウザの正規化が段落を割りうる
   *   ＝ **置いた位置が黙って変わる**。これは「4 性質が緑」では捕まらない種類の壊れ方なので、
   *   タグそのものを見ておく。
   */
  it('段落の中に置いた参照は span で描かれる（div ではない）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePartStore()
    store.registerDefinition(definition)
    store.upsertInstance(makeInstance())

    const editor = new Editor({
      extensions: [Document, Paragraph, Text, PartRef, PartRefInline],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              textNode('まえ'),
              makeRef(PART_REF_INLINE_NODE, 'i1', '区画:k2'),
              textNode('あと'),
            ],
          },
        ],
      },
    })
    const wrapper = mount(Host, { props: { editor }, global: { plugins: [pinia] } })
    // ⚠ NodeView（Vue コンポーネント）は次の tick で挿さる。
    await nextTick()

    const refElement = must(wrapper.find('.part-ref').element, '参照の要素')
    expect(refElement.tagName).toBe('SPAN')
    expect(must(wrapper.find('p').element.querySelector('.part-ref'), '段落の中の参照')).toBe(
      refElement,
    )

    wrapper.unmount()
    editor.destroy()
  })
})
