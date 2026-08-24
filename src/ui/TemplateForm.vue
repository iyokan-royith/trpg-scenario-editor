<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TemplateDefinition } from '../template/model'
import {
  collectImages,
  createDraft,
  isDraftDirty,
  isSameDraft,
  pruneEmpty,
  validateDraft,
} from '../template/form'
import FieldEditor from './FieldEditor.vue'

/**
 * テンプレ定義の `fields` からフォームを組み立てる（DESIGN-v0.md §2 / §4 の P2 完了条件 #2）。
 *
 * ⚠ 型ごとの分岐は 1 つも持たない。**それは `FieldEditor.vue` の責務**で、
 *   ここは「下書きを作る・保存する・やめる」だけを持つ。
 */
const props = defineProps<{
  def: TemplateDefinition
  /**
   * ⭐ 生成済み素材を**編集**で開くときの初期値（§1-11-2）。
   * ⚠ 無ければ新規作成（空の下書きから始まる）。
   * ⚠⚠ **これが有るかどうかで「打ちかけ」の意味が変わる**（下の `dirty` を参照）。
   */
  initialDraft?: Record<string, unknown> | null
}>()
const emit = defineEmits<{
  /**
   * ⚠ **画像の実体（`images`）は `data` と別に渡す**（§1-4: 実体は `TemplateInstance.images`）。
   *   `data` に混ぜると、Blob が md 展開・zip 出力・保存のすべてに紛れ込む。
   */
  save: [data: Record<string, unknown>, images: Record<string, Blob>]
  cancel: []
  /**
   * 下書きに値が入っているか（§1-9-2 の未保存の印）。
   * ⚠ タブの印を出すのは**器の側**なので、ここは「打ちかけかどうか」だけを外へ出す。
   */
  'update:dirty': [dirty: boolean]
}>()

/** ⭐ 編集で開いたか（＝生成済み素材の上書き）。⚠ 文言と「打ちかけ」の意味がこれで変わる。 */
const editing = props.initialDraft != null
/**
 * ⚠ 比較用に**開いた時の姿**を取っておく（編集の「打ちかけ」はここからの差分）。
 *
 * ⚠⚠ **浅い複製で足りるし、浅くなければならない。**
 *   入れ子の値は `FieldEditor` が**新しいオブジェクトを作って**返す（その場で書き換えない）ので、
 *   浅い複製でも比較が壊れない。
 *   ⚠ 逆に `structuredClone()` を使うと**画像の Blob が別オブジェクトになり**、
 *   `isSameDraft()` が同一性で見るため**開いた瞬間から「変更済み」**になる
 *   （＝画像を持つ素材を開いただけで確認が出る）。
 */
const openedWith = props.initialDraft ? { ...props.initialDraft } : null
const draft = ref<Record<string, unknown>>(
  props.initialDraft ? { ...props.initialDraft } : createDraft(props.def.fields),
)
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
/**
 * ⚠⚠ **新規と編集で「打ちかけ」の意味が違う**（§1-11）。
 *   新規＝空と違うか／**編集＝開いた時と違うか**。
 *   ⚠ 編集で `isDraftDirty()` を使うと**開いた瞬間から印が点きっぱなし**になり、
 *   何も触っていないのに確認が出る＝**確認が読まずに押すものになる**。
 */
const dirty = computed(() =>
  openedWith ? !isSameDraft(draft.value, openedWith) : isDraftDirty(props.def.fields, draft.value),
)
watch(dirty, (value) => emit('update:dirty', value), { immediate: true })

function onSubmit() {
  // ⚠⚠ **保存の手前で弾く**（§1-3-1 決定 4）。黙って切り捨てない。
  //   ⚠ フォームは閉じない・下書きも捨てない——打った値を失わせずに直せるようにする。
  errors.value = validateDraft(props.def.fields, draft.value)
  if (errors.value.length > 0) return
  // ⚠ 空欄は書かない（`pruneEmpty` の理由を参照）。ここで下書きをそのまま渡すと、
  //   「入力していない」が「空文字が入力された」として保存される。
  emit(
    'save',
    pruneEmpty(props.def.fields, draft.value),
    collectImages(props.def.fields, draft.value),
  )
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
      <!-- ⚠ 文言は契約（§1-10）。新規と編集で違う——「素材にする」のは新規のときだけ -->
      <button type="submit">{{ editing ? '保存する' : '保存して素材にする' }}</button>
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
