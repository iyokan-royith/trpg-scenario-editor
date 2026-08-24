<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TemplateDefinition } from '../template/model'
import { createDraft, pruneEmpty } from '../template/form'
import FieldEditor from './FieldEditor.vue'

/**
 * テンプレ定義の `fields` からフォームを組み立てる（DESIGN-v0.md §2 / §4 の P2 完了条件 #2）。
 *
 * ⚠ 型ごとの分岐は 1 つも持たない。**それは `FieldEditor.vue` の責務**で、
 *   ここは「下書きを作る・保存する・やめる」だけを持つ。
 */
const props = defineProps<{ def: TemplateDefinition }>()
const emit = defineEmits<{ save: [data: Record<string, unknown>]; cancel: [] }>()

const draft = ref<Record<string, unknown>>(createDraft(props.def.fields))

// ⚠ 別のテンプレを選び直したら下書きを作り直す。
//   使い回すと、前のテンプレの値が新しい定義に混ざったまま保存される。
watch(
  () => props.def.id,
  () => {
    draft.value = createDraft(props.def.fields)
  },
)

function onSubmit() {
  // ⚠ 空欄は書かない（`pruneEmpty` の理由を参照）。ここで下書きをそのまま渡すと、
  //   「入力していない」が「空文字が入力された」として保存される。
  emit('save', pruneEmpty(props.def.fields, draft.value))
}
</script>

<template>
  <form class="tform" @submit.prevent="onSubmit">
    <h3 class="tform__title">{{ def.name }}</h3>
    <FieldEditor
      v-for="field in def.fields"
      :key="field.key"
      :field="field"
      :modelValue="draft[field.key]"
      @update:modelValue="(value: unknown) => (draft[field.key] = value)"
    />
    <div class="tform__actions">
      <button type="submit">保存して素材にする</button>
      <button type="button" @click="emit('cancel')">やめる</button>
    </div>
  </form>
</template>

<style scoped>
.tform {
  padding: 0.5rem;
  border-top: 1px solid #ddd;
}
.tform__title {
  font-size: 0.9rem;
  margin: 0 0 0.4rem;
}
.tform__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
</style>
