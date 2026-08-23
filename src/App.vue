<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { createDocumentEditor } from './document/editor'
import { outline } from './document/outline'
import { dropTargetPos, moveSection, setSectionLevel } from './document/sections'
import { docToMd, mdToDoc } from './document/markdown'
import OutlinePane from './ui/OutlinePane.vue'
import { usePartStore } from './p0/partStore'
import { createAutoSaver, loadDocument } from './store/persistence'

/**
 * v0 の画面。左に見出しツリー、右に 1 枚の連続文書（CONCEPT Q5）。
 *
 * ⚠ ツリーは doc から導出しているだけで、状態を持っていない。
 */
const store = usePartStore()
const editor = shallowRef<Editor | null>(null)
const 版 = ref(0) // doc が変わったことをツリーに伝えるためだけの数
const しらせ = ref('')
const md = ref('')
const mdを開いている = ref(false)

const 見出しツリー = computed(() => {
  void 版.value // 依存を作る（doc は Vue のリアクティブ対象ではないため）
  const doc = editor.value?.state.doc
  // ⚠ parts を渡すのが契約（DESIGN 1-6-4）。渡さないと独立章パートの見出しがツリーに出ない。
  return doc ? outline(doc, store.parts) : []
})

const saver = createAutoSaver({
  getDoc: () => editor.value?.getJSON() ?? { type: 'doc', content: [] },
  onError: (error) => {
    しらせ.value = `保存できませんでした: ${error instanceof Error ? error.message : String(error)}`
  },
})

onMounted(async () => {
  let 初期内容: object | undefined
  try {
    初期内容 = ((await loadDocument())?.doc as object) ?? undefined
  } catch (error) {
    しらせ.value = `前回の内容を読み出せませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }

  editor.value = createDocumentEditor({
    content: 初期内容 ?? {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ここに書きはじめる' }] }],
    },
    // ⚠ ツリーを作り直す経路はここ 1 本だけにしてある。
    //   以前は onSelectionUpdate でも版を進めていたが、
    //   **outline(doc, parts) は選択に依存しない**ので、あれは 2 本目の経路でしかなかった。
    //   経路が 2 本あると片方が死んでも検査が鳴らない（陽性対照で実測）ので消した。
    onUpdate: () => {
      版.value += 1
      saver.schedule()
    },
  })
})

onBeforeUnmount(() => {
  // ⚠ stop() だけだと保留中の書き込みを捨てる。閉じる前に必ず流す。
  // ⚠ ただし **ブラウザのタブを閉じる／リロードするときはここが呼ばれる保証が無い**。
  //   自動保存の待ち時間（500ms）以内の打鍵は、その場合ひとつ前の状態に戻りうる。
  //   要検証[実ブラウザで、文字を打った直後（1 秒以内）にリロードして
  //          直前の打鍵が残るか。残らないなら beforeunload での書き込みを足すか、
  //          待ち時間を詰めるかを決める]
  void saver.flush().finally(() => saver.stop())
  editor.value?.destroy()
})

/**
 * ⚠ テストから本文を触るためだけの口。
 *   これが無いと「本文を編集すると左ペインが追従する」の**アプリ側の配線**（版 → computed）が
 *   1 行も通らないまま緑になる。
 */
defineExpose({ editor })

function 移動(payload: { 掴んだ: number; 落とした先: number }) {
  const ed = editor.value
  if (!ed) return
  // 「相手の場所を取る」の意味を doc の挿入位置へ翻訳する（sections.ts の責務）。
  const dest = dropTargetPos(ed.state.doc, payload.掴んだ, payload.落とした先)
  if (dest === null) {
    しらせ.value = 'そこへは移せません'
    return
  }
  const tr = moveSection(ed.state, payload.掴んだ, dest)
  if (!tr) {
    しらせ.value = 'そこへは移せません'
    return
  }
  ed.view.dispatch(tr)
  しらせ.value = ''
}

function 階層変更(payload: { pos: number; level: number }) {
  const ed = editor.value
  if (!ed) return
  const tr = setSectionLevel(ed.state, payload.pos, payload.level)
  if (!tr) {
    しらせ.value = 'これ以上は変えられません'
    return
  }
  ed.view.dispatch(tr)
  しらせ.value = ''
}

function 選択(pos: number) {
  editor.value?.commands.focus(pos + 1)
}

function md書き出し() {
  const doc = editor.value?.state.doc
  if (!doc) return
  md.value = docToMd(doc)
  mdを開いている.value = true
}

function md読み込み() {
  const ed = editor.value
  if (!ed) return
  try {
    const doc = mdToDoc(md.value, ed.state.schema)
    ed.commands.setContent(doc.toJSON())
    しらせ.value = 'md を読み込みました'
  } catch (error) {
    しらせ.value = `md を読み込めませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}
</script>

<template>
  <div class="app">
    <header class="app__header">
      <h1>シナリオエディタ</h1>
      <div class="app__actions">
        <button type="button" @click="md書き出し">md で書き出す</button>
        <button type="button" :disabled="!mdを開いている" @click="md読み込み">md を読み込む</button>
      </div>
    </header>
    <p v-if="しらせ" class="app__notice" role="status">{{ しらせ }}</p>
    <div class="app__body">
      <OutlinePane
        class="app__outline"
        :items="見出しツリー"
        @移動="移動"
        @階層変更="階層変更"
        @選択="選択"
      />
      <main class="app__editor">
        <EditorContent v-if="editor" :editor="editor" />
      </main>
    </div>
    <section v-if="mdを開いている" class="app__md">
      <label for="md">md（書き出した内容。直してから読み込めます）</label>
      <textarea id="md" v-model="md" rows="10"></textarea>
    </section>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: system-ui, sans-serif;
}
.app__header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #ddd;
}
.app__header h1 {
  font-size: 1rem;
  margin: 0;
}
.app__notice {
  margin: 0;
  padding: 0.25rem 1rem;
  background: #fff6d5;
  font-size: 0.9rem;
}
.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.app__outline {
  width: 16rem;
  border-right: 1px solid #ddd;
}
.app__editor {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 2rem;
}
.app__md {
  border-top: 1px solid #ddd;
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
}
.app__md textarea {
  width: 100%;
  font-family: monospace;
}
</style>
