<script setup lang="ts">
import { computed, ref } from 'vue'
import { partKeyOf, inlineText, type Part, type PartForm } from '../template/model'

/**
 * 素材一覧（DESIGN-v0.md 1-7-4）。
 *
 * ⚠⚠ **これは導出ビューであって、素材の置き場ではない。**
 *   `parts` は毎回 `derivePartsOf()` から作り直されたもので、このコンポーネントは
 *   1 件も保存しない。保存すると「消したのに一覧に残る／差し替えたのに古い名前が出る」が
 *   構造的に起こりうる（S7-1・P0 知見 1 が両方これを禁じている）。
 *
 * ⚠ 画像もテンプレ由来のパートも **同じ 1 つの一覧**に並ぶ（1-7-1）。
 *   専用の置き場は作らない。絞り込みはフィルタで足りる。
 */
const props = defineProps<{
  parts: Part[]
  /** まだ本文に置かれていないパートのキー（`analyzePlacement().unplaced` 由来） */
  unplacedKeys: string[]
}>()

const emit = defineEmits<{
  (e: 'addImage'): void
  (e: 'insert', part: Part): void
  (e: 'replace', part: Part): void
  (e: 'remove', part: Part): void
}>()

/**
 * 形態の**表示名**。
 *
 * ⚠⚠ 識別子（`PartForm` の値）は英語だが、**画面に出る文字は日本語のまま**（§1-8-1）。
 *   この対応表が無いと、値の英語化がそのまま利用者の目に出てしまう。
 *   置き場が UI 層なのは、表示名は表示する側の持ち物だから（テンプレ層は表示を知らない）。
 */
const FORM_LABELS: Record<PartForm, string> = {
  section: '独立章',
  inline: '本文中',
  figure: '図',
}

const onlyUnplaced = ref(false)

const unplacedSet = computed(() => new Set(props.unplacedKeys))

function isUnplaced(part: Part): boolean {
  return unplacedSet.value.has(partKeyOf(part.instanceId, part.partId))
}

const visibleParts = computed(() =>
  onlyUnplaced.value ? props.parts.filter(isUnplaced) : props.parts,
)
</script>

<template>
  <aside class="materials" aria-label="素材">
    <div class="materials__head">
      <!-- ⚠ 利用者にテンプレートであることを見せない（1-7-2）。中では普通のインスタンスが 1 件できる。 -->
      <button type="button" @click="emit('addImage')">素材を追加（画像）</button>
      <!-- S7-1: 数字だけを常時見せる。専用の置き場は作らない -->
      <p class="materials__count">未配置 {{ unplacedKeys.length }} 件</p>
      <label class="materials__filter">
        <input v-model="onlyUnplaced" type="checkbox" />
        onlyUnplaced
      </label>
    </div>
    <p v-if="visibleParts.length === 0" class="materials__empty">素材はまだありません</p>
    <ul v-else class="materials__list">
      <li
        v-for="part in visibleParts"
        :key="partKeyOf(part.instanceId, part.partId)"
        class="materials__item"
        :data-part-key="partKeyOf(part.instanceId, part.partId)"
        :data-unplaced="isUnplaced(part) ? 'true' : 'false'"
      >
        <span class="materials__title">{{ part.title }}</span>
        <span class="materials__form">{{ FORM_LABELS[part.form] }}</span>
        <span class="materials__note">{{ inlineText(part.body) }}</span>
        <button type="button" @click="emit('insert', part)">本文へ挿入</button>
        <!-- ⚠ 差し替えは**本文に触らない**。置かれている全箇所が同時に変わる（S7-3） -->
        <button type="button" @click="emit('replace', part)">差し替え</button>
        <button type="button" @click="emit('remove', part)">消す</button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.materials {
  padding: 0.5rem;
  overflow-y: auto;
  font-size: 0.9rem;
}
.materials__head {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.materials__count {
  margin: 0;
  color: #555;
}
.materials__empty {
  color: #888;
}
.materials__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.materials__item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
  padding: 0.25rem;
  border-top: 1px solid #eee;
}
.materials__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.materials__form,
.materials__note {
  font-size: 0.7rem;
  color: #666;
}
.materials__item[data-unplaced='true'] .materials__title {
  font-weight: 600;
}
</style>
