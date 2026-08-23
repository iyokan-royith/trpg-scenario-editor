<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { usePartStore } from '../store/partStore'
import { PART_REF_INLINE_NODE } from './partRefExtension'
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
const wrapperTag = computed(() => (props.node.type.name === PART_REF_INLINE_NODE ? 'span' : 'div'))

/**
 * 画像の実体（Blob）を表示するための一時 URL。
 *
 * ⚠ **必ず解放する。** 解放しないと、画像を差し替えるたびに古い Blob がページの寿命まで残る
 *   （リロードするまで解放されない種類の漏れで、動作では気づけない）。
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
    :class="{ 'part-ref--inline': wrapperTag === 'span' }"
    :data-instance-id="instanceId"
    :data-part-id="partId"
  >
    <template v-if="part">
      <span class="part-ref__title">{{ part.title }}</span>
      <span class="part-ref__body">
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
    </template>
    <template v-else>
      <!-- S7-2: データ側から消えたパートは、参照だけが残る＝行方不明として見せる -->
      <span class="part-ref__missing">行方不明のパート</span>
    </template>
  </NodeViewWrapper>
</template>

<style scoped>
.part-ref--inline {
  /* 文の途中に置かれたときに、行の流れを壊さない */
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
}
.part-ref__image {
  max-width: 100%;
  vertical-align: middle;
}
</style>
