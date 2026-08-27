<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { usePartStore } from '../store/partStore'
import { PART_REF_INLINE_NODE } from './partRefExtension'
import { partLabelOf } from './partLabel'
import type { Inline } from '../template/model'

const props = defineProps(nodeViewProps)
const store = usePartStore()

const instanceId = computed(() => String(props.node.attrs.instanceId))
const partId = computed(() => String(props.node.attrs.partId))
const part = computed(() => store.findPart(instanceId.value, partId.value))
const body = computed<Inline[]>(() => part.value?.body ?? [])

/**
 * ⚠ inline 版のときは **span** で包む。`<p>` の中に `<div>` を入れると HTML として不正で、
 *   ブラウザの正規化が段落を割りうる（＝置いた位置が黙って変わる）。
 */
const isInline = computed(() => props.node.type.name === PART_REF_INLINE_NODE)
const wrapperTag = computed(() => (isInline.value ? 'span' : 'div'))

/**
 * ⭐⭐ **畳めるのは block 版だけ**（DESIGN-v0.md §1-13-1i）。
 *   inline 版（画像など**文の流れの中**に置くもの）は畳まない——
 *   文の途中の要素を畳むと、行の意味が切れてかえって読めなくなる。
 */
const collapsible = computed(() => !isInline.value)

/**
 * ⚠⚠ **展開状態はどこにも保存しない**（§1-13-1i 決定・ロイス）。
 *   ノード属性に持たせると**文書データに見た目の状態が混ざる**（保存・md 書き出し・
 *   コピー＆ペーストのすべてに乗ってしまう）。
 *
 * ⚠ **その帰結**: ノードビューが作り直される操作（ドラッグで動かす・md を読み直す）で
 *   展開は畳んだ状態に戻る。**これは不具合ではなく上の決定の裏面**である。
 *   直したくなったら、まず「どこに保存するか」を決め直すこと。
 */
const expanded = ref(false)
const showBody = computed(() => !collapsible.value || expanded.value)

/** ラベル 1 行。⚠ 素材が消えていても押せる行が要るので、行方不明にも文字を与える。 */
const MISSING_LABEL = '行方不明のパート'
const label = computed(() => (part.value ? partLabelOf(part.value) : MISSING_LABEL))

/**
 * ⭐ **参照を外す確認**（§1-9-3a「ブラウザ既定の `confirm()` は使わない」）。
 *
 * ⚠⚠ **`App.vue` の確認帯（`pendingAction`）は流用できない。** あちらの入口
 *   `requestDestructive()` は **下書きが空なら聞かずに実行する**（`formDirty` が false なら
 *   素通し）ので、フォームと無関係なこの操作を載せると**確認が黙って飛ぶ**。
 *   → 仕組みは分け、**見た目と語り口だけ揃える**（何が失われるかを先に言う・
 *   「やっぱりやめる」で降りられる）。
 */
const confirming = ref(false)

/**
 * ⚠ 選択が外れたら問いも畳む。残すと「別の場所を触って戻ってきたら、
 *   いつのものか分からない確認が生きている」状態になる
 *   （`App.vue` の `watch(formDirty)` と同じ役目）。
 */
watch(
  () => props.selected,
  (selected) => {
    if (!selected) confirming.value = false
  },
)

/**
 * ⚠⚠ **消すのは本文の参照ノードだけ。素材（パート）には触らない。**
 *   素材ごと消す操作は右ペインにある（§1-11）。ここで両方やると、
 *   「1 箇所から外したつもりが、他の箇所からも消えた」が起きる。
 */
function removeReference() {
  confirming.value = false
  props.deleteNode()
}

/**
 * 画像の実体（Blob）を表示するための一時 URL。
 *
 * ⚠ **必ず解放する。** 解放しないと、画像を差し替えるたびに古い Blob がページの寿命まで残る
 *   （リロードするまで解放されない種類の漏れで、動作では気づけない）。
 *
 * ⚠ **畳んでいるかどうかで発行を切り替えない。** 「本文を出していないなら要らない」は
 *   一見正しいが、畳む・開くのたびに `URL.createObjectURL` と `revoke` が往復し、
 *   `<img>` が差し替わって**画像が毎回チラつく**。持っている数は参照の数だけで増えない。
 */
const imageUrls = ref<string[]>([])
let issuedUrls: string[] = []

function revokeAll() {
  for (const url of issuedUrls) URL.revokeObjectURL(url)
  issuedUrls = []
}

watch(
  body,
  (list) => {
    revokeAll()
    imageUrls.value = list.map((item) => {
      if (item.kind !== 'image') return ''
      const url = URL.createObjectURL(item.image)
      issuedUrls.push(url)
      return url
    })
  },
  { immediate: true },
)

onBeforeUnmount(revokeAll)
</script>

<template>
  <!-- 本文の流れの中で「異物」として見える（CONCEPT Q5）。 -->
  <NodeViewWrapper
    :as="wrapperTag"
    class="part-ref"
    :class="{ 'part-ref--inline': isInline, 'part-ref--block': !isInline }"
    :data-instance-id="instanceId"
    :data-part-id="partId"
  >
    <span class="part-ref__head">
      <!-- ⚠ ラベルは**押しても畳まない**（§1-13-1i）。ここを切り替えの的にすると、
           ノードを選ぶ・掴んで動かす操作と当たる。畳むのはボタンだけの仕事。 -->
      <span v-if="part" class="part-ref__label">{{ label }}</span>
      <!-- S7-2: データ側から消えたパートは、参照だけが残る＝行方不明として見せる -->
      <span v-else class="part-ref__missing">{{ MISSING_LABEL }}</span>

      <!-- ⚠⚠ `mousedown.prevent` が要る。押さないと ProseMirror が mousedown で
           選択を動かし、`v-if="selected"` のボタンが **click が飛ぶ前に消える**
           （＝押しても何も起きないボタンになる）。draggable なノードなので
           ドラッグ開始とも当たる。 -->
      <!-- ⚠⚠ `part` が要る。行方不明のパートには開く中身が無いので、
           ここを `collapsible` だけで出すと**押しても何も起きないボタン**になる
           （このファイルが 2 箇所で禁じている型を、自分で作ることになる）。 -->
      <button
        v-if="collapsible && part"
        type="button"
        class="part-ref__toggle"
        :aria-expanded="expanded"
        @mousedown.prevent.stop
        @click.prevent.stop="expanded = !expanded"
      >
        {{ expanded ? '畳む' : '開く' }}
      </button>
      <button
        v-if="props.selected && !confirming"
        type="button"
        class="part-ref__delete"
        @mousedown.prevent.stop
        @click.prevent.stop="confirming = true"
      >
        参照を外す
      </button>
    </span>

    <!-- ⚠ 何が失われるかを先に言う（「よろしいですか」だけでは判断できない）。
         ⭐ ここで言い切るのが要点——**素材は残る**ことを読めば分かる形にする。 -->
    <span v-if="confirming" class="part-ref__confirm" role="alert">
      <span class="part-ref__confirmText">本文からこの参照を外しますか？（素材は残ります）</span>
      <button
        type="button"
        class="part-ref__confirmYes"
        @mousedown.prevent.stop
        @click.prevent.stop="removeReference"
      >
        外す
      </button>
      <button
        type="button"
        class="part-ref__confirmNo"
        @mousedown.prevent.stop
        @click.prevent.stop="confirming = false"
      >
        やっぱりやめる
      </button>
    </span>

    <span v-if="part && showBody" class="part-ref__body">
      <template v-for="(item, i) in body" :key="i">
        <img
          v-if="item.kind === 'image'"
          class="part-ref__image"
          :src="imageUrls[i]"
          :alt="item.alt"
        />
        <span v-else class="part-ref__text">{{ item.text }}</span>
      </template>
    </span>
  </NodeViewWrapper>
</template>

<style scoped>
.part-ref--inline {
  /* 文の途中に置かれたときに、行の流れを壊さない */
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
}
.part-ref--block .part-ref__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.part-ref--block .part-ref__body {
  display: block;
  margin-top: 0.25rem;
}
/**
 * ⭐⭐ **これが無いと md の改行が畳まれて 1 行に潰れる**（実測 2026-08-27）。
 *   パート本文は liquid が返した md 文字列そのもので、改行は**データ側に在る**
 *   （`# C3: 入場ゲート\n\n…` を実測）。潰していたのは HTML 既定の `white-space` だった。
 */
.part-ref__text {
  white-space: pre-wrap;
}
.part-ref__label {
  font-weight: 600;
}
.part-ref__confirm {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.4rem;
  background: #fff1f0;
  border: 1px solid #f0b7b2;
  font-size: 0.9rem;
}
.part-ref__image {
  max-width: 100%;
  vertical-align: middle;
}
</style>
