<script setup lang="ts">
import { computed, ref } from 'vue'
import { flattenOutline, type OutlineItem } from '../document/outline'
import { MAX_LEVEL, MIN_LEVEL } from '../document/heading'

/**
 * 左ペインの見出しツリー。
 *
 * ⚠ このコンポーネントは **状態を持たない**。items は毎回 doc から導出されたもので、
 *   並べ替えは「doc を動かしてください」と親へ投げるだけ（DESIGN 1-2）。
 *
 * ⚠ **どこに挿さるか（ガイド）も自分では決めない**。親が `dropTargetPos()` で出した
 *   結果を受け取って描くだけ。判定とガイドが別々の規則を持つと、
 *   **見えている線と実際の着地がずれる**（要望3・2026-08-23）。
 */
const props = defineProps<{
  items: OutlineItem[]
  /** ガイド線を引く場所。項目の pos か、末尾を示す 'end'。null なら描かない */
  guide?: number | 'end' | null
}>()

const emit = defineEmits<{
  /**
   * 「掴んだ項目を、落とした先の項目の場所へ」。
   * ⚠ ここは doc の挿入位置を計算しない（それは document 層の仕事）。
   *   このペインが知っているのは「どれを、どれの所へ落としたか」だけ。
   */
  (e: 'move', payload: { grabbed: number; droppedOn: number }): void
  (e: 'changeLevel', payload: { pos: number; level: number }): void
  (e: 'select', pos: number): void
  /** ドラッグ中に、いまどれの上に居るか（ガイドを出すため） */
  (e: 'dragOver', payload: { grabbed: number; over: number }): void
  (e: 'dragEnd'): void
}>()

const flat = computed(() => flattenOutline(props.items))
const grabbedPos = ref<number | null>(null)

function grab(item: OutlineItem) {
  grabbedPos.value = item.pos
}

function onDragOver(item: OutlineItem) {
  const grabbed = grabbedPos.value
  if (grabbed === null || grabbed === item.pos) return
  emit('dragOver', { grabbed, over: item.pos })
}

function drop(item: OutlineItem) {
  const grabbed = grabbedPos.value
  grabbedPos.value = null
  emit('dragEnd')
  if (grabbed === null || grabbed === item.pos) return
  emit('move', { grabbed, droppedOn: item.pos })
}

function cancel() {
  grabbedPos.value = null
  emit('dragEnd')
}

/** 上限・下限に達している向きのボタンは押せなくする（要望4）。 */
function canPromote(item: OutlineItem) {
  return item.kind === 'heading' && item.level > MIN_LEVEL
}
function canDemote(item: OutlineItem) {
  return item.kind === 'heading' && item.level < MAX_LEVEL
}
</script>

<template>
  <nav class="outline" aria-label="見出し" @dragend="cancel">
    <p v-if="flat.length === 0" class="outline__empty">見出しはまだありません</p>
    <ul v-else class="outline__list">
      <li
        v-for="item in flat"
        :key="item.pos"
        class="outline__item"
        :class="[
          `outline__item--depth${item.level}`,
          { 'outline__item--guide': guide === item.pos },
        ]"
        :data-kind="item.kind"
        :data-level="item.level"
        draggable="true"
        @dragstart="grab(item)"
        @dragover.prevent="onDragOver(item)"
        @drop.prevent="drop(item)"
        @click="emit('select', item.pos)"
      >
        <span class="outline__title">{{ item.title || '（無題）' }}</span>
        <span v-if="item.kind === 'partRef'" class="outline__badge">パート</span>
        <span v-else class="outline__tools">
          <button
            type="button"
            title="階層を上げる"
            :disabled="!canPromote(item)"
            @click.stop="emit('changeLevel', { pos: item.pos, level: item.level - 1 })"
          >
            ←
          </button>
          <button
            type="button"
            title="階層を下げる"
            :disabled="!canDemote(item)"
            @click.stop="emit('changeLevel', { pos: item.pos, level: item.level + 1 })"
          >
            →
          </button>
        </span>
      </li>
      <li v-if="guide === 'end'" class="outline__end-guide" aria-hidden="true"></li>
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
  /* ガイド線の分の場所を先に取っておく（線が出た時に行がずれない） */
  border-top: 2px solid transparent;
}
.outline__item:hover {
  background: #eee;
}
/* 要望3: ここに挿さる、という予告。判定（dropTargetPos）と同じ値から出している */
.outline__item--guide {
  border-top-color: #2b6cb0;
}
.outline__end-guide {
  height: 0;
  border-top: 2px solid #2b6cb0;
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
/* 上限・下限に達している向きは押せない＝「達している」ことを見た目で伝える */
.outline__tools button:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
