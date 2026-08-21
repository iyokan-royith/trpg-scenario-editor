<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { usePartStore } from './partStore'

const props = defineProps(nodeViewProps)
const store = usePartStore()

const instanceId = computed(() => String(props.node.attrs.instanceId))
const partId = computed(() => String(props.node.attrs.partId))
const part = computed(() => store.findPart(instanceId.value, partId.value))
</script>

<template>
  <!-- スタブ表示。本文の流れの中で「異物」として見える（CONCEPT Q5）。 -->
  <NodeViewWrapper class="part-ref" :data-instance-id="instanceId" :data-part-id="partId">
    <template v-if="part">
      <span class="part-ref__title">{{ part.title }}</span>
      <span class="part-ref__body">{{ part.body }}</span>
    </template>
    <template v-else>
      <!-- S7-2: データ側から消えたパートは、参照だけが残る＝行方不明として見せる -->
      <span class="part-ref__missing">行方不明のパート</span>
    </template>
  </NodeViewWrapper>
</template>
