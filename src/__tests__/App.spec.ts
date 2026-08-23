/**
 * 画面の結線が生きていることの薄い確認（機能の中身は各層のテストが見る）。
 *
 * ⚠ もとの「You did it!」（Vue の雛形）を確かめるテストは、App.vue を実物に
 *   差し替えた時点で意味を失うので、この内容へ**意図的に**書き換えている。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../App.vue'

async function 起動() {
  const wrapper = mount(App, { global: { plugins: [createPinia()] } })
  await flushPromises()
  await nextTick()
  return wrapper
}

describe('App', () => {
  it('起動すると本文と左ペインが出る', async () => {
    const wrapper = await 起動()
    expect(wrapper.text()).toContain('シナリオエディタ')
    expect(wrapper.find('.outline').exists()).toBe(true)
    wrapper.unmount()
  })

  it('本文に見出しがあれば左ペインに出る（ツリーは doc から導出されている）', async () => {
    const wrapper = await 起動()
    const outline = wrapper.findComponent({ name: 'OutlinePane' })
    expect(outline.exists()).toBe(true)
    // 初期内容には見出しが無いので空表示
    expect(outline.text()).toContain('見出しはまだありません')
    wrapper.unmount()
  })
})
