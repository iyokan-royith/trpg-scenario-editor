/**
 * ドキュメントの永続化（完了条件 #6: リロードしても内容が残る）。
 *
 * ⚠ 保存するのは **doc の JSON だけ**。パートもツリーも保存しない（どちらも導出値）。
 *    → 「保存したはずのツリーと本文がずれる」が構造的に起こらない（DESIGN 1-2 / P0 知見 1）。
 *
 * ⚠ 素の IndexedDB を薄く包むだけにしてある。1 ストアの put/get しか要らないので
 *    ラッパライブラリを入れる理由が無い（捨てるときはこのファイルを消すだけ）。
 */

const DB_NAME = 'trpg-scenario-editor'
const DB_VERSION = 1
const STORE_NAME = 'documents'

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けませんでした'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE_NAME, mode)
    const result = await run(tx.objectStore(STORE_NAME))
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
