/**
 * **本文に置いたパート参照の見え方と、参照だけを外す操作**（DESIGN-v0.md §1-13-1i・移行 P-e）。
 *
 * 確かめる断言（ロイスが実機で触って出した 3 つの要望に対応する）:
 *   1. block 版は**既定で畳まれ、ラベル 1 行だけ**が出る（ラベル＝本文 md の第一見出し）
 *   2. 開くと本文が出て、**md の改行が保たれている**
 *   3. 選択中に「参照を外す」が出て、確認を経て**参照だけ**が消える（**素材は残る**）
 *
 * ⚠⚠ **jsdom で確かめられないもの**（実ブラウザでしか分からない・報告にも書いた）:
 *   - `mousedown.prevent` が ProseMirror の選択移動とドラッグ開始を実際に止めるか
 *     （jsdom には ProseMirror の mousedown ハンドラを走らせる実物の入力が無い）
 *   - `white-space: pre-wrap` が**見た目として**改行を出すか
 *     （ここで見られるのは「DOM のテキストに改行文字が在る」までである）
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
import {
  PartRef,
  PartRefInline,
  PART_REF_NODE,
  PART_REF_INLINE_NODE,
  collectPlacedRefs,
} from '../partRefExtension'
import { usePartStore } from '../../store/partStore'
import type { TemplateDefinition, TemplateInstance } from '../../template/model'

/** ⚠ 本文に**見出しと改行**を持たせる（この 2 つがこのファイルの検査対象そのもの）。 */
const SECTION_BODY = '# みなみのひろば\n\nいちぎょうめ\nにぎょうめ\n'

const definition: TemplateDefinition = {
  id: 'みほん',
  name: 'みほんテンプレ',
  version: '0.1.0',
  fields: [],
  outputs: [{ key: '区画', kind: 'perItem', over: '区画', label: '区画', form: 'section' }],
}

function makeInstance(): TemplateInstance {
  return {
    id: 'i1',
    templateId: 'みほん',
    images: {},
    data: { 区画: [{ id: 'k1', name: 'ひろば', body: SECTION_BODY }] },
  }
}

const Host = defineComponent({
  props: { editor: { type: Object, required: true } },
  setup(props) {
    return () => h(EditorContent, { editor: props.editor as Editor })
  },
})

interface Variant {
  label: string
  nodeName: string
  body: () => object
  /** その版の参照ノードの doc 内での位置。 */
  refPos: () => number
}

const variants: Variant[] = [
  {
    label: 'block 版',
    nodeName: PART_REF_NODE,
    body: () => ({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '手書きの前段' }] },
        { type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: '区画:k1' } },
      ],
    }),
    // 段落（開始 0・「手書きの前段」6 文字・閉じ）の次
    refPos: () => 8,
  },
  {
    label: 'inline 版',
    nodeName: PART_REF_INLINE_NODE,
    body: () => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '手書きの前段' },
            { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'i1', partId: '区画:k1' } },
          ],
        },
      ],
    }),
    refPos: () => 7,
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

  /** ⚠ `.text()` は前後を落として改行も畳むので、**改行を見る断言では使えない**。 */
  function rawBodyText(): string {
    return wrapper.find('.part-ref__body').element.textContent ?? ''
  }

  async function select(): Promise<void> {
    editor.commands.setNodeSelection(variant.refPos())
    await nextTick()
  }

  function refCount(): number {
    return collectPlacedRefs(editor.state.doc).length
  }

  it('前提の確認: 参照が 1 つ置かれていて、素材も 1 件ある（以下はこの上に乗る）', () => {
    expect(refCount()).toBe(1)
    expect(usePartStore().parts).toHaveLength(1)
    expect(wrapper.find('.part-ref').exists()).toBe(true)
  })

  it('⭐ ラベルは本文 md の第一見出し（テンプレ名を含む `title` ではない）', () => {
    expect(wrapper.find('.part-ref__label').text()).toBe('みなみのひろば')
    // `title` は `区画 ひろば`。⚠ これが出ていたら A105 の重複が残っている。
    expect(wrapper.find('.part-ref__head').text()).not.toContain('区画 ひろば')
  })

  describe('折り畳み', () => {
    it('選択していなくてもラベルは出る（畳んだ状態でも何のパートか分かる）', () => {
      expect(wrapper.find('.part-ref__label').exists()).toBe(true)
    })

    it('⭐ 開くと本文が出て、md の改行が保たれている', async () => {
      const toggle = wrapper.find('.part-ref__toggle')
      if (toggle.exists()) await toggle.trigger('click')
      expect(rawBodyText()).toContain('いちぎょうめ\nにぎょうめ')
    })
  })

  describe('参照を外す（削除）', () => {
    it('選択していないときは削除ボタンを出さない', () => {
      expect(wrapper.find('.part-ref__delete').exists()).toBe(false)
    })

    it('⭐ 選択すると削除ボタンが出る（block・inline の両方）', async () => {
      await select()
      expect(wrapper.find('.part-ref__delete').exists()).toBe(true)
    })

    it('⚠ 押してすぐには消さない——確認を挟む（ブラウザ既定の confirm は使わない）', async () => {
      await select()
      await wrapper.find('.part-ref__delete').trigger('click')
      expect(wrapper.find('.part-ref__confirm').exists()).toBe(true)
      // ⚠ ここが本命。確認が出ている**時点では 1 文字も消えていない**
      expect(refCount()).toBe(1)
    })

    it('⭐⭐ 承諾すると参照だけが消える（素材は残る）', async () => {
      await select()
      await wrapper.find('.part-ref__delete').trigger('click')
      await wrapper.find('.part-ref__confirmYes').trigger('click')
      await nextTick()

      expect(refCount()).toBe(0)
      // ⚠⚠ 素材まで消えていたら、右ペインの「消す」と役割が重なっている
      expect(usePartStore().parts).toHaveLength(1)
    })

    it('やっぱりやめると何も消えない（確認も畳む）', async () => {
      await select()
      await wrapper.find('.part-ref__delete').trigger('click')
      await wrapper.find('.part-ref__confirmNo').trigger('click')
      await nextTick()

      expect(refCount()).toBe(1)
      expect(wrapper.find('.part-ref__confirm').exists()).toBe(false)
    })

    it('⚠ 選択が外れたら確認も畳む（いつのものか分からない問いを残さない）', async () => {
      await select()
      await wrapper.find('.part-ref__delete').trigger('click')
      expect(wrapper.find('.part-ref__confirm').exists()).toBe(true)

      editor.commands.setTextSelection(1)
      await nextTick()
      expect(wrapper.find('.part-ref__confirm').exists()).toBe(false)
    })

    it('⭐⭐ 素材が消えて「行方不明」になった参照でも外せる（ロイスの本命の用途）', async () => {
      const store = usePartStore()
      const inst = store.instances.i1
      if (!inst) throw new Error('インスタンス i1 が見つかりません')
      inst.data.区画 = []
      await nextTick()

      // 前提の確認: 行方不明として見えている（＝ここから先が「行方不明でも」の検査になる）
      expect(wrapper.find('.part-ref__missing').exists()).toBe(true)
      expect(store.parts).toHaveLength(0)

      await select()
      await wrapper.find('.part-ref__delete').trigger('click')
      await wrapper.find('.part-ref__confirmYes').trigger('click')
      await nextTick()

      expect(refCount()).toBe(0)
    })
  })
})

/**
 * ⚠⚠ **版ごとに違う所だけを別に置く**（`describe.each` に書くと、同じ断言を
 *   両版に当てているように見えて片方でしか意味が無いものが混ざる）。
 */
describe('版ごとの違い', () => {
  let pinia: Pinia
  let editor: Editor
  let wrapper: VueWrapper

  /** ⚠ `await` すること——NodeView は Vue のコンポーネントなので、mount した tick では出ていない。 */
  async function mountWith(nodeName: string): Promise<void> {
    pinia = createPinia()
    setActivePinia(pinia)
    const store = usePartStore()
    store.registerDefinition(definition)
    store.upsertInstance(makeInstance())
    editor = new Editor({
      extensions: [Document, Paragraph, Text, PartRef, PartRefInline],
      content:
        nodeName === PART_REF_NODE
          ? {
              type: 'doc',
              content: [{ type: PART_REF_NODE, attrs: { instanceId: 'i1', partId: '区画:k1' } }],
            }
          : {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: PART_REF_INLINE_NODE, attrs: { instanceId: 'i1', partId: '区画:k1' } },
                  ],
                },
              ],
            },
    })
    wrapper = mount(Host, { props: { editor }, global: { plugins: [pinia] } })
    await nextTick()
  }

  afterEach(() => {
    wrapper?.unmount()
    editor?.destroy()
  })

  it('⭐ block 版は既定で畳まれている（ラベルだけで、本文は出ていない）', async () => {
    await mountWith(PART_REF_NODE)
    expect(wrapper.find('.part-ref__label').exists()).toBe(true)
    expect(wrapper.find('.part-ref__body').exists()).toBe(false)
    expect(wrapper.find('.part-ref__toggle').exists()).toBe(true)
  })

  it('⭐⭐ inline 版は畳まない（文の流れの中の要素を畳むと読めなくなる）', async () => {
    await mountWith(PART_REF_INLINE_NODE)
    expect(wrapper.find('.part-ref__toggle').exists()).toBe(false)
    expect(wrapper.find('.part-ref__body').exists()).toBe(true)
  })

  it('block 版は開いた後もう一度押すと畳む', async () => {
    await mountWith(PART_REF_NODE)
    await wrapper.find('.part-ref__toggle').trigger('click')
    expect(wrapper.find('.part-ref__body').exists()).toBe(true)
    await wrapper.find('.part-ref__toggle').trigger('click')
    expect(wrapper.find('.part-ref__body').exists()).toBe(false)
  })
})
