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

/**
 * ⭐⭐ **本文に置いた素材の行に付ける印**（§1-3-3e 要望A・2026-08-24 実機フィードバック）。
 *
 * 本人:「**章として独立して扱うのかどうかわかりづらい**」。
 * ⚠⚠ **区別が付かないのではなく、印が無い**——`outline.ts` の `placeRef` は
 *   `form: 'section'` のパートしかツリーに出さないので、**ここに出ている参照は例外なく「章として扱うもの」**。
 *   ⚠ だから**色を2種類作る余地は無い**（ブロック／インラインの素材は、そもそもこのツリーに現れない）。
 *
 * ⚠ **色だけに依存しない**（本人の案は薄い背景だが、それだけだと見分けの手段が1つしか無い）。
 *   **文言（`素材の章`）・クラス（`outline__item--part`）・`data-kind` の3つ**で区別できるようにする。
 */
const PART_BADGE_LABEL = '素材の章'

/**
 * ⚠⚠ **階層移動のやじるしは出せない**（本人の要望だが、設計上できない）。
 *   §1-6-3 の決定により **`partRef` の深さは保存されず、「どこに置いたか」から毎回導出される**——
 *   ⭐ 同じ素材を2箇所に置いたとき、両者が別の深さになれるのはこの向きだから（S7-3）。
 *   → やじるしを付けると**押しても何も起きないか、データに無い深さを書き込む**ことになる。
 *   → **出せない代わりに「何が深さを決めているか」をここで言う。**
 *   ⚠ 本当に階層を動かす操作（別の見出しの下へ**移す**）は別設計。
 */
const PART_BADGE_TITLE = '本文に置いた素材です。章として扱われ、深さは置いた場所（囲っている見出しの1つ下）で決まります'
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
          {
            'outline__item--guide': guide === item.pos,
            // ⭐ 章として扱う素材の行（§1-3-3e 要望A）。⚠ 色は手段の1つで、単独では頼らない
            'outline__item--part': item.kind === 'partRef',
          },
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
        <!-- ⚠ 文言は契約（テストが文字列で当てている）。「パート」は種別を何も言っていなかった -->
        <span v-if="item.kind === 'partRef'" class="outline__badge" :title="PART_BADGE_TITLE">
          {{ PART_BADGE_LABEL }}
        </span>
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
/* 要望A: 章として扱う素材の行（本人の案＝うすい背景）。⚠ 見分けはこの色だけに依存させない */
.outline__item--part {
  background: #eef4fb;
}
.outline__item--part:hover {
  background: #e2ecf7;
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
