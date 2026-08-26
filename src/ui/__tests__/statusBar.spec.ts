/**
 * ステータスバーの 3 状態（DESIGN-v0.md §1-13-1f 決定1・移行 P-d1）。
 *
 * ⚠⚠ **確かめたいのは「見れば状況が分かる」こと**（ロイスの要求）なので、
 *   クラス名や DOM の形ではなく**画面に出る文字**を述語にしている。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBar from '../StatusBar.vue'
import type { LiquidRenderFailure } from '../../store/partStore'

const FAILURE: LiquidRenderFailure = {
  instanceId: 'i1',
  templateId: 'builtin.dungeon-map',
  message: 'undefined variable: nope, line:3, col:4',
  context: '>> 3| {{ nope }}\n      ^',
}

function barOf(props: Partial<InstanceType<typeof StatusBar>['$props']> = {}) {
  return mount(StatusBar, {
    props: { status: 'ready', failures: [], partCount: 20, liquidPartCount: 9, ...props },
  })
}

describe('ステータスバー', () => {
  it('正常: 件数が読める', () => {
    const text = barOf().text()
    expect(text).toContain('描画済み')
    expect(text).toContain('パート 20 件（うち liquid 9 件）')
  })

  it('描画中: 描画中と分かり、⚠ 件数は消えない（本文が残っていることの裏返し）', () => {
    const text = barOf({ status: 'rendering' }).text()
    expect(text).toContain('描画中')
    expect(text).toContain('パート 20 件（うち liquid 9 件）')
  })

  it('⭐⭐ エラー: 件数と、liquidjs の文面がそのまま出る（ラップも和訳もしない）', () => {
    const wrapper = barOf({ status: 'error', failures: [FAILURE] })
    const text = wrapper.text()
    expect(text).toContain('描画エラー 1 件')
    expect(text).toContain('builtin.dungeon-map')
    // ⚠⚠ ここが §1-13-1c の決定そのもの。`line:` `col:` と `^` が残っていないと
    //   テンプレ作者は現物へ辿り着けない。
    expect(text).toContain('undefined variable: nope, line:3, col:4')
    expect(wrapper.find('.status__context').text()).toContain('^')
    // ⚠ 反証: 状態は属性にも出る（色を当てる先が「エラーのときだけ」であること）
    expect(wrapper.attributes('data-status')).toBe('error')
  })

  it('⚠ `context` を持たない例外でも落ちない（parseLimit 超過の形・§1-13-1c）', () => {
    const wrapper = barOf({
      status: 'error',
      failures: [{ instanceId: 'i1', templateId: 't', message: 'parse length limit exceeded' }],
    })
    expect(wrapper.text()).toContain('parse length limit exceeded')
    expect(wrapper.find('.status__context').exists()).toBe(false)
  })

  it('エラーが無ければ一覧そのものが出ない（正常時に帯が太らない）', () => {
    expect(barOf().find('.status__failures').exists()).toBe(false)
  })
})
