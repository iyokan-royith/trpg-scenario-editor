<script setup lang="ts">
import { computed, ref } from 'vue'
import { partKeyOf, インラインの文, type Part } from '../template/model'

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
  未配置キー: string[]
}>()

const emit = defineEmits<{
  (e: '画像を追加'): void
  (e: '挿入', part: Part): void
  (e: '削除', part: Part): void
}>()

const 未配置だけ = ref(false)

const 未配置の集合 = computed(() => new Set(props.未配置キー))

function 未配置か(part: Part): boolean {
  return 未配置の集合.value.has(partKeyOf(part.instanceId, part.partId))
}

const 表示する一覧 = computed(() => (未配置だけ.value ? props.parts.filter(未配置か) : props.parts))
</script>

<template>
  <aside class="materials" aria-label="素材">
    <div class="materials__head">
      <!-- ⚠ 利用者にテンプレートであることを見せない（1-7-2）。中では普通のインスタンスが 1 件できる。 -->
      <button type="button" @click="emit('画像を追加')">素材を追加（画像）</button>
      <!-- S7-1: 数字だけを常時見せる。専用の置き場は作らない -->
      <p class="materials__count">未配置 {{ 未配置キー.length }} 件</p>
      <label class="materials__filter">
        <input v-model="未配置だけ" type="checkbox" />
        未配置だけ
      </label>
    </div>
    <p v-if="表示する一覧.length === 0" class="materials__empty">素材はまだありません</p>
    <ul v-else class="materials__list">
      <li
        v-for="part in 表示する一覧"
        :key="partKeyOf(part.instanceId, part.partId)"
        class="materials__item"
        :data-part-key="partKeyOf(part.instanceId, part.partId)"
        :data-unplaced="未配置か(part) ? 'true' : 'false'"
      >
        <span class="materials__title">{{ part.title }}</span>
        <span class="materials__form">{{ part.form }}</span>
        <span class="materials__note">{{ インラインの文(part.body) }}</span>
        <button type="button" @click="emit('挿入', part)">本文へ挿入</button>
        <button type="button" @click="emit('削除', part)">消す</button>
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
