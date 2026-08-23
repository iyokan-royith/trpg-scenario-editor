/**
 * 完了条件 #7: リロードしても画像が残る（Blob が IndexedDB に入っている）。
 *
 * ⚠⚠ ここには **DB の版上げ（1 → 2）** の確認も入れている。
 *   既に前の版で本文を書いている利用者が居るので、版を上げたときに
 *   **`documents` を作り直すと本文が消える**。しかもその壊れ方は
 *   「新しく開いた人には何も起きない」ので、開発中には一度も見えない。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearInstances,
  deleteInstance,
  loadDocument,
  loadInstances,
  saveDocument,
  saveInstance,
} from '../persistence'
import type { TemplateInstance } from '../../template/model'

const 旧版の本文 = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '前の版で書いた本文' }] }],
}

/** 版 1 の DB（`documents` しか無い状態）を素の IndexedDB で作る。 */
function 版1のDBを作る(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trpg-scenario-editor', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents', { keyPath: 'key' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('documents', 'readwrite')
      tx.objectStore('documents').put({ key: 'current', doc: 旧版の本文, updatedAt: 1 })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}

describe('DB の版上げ（1 → 2）', () => {
  // ⚠ この describe は**このファイルの先頭で 1 度だけ**成立する（版 2 で開いた後では試せない）。
  it('版 1 で書いた本文は、素材ストアを足した版 2 で開いても残っている', async () => {
    await 版1のDBを作る()
    // ここで初めて実コード（版 2 で開く）を通す
    const 読み出したもの = await loadDocument()
    expect(読み出したもの?.doc).toEqual(旧版の本文)
    // 素材ストアも使える状態になっている
    await expect(loadInstances()).resolves.toEqual([])
  })
})

function 画像素材(id: string, 表示名: string, bytes: number[]): TemplateInstance {
  return {
    id,
    templateId: 'builtin.image',
    data: { 表示名 },
    images: { 画像: new Blob([new Uint8Array(bytes)], { type: 'image/png' }) },
  }
}

describe('素材の保存', () => {
  beforeEach(async () => {
    await clearInstances()
  })

  it('画像の Blob が、そのままの中身で読み戻せる', async () => {
    await saveInstance(画像素材('そざい1', 'ねこの写真', [1, 2, 3, 4]))

    const 読み戻し = await loadInstances()
    expect(読み戻し).toHaveLength(1)
    const 素材 = 読み戻し[0]!
    expect(素材.data.表示名).toBe('ねこの写真')

    const blob = 素材.images.画像
    expect(blob).toBeInstanceOf(Blob)
    // ⚠ 「Blob が入っている」だけでは足りない。中身まで見る（空の Blob でも型は合う）。
    const bytes = new Uint8Array(await blob!.arrayBuffer())
    expect([...bytes]).toEqual([1, 2, 3, 4])
    expect(blob!.type).toBe('image/png')
  })

  it('同じ id で保存し直すと差し替わる（増えない）', async () => {
    await saveInstance(画像素材('そざい1', 'ねこの写真', [1]))
    await saveInstance(画像素材('そざい1', 'ねこの写真', [9, 9]))

    const 読み戻し = await loadInstances()
    expect(読み戻し).toHaveLength(1)
    const bytes = new Uint8Array(await 読み戻し[0]!.images.画像!.arrayBuffer())
    expect([...bytes]).toEqual([9, 9])
  })

  it('消すと読み戻らない', async () => {
    await saveInstance(画像素材('そざい1', 'ねこの写真', [1]))
    await saveInstance(画像素材('そざい2', 'いぬの写真', [2]))
    await deleteInstance('そざい1')

    expect((await loadInstances()).map((i) => i.id)).toEqual(['そざい2'])
  })

  it('本文の保存とは別のストアなので、互いを消さない', async () => {
    await saveDocument({ type: 'doc', content: [] })
    await saveInstance(画像素材('そざい1', 'ねこの写真', [1]))
    await clearInstances()

    expect(await loadDocument()).not.toBeNull()
    expect(await loadInstances()).toEqual([])
  })
})
