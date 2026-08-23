<script setup lang="ts">
import { computed, ref } from 'vue'
import { flattenOutline, type OutlineItem } from '../document/outline'
import { 最大レベル, 最小レベル } from '../document/heading'

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
  /** ガイド線を引く場所。項目の pos か、末尾を示す 'まつび'。null なら描かない */
  ガイド?: number | 'まつび' | null
}>()

const emit = defineEmits<{
  /**
   * 「掴んだ項目を、落とした先の項目の場所へ」。
   * ⚠ ここは doc の挿入位置を計算しない（それは document 層の仕事）。
   *   このペインが知っているのは「どれを、どれの所へ落としたか」だけ。
   */
  (e: '移動', payload: { 掴んだ: number; 落とした先: number }): void
  (e: '階層変更', payload: { pos: number; level: number }): void
  (e: '選択', pos: number): void
  /** ドラッグ中に、いまどれの上に居るか（ガイドを出すため） */
  (e: 'ドラッグ中', payload: { 掴んだ: number; 上に居る: number }): void
  (e: 'ドラッグ終了'): void
}>()

const flat = computed(() => flattenOutline(props.items))
const つかんでいる位置 = ref<number | null>(null)

function つかむ(item: OutlineItem) {
  つかんでいる位置.value = item.pos
}

function 上を通る(item: OutlineItem) {
  const 掴んだ = つかんでいる位置.value
  if (掴んだ === null || 掴んだ === item.pos) return
  emit('ドラッグ中', { 掴んだ, 上に居る: item.pos })
}

function 落とす(item: OutlineItem) {
  const 掴んだ = つかんでいる位置.value
  つかんでいる位置.value = null
  emit('ドラッグ終了')
  if (掴んだ === null || 掴んだ === item.pos) return
  emit('移動', { 掴んだ, 落とした先: item.pos })
}

function やめる() {
  つかんでいる位置.value = null
  emit('ドラッグ終了')
}

/** 上限・下限に達している向きのボタンは押せなくする（要望4）。 */
function 上げられるか(item: OutlineItem) {
  return item.kind === '見出し' && item.level > 最小レベル
}
function 下げられるか(item: OutlineItem) {
  return item.kind === '見出し' && item.level < 最大レベル
}
</script>

<template>
  <nav class="outline" aria-label="見出し" @dragend="やめる">
    <p v-if="flat.length === 0" class="outline__empty">見出しはまだありません</p>
    <ul v-else class="outline__list">
      <li
        v-for="item in flat"
        :key="item.pos"
        class="outline__item"
        :class="[
          `outline__item--depth${item.level}`,
          { 'outline__item--guide': ガイド === item.pos },
        ]"
        :data-kind="item.kind"
        :data-level="item.level"
        draggable="true"
        @dragstart="つかむ(item)"
        @dragover.prevent="上を通る(item)"
        @drop.prevent="落とす(item)"
        @click="emit('選択', item.pos)"
      >
        <span class="outline__title">{{ item.title || '（無題）' }}</span>
        <span v-if="item.kind === 'パート参照'" class="outline__badge">パート</span>
        <span v-else class="outline__tools">
          <button
            type="button"
            title="階層を上げる"
            :disabled="!上げられるか(item)"
            @click.stop="emit('階層変更', { pos: item.pos, level: item.level - 1 })"
          >
            ←
          </button>
          <button
            type="button"
            title="階層を下げる"
            :disabled="!下げられるか(item)"
            @click.stop="emit('階層変更', { pos: item.pos, level: item.level + 1 })"
          >
            →
          </button>
        </span>
      </li>
      <li v-if="ガイド === 'まつび'" class="outline__末尾ガイド" aria-hidden="true"></li>
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
.outline__末尾ガイド {
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
