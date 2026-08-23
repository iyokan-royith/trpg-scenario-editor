/**
 * P2 完了条件 #3「**保存すると N 個生まれる**」を、実データで通す。
 *
 * ⚠ フォーム（完了条件 #2）は範囲外なので、入力の器を経由せずに
 *   **保存の経路（IndexedDB 往復）と導出の経路（ストア）**だけを通す。
 *   ⚠⚠ ここを飛ばして評価器の単体テストだけで済ませると、
 *   「保存すると」の部分が一度も実行されないまま「11 個出た」と言うことになる。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePartStore } from '../partStore'
import { clearInstances, loadInstances, saveInstance } from '../persistence'
import { readMayoiParkSample } from '../../samples'

describe('保存すると 11 個生まれる（P2 完了条件 #3）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await clearInstances()
  })

  it('保存 → 読み戻し → 導出、で 11 個', async () => {
    await saveInstance(readMayoiParkSample())

    const store = usePartStore()
    store.registerBundledTemplates()
    for (const instance of await loadInstances()) store.upsertInstance(instance)

    expect(store.parts).toHaveLength(11)
    // ⚠ 未配置の数え上げ（S7-1）はこの配列を見るので、件数がそのまま画面の「未配置 N 件」になる。
    expect(store.partsOfInstance('sample-mayoi-park')).toHaveLength(11)
  })

  it('部屋を 1 件足して保存し直すと 12 個になる', async () => {
    const instance = readMayoiParkSample()
    const rooms = instance.data.rooms as { id: string }[]
    rooms.push({ id: 'room-10', at: { row: 'C', col: 1 }, name: 'ふえた部屋' } as never)
    await saveInstance(instance)

    const store = usePartStore()
    store.registerBundledTemplates()
    for (const loaded of await loadInstances()) store.upsertInstance(loaded)

    expect(store.parts).toHaveLength(12)
  })
})
