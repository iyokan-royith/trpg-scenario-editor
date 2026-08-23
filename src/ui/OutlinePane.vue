<script setup lang="ts">
import { computed, ref } from 'vue'
import { flattenOutline, type OutlineItem } from '../document/outline'

/**
 * 左ペインの見出しツリー。
 *
 * ⚠ このコンポーネントは **状態を持たない**。items は毎回 doc から導出されたもので、
 *   並べ替えは「doc を動かしてください」と親へ投げるだけ（DESIGN 1-2）。
 */
const props = defineProps<{ items: OutlineItem[] }>()

const emit = defineEmits<{
  (e: '移動', payload: { from: number; to: number }): void
  (e: '階層変更', payload: { pos: number; level: number }): void
  (e: '選択', pos: number): void
}>()

const flat = computed(() => flattenOutline(props.items))
const つかんでいる位置 = ref<number | null>(null)

function つかむ(item: OutlineItem) {
  つかんでいる位置.value = item.pos
}

function 落とす(item: OutlineItem) {
  const from = つかんでいる位置.value
  つかんでいる位置.value = null
  if (from === null || from === item.pos) return
  emit('移動', { from, to: item.pos })
}
</script>

<template>
  <nav class="outline" aria-label="見出し">
    <p v-if="flat.length === 0" class="outline__empty">見出しはまだありません</p>
    <ul v-else class="outline__list">
      <li
        v-for="item in flat"
        :key="item.pos"
        class="outline__item"
        :class="`outline__item--depth${item.level}`"
        :data-kind="item.kind"
        :data-level="item.level"
        draggable="true"
        @dragstart="つかむ(item)"
        @dragover.prevent
        @drop.prevent="落とす(item)"
        @click="emit('選択', item.pos)"
      >
        <span class="outline__title">{{ item.title || '（無題）' }}</span>
        <span v-if="item.kind === 'パート参照'" class="outline__badge">パート</span>
        <span v-else class="outline__tools">
          <button
            type="button"
            title="階層を上げる"
            @click.stop="emit('階層変更', { pos: item.pos, level: item.level - 1 })"
          >
            ←
          </button>
          <button
            type="button"
            title="階層を下げる"
            @click.stop="emit('階層変更', { pos: item.pos, level: item.level + 1 })"
          >
            →
          </button>
        </span>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.outline {
  padding: 0.5rem;
  overflow-y: auto;
}
.outline__empty {
  color: #888;
  font-size: 0.9rem;
}
.outline__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.outline__item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.25rem;
  cursor: grab;
  border-radius: 3px;
}
.outline__item:hover {
  background: #eee;
}
.outline__item--depth2 {
  padding-left: 1rem;
}
.outline__item--depth3 {
  padding-left: 2rem;
}
.outline__item--depth4 {
  padding-left: 3rem;
}
.outline__item--depth5 {
  padding-left: 4rem;
}
.outline__item--depth6 {
  padding-left: 5rem;
}
.outline__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outline__badge {
  font-size: 0.7rem;
  color: #666;
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 0 0.25rem;
}
.outline__tools button {
  font-size: 0.7rem;
  line-height: 1;
  padding: 0.1rem 0.25rem;
}
</style>
