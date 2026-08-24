<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CenterTab } from './centerTabs'

/**
 * 中央ペインのタブの器（DESIGN-v0.md §1-9）。
 *
 * ⚠⚠ **中身は `v-show` で保持する。`v-if` で外さない**（§1-9-2 の表）。
 *   外すと component が捨てられ、**打ちかけの下書きが本当に消える**——
 *   すなわち「消えちゃった！」を防ぐために作った器が、その現象そのものを実現してしまう。
 *   ⚠ 本文側も同じ（Tiptap を作り直すとスクロール位置と再アタッチの挙動が変わる）。
 *
 * ⚠ **タブが `tabs` から消えたときだけ中身が捨てられる**（＝閉じる操作）。
 *   これは正しい挙動で、上の禁止は**切り替え**に対するもの。
 *
 * ⚠ ここは「何のタブか」を知らない。本文もフォームも同じ扱いで、
 *   中身は名前付きスロット（`id` と同名）で外から差し込む。
 */
const props = defineProps<{ tabs: CenterTab[]; activeId: string }>()
const emit = defineEmits<{ select: [tabId: string]; close: [tabId: string] }>()

/**
 * ✕ を押したが、下書きが残っているので一度確認している最中のタブ（§1-9-2「✕ は下書きが
 * 残っていれば一度確認する」）。
 *
 * ⚠ ブラウザ既定の `confirm()` は使わない。このアプリは知らせを画面内の帯で出しており
 *   （`app__notice`）、ここだけ OS の窓を開くと**止まったときに何が出るか**が別物になる。
 */
const closeConfirmId = ref<string | null>(null)

/**
 * 確認中のタブが消えた／下書きが空になったら、問いも畳む。
 * ⚠ 残すと「もう無いものを捨てますか」と聞き続ける（押しても何も起きないボタンになる）。
 */
watch(
  () => props.tabs,
  (tabs) => {
    const target = tabs.find((tab) => tab.id === closeConfirmId.value)
    if (!target || !target.dirty) closeConfirmId.value = null
  },
  { deep: true },
)

const confirmingLabel = computed(
  () => props.tabs.find((tab) => tab.id === closeConfirmId.value)?.label ?? '',
)

function onCloseClick(tab: CenterTab) {
  // ⚠ 下書きが無いときは聞かない。毎回聞くと問いが読まれなくなる。
  if (!tab.dirty) {
    emit('close', tab.id)
    return
  }
  closeConfirmId.value = tab.id
}

function onConfirmClose() {
  const tabId = closeConfirmId.value
  closeConfirmId.value = null
  if (tabId !== null) emit('close', tabId)
}
</script>

<template>
  <div class="tabs">
    <div class="tabs__bar" role="tablist">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tabs__tab"
        :class="{ 'tabs__tab--active': tab.id === activeId }"
      >
        <button
          type="button"
          role="tab"
          class="tabs__label"
          :aria-selected="tab.id === activeId"
          @click="emit('select', tab.id)"
        >
          <!-- ⚠ 印は文字（`●`）だけだと読み上げに何も伝わらないので名前を付ける -->
          <span v-if="tab.dirty" class="tabs__dirty" aria-label="未保存">●</span>
          <!-- ⚠ 名前は独立した要素にしておく（印と混ざった 1 つの文字列にしない）。 -->
          <span class="tabs__name">{{ tab.label }}</span>
        </button>
        <button
          v-if="tab.closable"
          type="button"
          class="tabs__close"
          :aria-label="`「${tab.label}」を閉じる`"
          @click="onCloseClick(tab)"
        >
          ✕
        </button>
      </div>
    </div>
    <p v-if="closeConfirmId !== null" class="tabs__confirm" role="alert">
      <span class="tabs__confirmText"
        >「{{ confirmingLabel }}」には打ちかけの内容があります。捨てて閉じますか？</span
      >
      <button type="button" class="tabs__confirmYes" @click="onConfirmClose">捨てて閉じる</button>
      <button type="button" class="tabs__confirmNo" @click="closeConfirmId = null">
        閉じるのをやめる
      </button>
    </p>
    <!-- ⚠⚠ `v-show`。ここを `v-if` にすると下書きが消える（このファイルの冒頭を読むこと） -->
    <div
      v-for="tab in tabs"
      v-show="tab.id === activeId"
      :key="tab.id"
      class="tabs__panel"
      role="tabpanel"
    >
      <slot :name="tab.id" />
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.tabs__bar {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem 0;
  border-bottom: 1px solid #ddd;
}
.tabs__tab {
  display: flex;
  align-items: center;
  border: 1px solid #ddd;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: #f6f6f6;
}
.tabs__tab--active {
  background: #fff;
  border-color: #2b6cb0;
}
.tabs__label {
  padding: 0.3rem 0.6rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
}
.tabs__dirty {
  color: #c05621;
  font-size: 0.7rem;
  vertical-align: middle;
}
.tabs__close {
  padding: 0.1rem 0.4rem;
  margin-right: 0.2rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #666;
}
.tabs__confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.3rem 0.6rem;
  background: #fff1f0;
  border-bottom: 1px solid #f0b7b2;
  font-size: 0.85rem;
}
.tabs__panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
