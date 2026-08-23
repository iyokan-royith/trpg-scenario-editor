/**
 * P1-6: リロードしても内容が残る（IndexedDB）。
 *
 * ⚠ jsdom には IndexedDB が無いので `fake-indexeddb` を入れている。
 *   ⭐ ここで「保存を差し替えたインメモリ実装」でテストしないのが要点——
 *     それだと **IndexedDB を使う実コードが 1 行も通らない**まま緑になる。
 *
 * ⚠ 検証データは全て創作。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { documentExtensions } from '../../document/schema'
import {
  clearDocument,
  createAutoSaver,
  loadDocument,
  saveDocument,
  CURRENT_DOCUMENT_KEY,
} from '../persistence'

const 書きかけ = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'あかしょう' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'あかの本文' }] },
  ],
}

let editor: Editor | null = null

beforeEach(async () => {
  await clearDocument()
})

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('P1-6: 保存と読み戻し', () => {
  it('保存していなければ null（＝初回起動を区別できる）', async () => {
    expect(await loadDocument()).toBeNull()
  })

  it('保存した doc がそのまま読み戻せる', async () => {
    await saveDocument(書きかけ)
    const found = await loadDocument()
    expect(found).not.toBeNull()
    expect(found!.key).toBe(CURRENT_DOCUMENT_KEY)
    expect(found!.doc).toEqual(書きかけ)
    expect(found!.updatedAt).toBeGreaterThan(0)
  })

  it('⭐ リロード相当（エディタを捨てて作り直す）で内容が残る', async () => {
    const 一台目 = new Editor({ extensions: documentExtensions, content: 書きかけ })
    一台目.commands.insertContentAt(一台目.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'あとから書いた行' }],
    })
    const 保存前 = 一台目.getJSON()
    await saveDocument(保存前)
    一台目.destroy()

    // ここでページを閉じたことにする
    const 復元 = await loadDocument()
    editor = new Editor({ extensions: documentExtensions, content: 復元!.doc as object })

    expect(editor.getJSON()).toEqual(保存前)
    expect(editor.state.doc.textContent).toContain('あとから書いた行')
  })

  it('同じキーへの保存は上書きになる（履歴を溜めない）', async () => {
    await saveDocument({ type: 'doc', content: [] })
    await saveDocument(書きかけ)
    expect((await loadDocument())!.doc).toEqual(書きかけ)
  })
})

describe('P1-6: 自動保存', () => {
  it('連続した変更をまとめて 1 回書く（flush で確定できる）', async () => {
    let 呼ばれた回数 = 0
    const saver = createAutoSaver({
      getDoc: () => {
        呼ばれた回数 += 1
        return 書きかけ
      },
      delay: 10,
    })
    saver.schedule()
    saver.schedule()
    saver.schedule()
    await saver.flush()

    expect(呼ばれた回数).toBe(1)
    expect((await loadDocument())!.doc).toEqual(書きかけ)
    saver.stop()
  })

  it('保存に失敗しても黙らない（onError に渡る）', async () => {
    const errors: unknown[] = []
    const saver = createAutoSaver({
      getDoc: () => {
        throw new Error('doc を取り出せませんでした')
      },
      delay: 10,
      onError: (e) => errors.push(e),
    })
    // ⚠ flush() 自体は投げない。握り潰しでもなく、onError に届く。
    await saver.flush()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('doc を取り出せませんでした')
    saver.stop()
  })
})
