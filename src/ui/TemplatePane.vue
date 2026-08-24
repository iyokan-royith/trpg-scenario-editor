<script setup lang="ts">
import { ref } from 'vue'
import type { TemplateDefinition } from '../template/model'
import TemplateForm from './TemplateForm.vue'

/**
 * テンプレート一覧（DESIGN-v0.md §4 の P2 完了条件 #1・1-7-1 の「テンプレート一覧」）。
 *
 * ⚠ **同梱もユーザー持ち込みも同じ 1 つの一覧に並ぶ**（Q6）。ここは受け取った定義を出すだけで、
 *   「どれが同梱か」を知らない——知ってしまうと、同梱品だけ特別な経路を通せるようになる。
 *
 * ⚠ 素材一覧（`MaterialPane.vue`）とは**層が違う**（1-7-1）。
 *   こちらは「何を作れるか」＝定義の一覧、あちらは「何が置けるか」＝パートの一覧。
 */
defineProps<{ definitions: TemplateDefinition[] }>()
const emit = defineEmits<{ create: [templateId: string, data: Record<string, unknown>] }>()

const selected = ref<TemplateDefinition | null>(null)

function onSave(data: Record<string, unknown>) {
  const def = selected.value
  if (!def) return
  emit('create', def.id, data)
  selected.value = null
}
</script>

<template>
  <section class="tpane">
    <h2 class="tpane__title">テンプレート</h2>
    <p v-if="definitions.length === 0" class="tpane__empty">テンプレートがありません</p>
    <ul v-else class="tpane__list">
      <li v-for="def in definitions" :key="def.id">
        <button
          type="button"
          class="tpane__item"
          :class="{ 'tpane__item--selected': selected?.id === def.id }"
          @click="selected = def"
        >
          {{ def.name }}
        </button>
      </li>
    </ul>
    <TemplateForm
      v-if="selected"
      :def="selected"
      @save="onSave"
      @cancel="selected = null"
    />
  </section>
</template>

<style scoped>
.tpane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.tpane__title {
  font-size: 0.9rem;
  margin: 0;
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
}
.tpane__empty {
  padding: 0.5rem;
  font-size: 0.85rem;
  color: #777;
}
.tpane__list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
}
.tpane__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.3rem 0.4rem;
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
}
.tpane__item--selected {
  border-color: #2b6cb0;
  background: #f4f8fd;
}
</style>
