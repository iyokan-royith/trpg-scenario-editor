<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TemplateDefinition } from '../template/model'
import { createDraft, isDraftDirty, pruneEmpty, validateDraft } from '../template/form'
import FieldEditor from './FieldEditor.vue'

/**
 * テンプレ定義の `fields` からフォームを組み立てる（DESIGN-v0.md §2 / §4 の P2 完了条件 #2）。
 *
 * ⚠ 型ごとの分岐は 1 つも持たない。**それは `FieldEditor.vue` の責務**で、
 *   ここは「下書きを作る・保存する・やめる」だけを持つ。
 */
const props = defineProps<{ def: TemplateDefinition }>()
const emit = defineEmits<{
  save: [data: Record<string, unknown>]
  cancel: []
  /**
   * 下書きに値が入っているか（§1-9-2 の未保存の印）。
   * ⚠ タブの印を出すのは**器の側**なので、ここは「打ちかけかどうか」だけを外へ出す。
   */
  'update:dirty': [dirty: boolean]
}>()

const draft = ref<Record<string, unknown>>(createDraft(props.def.fields))
/** 直前の保存操作で見つかった誤り（§1-3-1 決定 4）。空なら何も出さない。 */
const errors = ref<string[]>([])

// ⚠ 別のテンプレを選び直したら下書きを作り直す。
//   使い回すと、前のテンプレの値が新しい定義に混ざったまま保存される。
watch(
  () => props.def.id,
  () => {
    draft.value = createDraft(props.def.fields)
    errors.value = []
  },
)

/**
 * ⚠ `immediate: true` にしてある。**mount した瞬間に 1 度出す**のが要点で、
 *   これが無いと「保存でタブが閉じる → 別のテンプレを選び直す」ときに
 *   **前の下書きの印が残ったまま**になる（閉じるときは destroy されるので emit が来ない）。
 */
const dirty = computed(() => isDraftDirty(props.def.fields, draft.value))
watch(dirty, (value) => emit('update:dirty', value), { immediate: true })

function onSubmit() {
  // ⚠⚠ **保存の手前で弾く**（§1-3-1 決定 4）。黙って切り捨てない。
  //   ⚠ フォームは閉じない・下書きも捨てない——打った値を失わせずに直せるようにする。
  errors.value = validateDraft(props.def.fields, draft.value)
  if (errors.value.length > 0) return
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
    <!-- ⚠ 誤りは**保存ボタンのすぐ上**に出す。欄の脇に散らすと、
         入れ子や配列の奥に隠れて「押しても何も起きない」に見える。 -->
    <ul v-if="errors.length > 0" class="tform__errors" role="alert">
      <li v-for="message in errors" :key="message">{{ message }}</li>
    </ul>
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
.tform__errors {
  margin: 0.6rem 0 0;
  padding: 0.4rem 0.6rem 0.4rem 1.4rem;
  background: #fff1f0;
  border: 1px solid #f0b7b2;
  color: #8a1f11;
  font-size: 0.85rem;
}
.tform__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
</style>
