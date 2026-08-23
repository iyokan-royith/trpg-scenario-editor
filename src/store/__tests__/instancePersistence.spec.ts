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
import { reactive } from 'vue'
import type { TemplateInstance } from '../../template/model'

const legacyDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '前の版で書いた本文' }] }],
}

/** 版 1 の DB（`documents` しか無い状態）を素の IndexedDB で作る。 */
function createV1Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trpg-scenario-editor', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents', { keyPath: 'key' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('documents', 'readwrite')
      tx.objectStore('documents').put({ key: 'current', doc: legacyDoc, updatedAt: 1 })
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
    await createV1Database()
    // ここで初めて実コード（版 2 で開く）を通す
    const loaded = await loadDocument()
    expect(loaded?.doc).toEqual(legacyDoc)
    // 素材ストアも使える状態になっている
    await expect(loadInstances()).resolves.toEqual([])
  })
})

function imageInstance(id: string, caption: string, bytes: number[]): TemplateInstance {
  return {
    id,
    templateId: 'builtin.image',
    data: { caption },
    images: { image: new Blob([new Uint8Array(bytes)], { type: 'image/png' }) },
  }
}

/**
 * ⚠⚠ 識別子の英語化（DESIGN §1-8）で `表示名`/`画像` → `caption`/`image` へ変えた。
 *   **保存済みのデータは旧キーのまま**なので、読み込みの境界で読み替えないと
 *   画像もキャプションも引けなくなる（バイト列は残るのに画面からは消える）。
 */
describe('英語化する前に保存された素材（旧キー）', () => {
  beforeEach(async () => {
    await clearInstances()
  })

  it('旧キーで書かれていても、現行キーで読み出せる', async () => {
    // ⚠ 実装の型を通さずに**旧い形をそのまま**書き込む（現行の型では旧キーを作れないため）
    await saveInstance({
      id: 'そざい1',
      templateId: 'builtin.image',
      data: { 表示名: 'ねこの写真' },
      images: { 画像: new Blob([new Uint8Array([3, 3])], { type: 'image/png' }) },
    } as unknown as TemplateInstance)

    const [material] = await loadInstances()
    expect(material!.data.caption).toBe('ねこの写真')
    expect([...new Uint8Array(await material!.images.image!.arrayBuffer())]).toEqual([3, 3])
    // 旧キーは上の層へ流さない（2 つの名前が並存すると、どちらが真か分からなくなる）
    expect(Object.keys(material!.data)).toEqual(['caption'])
    expect(Object.keys(material!.images)).toEqual(['image'])
  })

  it('利用者が持ち込んだ定義のインスタンスには触らない（日本語キーは正規・CONCEPT S10）', async () => {
    await saveInstance({
      id: 'そざい2',
      templateId: 'user.something',
      data: { 表示名: 'そのまま' },
      images: {},
    } as unknown as TemplateInstance)

    const [material] = await loadInstances()
    expect(material!.data.表示名).toBe('そのまま')
  })
})

describe('素材の保存', () => {
  beforeEach(async () => {
    await clearInstances()
  })

  it('画像の Blob が、そのままの中身で読み戻せる', async () => {
    await saveInstance(imageInstance('そざい1', 'ねこの写真', [1, 2, 3, 4]))

    const reloaded = await loadInstances()
    expect(reloaded).toHaveLength(1)
    const material = reloaded[0]!
    expect(material.data.caption).toBe('ねこの写真')

    const blob = material.images.image
    expect(blob).toBeInstanceOf(Blob)
    // ⚠ 「Blob が入っている」だけでは足りない。中身まで見る（空の Blob でも型は合う）。
    const bytes = new Uint8Array(await blob!.arrayBuffer())
    expect([...bytes]).toEqual([1, 2, 3, 4])
    expect(blob!.type).toBe('image/png')
  })

  it('同じ id で保存し直すと差し替わる（増えない）', async () => {
    await saveInstance(imageInstance('そざい1', 'ねこの写真', [1]))
    await saveInstance(imageInstance('そざい1', 'ねこの写真', [9, 9]))

    const reloaded = await loadInstances()
    expect(reloaded).toHaveLength(1)
    const bytes = new Uint8Array(await reloaded[0]!.images.image!.arrayBuffer())
    expect([...bytes]).toEqual([9, 9])
  })

  it('消すと読み戻らない', async () => {
    await saveInstance(imageInstance('そざい1', 'ねこの写真', [1]))
    await saveInstance(imageInstance('そざい2', 'いぬの写真', [2]))
    await deleteInstance('そざい1')

    expect((await loadInstances()).map((i) => i.id)).toEqual(['そざい2'])
  })

  /**
   * ⚠⚠ ストアから取り出したインスタンスは Vue の Proxy である。
   *   これをそのまま IndexedDB へ渡すと `DataCloneError` で落ちる。
   *   ⚠ 意地の悪いことに、**追加の経路は素のオブジェクトを返すので通り、
   *   差し替えの経路だけが落ちる**——同じ関数を呼んでいるのに、片方だけが壊れる。
   *   （実装中に実際に踏んだ。画面では差し替わったのに保存だけ届いていなかった）
   */
  it('リアクティブなインスタンスを渡しても保存できる（Proxy のまま書き込まない）', async () => {
    const material = reactive(imageInstance('そざい1', 'ねこの写真', [5, 5]))
    await saveInstance(material as TemplateInstance)

    const reloaded = await loadInstances()
    expect(reloaded).toHaveLength(1)
    expect([...new Uint8Array(await reloaded[0]!.images.image!.arrayBuffer())]).toEqual([5, 5])
  })

  it('本文の保存とは別のストアなので、互いを消さない', async () => {
    await saveDocument({ type: 'doc', content: [] })
    await saveInstance(imageInstance('そざい1', 'ねこの写真', [1]))
    await clearInstances()

    expect(await loadDocument()).not.toBeNull()
    expect(await loadInstances()).toEqual([])
  })
})
