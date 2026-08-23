/**
 * ドキュメントの永続化（完了条件 #6: リロードしても内容が残る）。
 *
 * ⚠ 保存するのは **doc の JSON だけ**。パートもツリーも保存しない（どちらも導出値）。
 *    → 「保存したはずのツリーと本文がずれる」が構造的に起こらない（DESIGN 1-2 / P0 知見 1）。
 *
 * ⚠ 素の IndexedDB を薄く包むだけにしてある。1 ストアの put/get しか要らないので
 *    ラッパライブラリを入れる理由が無い（捨てるときはこのファイルを消すだけ）。
 */

import { toRaw } from 'vue'
import type { TemplateInstance } from '../template/model'

const DB_NAME = 'trpg-scenario-editor'
/**
 * ⚠ 2 へ上げたのは素材（テンプレインスタンス）のストアを足したため。
 *   **既にある `documents` は作り直さない**——作り直すと、前の版で書いた本文が消える。
 *   `onupgradeneeded` の中で「無ければ作る」しか書かないのはそのため。
 */
const DB_VERSION = 2
const STORE_NAME = 'documents'
/** 素材（＝テンプレインスタンス）。画像の Blob はこの中に入る（DESIGN 1-4） */
const INSTANCE_STORE_NAME = 'instances'

/** v0 は 1 ドキュメントだけを扱う（CONCEPT Q5: 1 枚の連続文書）。 */
export const CURRENT_DOCUMENT_KEY = 'current'

export interface StoredDocument {
  key: string
  /** ProseMirror の doc の JSON（editor.getJSON() と同じ形） */
  doc: unknown
  updatedAt: number
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB の操作に失敗しました'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    // 握りつぶさない。どこで詰まったかが読んで分かる文面にする。
    return Promise.reject(new Error('この環境では IndexedDB が使えないため、内容を保存できません'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(INSTANCE_STORE_NAME)) {
        db.createObjectStore(INSTANCE_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けませんでした'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
  name: string = STORE_NAME,
): Promise<T> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(name, mode)
    const result = await run(tx.objectStore(name))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB のトランザクションに失敗しました'))
      tx.onabort = () =>
        reject(tx.error ?? new Error('IndexedDB のトランザクションが中断されました'))
    })
    return result
  } finally {
    db.close()
  }
}

export async function saveDocument(doc: unknown, key = CURRENT_DOCUMENT_KEY): Promise<void> {
  const record: StoredDocument = { key, doc, updatedAt: Date.now() }
  await withStore('readwrite', async (store) => {
    await requestToPromise(store.put(record))
  })
}

export async function loadDocument(key = CURRENT_DOCUMENT_KEY): Promise<StoredDocument | null> {
  return withStore('readonly', async (store) => {
    const found = await requestToPromise<StoredDocument | undefined>(store.get(key))
    return found ?? null
  })
}

export async function clearDocument(key = CURRENT_DOCUMENT_KEY): Promise<void> {
  await withStore('readwrite', async (store) => {
    await requestToPromise(store.delete(key))
  })
}

/**
 * 保存される素材の形。
 *
 * ⚠⚠ **画像は「バイト列＋MIME 型」で入れる（Blob そのものを入れない）。**
 *   IndexedDB は仕様上 Blob を持てるが、**その経路はこのリポジトリのテスト環境では
 *   1 行も通せない**——jsdom の Blob は Node の構造化複製が知らないオブジェクトで、
 *   `structuredClone(blob)` が中身の無い `{}` を返す（実測）。
 *   Blob のまま入れると **完了条件 #7 が「実ブラウザで手で触るまで未確認」のまま**になる。
 *   → バイト列なら同じ経路をテストで通せる。data URL と違い**太らず、非可逆でもない**。
 *
 * ⚠ 変換はこのファイル（保存の境界）の中だけで起きる。
 *   `TemplateInstance.images: Record<string, Blob>` はアプリ側では最後まで Blob のまま。
 *
 * ⚠ パートは保存しない（導出値・1-7-4）。保存するのはインスタンスだけ。
 */
interface StoredInstance {
  id: string
  templateId: string
  data: Record<string, unknown>
  images: Record<string, { bytes: ArrayBuffer; type: string }>
}

export async function saveInstance(instance: TemplateInstance): Promise<void> {
  // ⚠⚠ **必ず生の値に戻してから渡す。** ストアから取り出したインスタンスは Vue の Proxy で、
  //   そのまま `put()` すると **`DataCloneError: #<Object> could not be cloned`** で落ちる
  //   （構造化複製は Proxy を知らない）。⚠ 落ち方が意地悪で、**追加の経路は素のオブジェクトを
  //   返すので通り、差し替えの経路だけが落ちる**——どちらも同じ関数を呼んでいるのに。
  //   → 呼び手に「生で渡してください」と要求せず、**受け側で 1 回戻す**。
  const 生 = toRaw(instance)
  const images: StoredInstance['images'] = {}
  for (const [key, blob] of Object.entries(toRaw(生.images))) {
    images[key] = { bytes: await blob.arrayBuffer(), type: blob.type }
  }
  const record: StoredInstance = {
    id: 生.id,
    templateId: 生.templateId,
    data: toRaw(生.data),
    images,
  }
  await withStore(
    'readwrite',
    async (store) => {
      await requestToPromise(store.put(record))
    },
    INSTANCE_STORE_NAME,
  )
}

export async function deleteInstance(id: string): Promise<void> {
  await withStore(
    'readwrite',
    async (store) => {
      await requestToPromise(store.delete(id))
    },
    INSTANCE_STORE_NAME,
  )
}

export async function loadInstances(): Promise<TemplateInstance[]> {
  const records = await withStore(
    'readonly',
    async (store) => requestToPromise<StoredInstance[]>(store.getAll()),
    INSTANCE_STORE_NAME,
  )
  return records.map((record) => {
    const images: Record<string, Blob> = {}
    for (const [key, 画像] of Object.entries(record.images ?? {})) {
      images[key] = new Blob([画像.bytes], { type: 画像.type })
    }
    return { id: record.id, templateId: record.templateId, data: record.data, images }
  })
}

export async function clearInstances(): Promise<void> {
  await withStore(
    'readwrite',
    async (store) => {
      await requestToPromise(store.clear())
    },
    INSTANCE_STORE_NAME,
  )
}

export interface AutoSaver {
  /** 変更があったことを伝える。実際の書き込みは delay 後にまとめて 1 回 */
  schedule(): void
  /** 保留中の保存を今すぐ流す（テスト・画面を閉じるとき用） */
  flush(): Promise<void>
  stop(): void
}

/**
 * 変更のたびに保存すると打鍵ごとに書き込むので、少し待ってからまとめて書く。
 * ⚠ 失敗を握りつぶさない（`onError` に渡す）。黙って保存できていない状態がいちばん困る。
 */
export function createAutoSaver(options: {
  getDoc: () => unknown
  delay?: number
  key?: string
  onError?: (error: unknown) => void
}): AutoSaver {
  const { getDoc, delay = 500, key = CURRENT_DOCUMENT_KEY, onError } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> = Promise.resolve()

  const write = () => {
    // ⚠ getDoc() 自体が投げる場合も拾う（同期例外を素通りさせない）。
    pending = (async () => {
      try {
        await saveDocument(getDoc(), key)
      } catch (error) {
        if (onError) onError(error)
        else throw error
      }
    })()
    return pending
  }

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void write()
      }, delay)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await write()
      await pending
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
