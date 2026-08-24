<script setup lang="ts">
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
defineProps<{ tabs: CenterTab[]; activeId: string }>()
const emit = defineEmits<{ select: [tabId: string]; close: [tabId: string] }>()

function onCloseClick(tab: CenterTab) {
  // ⚠⚠ **ここでは確認しない。** 下書きを失う操作の確認は `App.vue` が 1 箇所で持つ
  //   （§1-9-3a: ✕ ／別のテンプレを選び直す ／やめる の 3 経路で同じ規則）。
  //   器の側に持たせると、器を通らない経路（選び直し）だけ規則から漏れる——
  //   実際それが台帳 A55 として見つかった穴だった。
  emit('close', tab.id)
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
.tabs__panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
