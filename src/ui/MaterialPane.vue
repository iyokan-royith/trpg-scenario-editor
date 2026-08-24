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
  /** 「差し替え」を出してよい素材（＝定義に画像欄がある）の instanceId */
  replaceableInstanceIds: string[]
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

/**
 * ⭐⭐ **行はパート単位だが、「消す」「差し替え」は素材（インスタンス）単位の操作である。**
 *
 * ⚠ 素材一覧に並ぶのが画像だけだった間は「1 インスタンス＝1 パート」が**事実として**成立しており、
 *   この食い違いは画面から到達できなかった。テンプレのフォームが入って初めて
 *   **4 行に同じ「消す」が並び、どれを押しても 4 行すべて消える**状態になった。
 *   → **素材あたり 1 つに畳み、消える件数を押す前に見せる。**
 *
 * ⚠ 「素材の 1 行目」ではなく「**いま見えている中の 1 行目**」に付ける。
 *   絞り込み（未配置だけ）で先頭が隠れると、その素材を消す手段が消えてしまうため。
 */
const headKeys = computed(() => {
  const seen = new Set<string>()
  const keys = new Set<string>()
  for (const part of visibleParts.value) {
    if (seen.has(part.instanceId)) continue
    seen.add(part.instanceId)
    keys.add(partKeyOf(part.instanceId, part.partId))
  }
  return keys
})

function isInstanceHead(part: Part): boolean {
  return headKeys.value.has(partKeyOf(part.instanceId, part.partId))
}

/**
 * その素材が持つパートの数。
 * ⚠ **見えている数ではなく全部の数**を数える。消えるのは絞り込みの外のパートも含む全部だから。
 */
function partCountOf(part: Part): number {
  return props.parts.filter((p) => p.instanceId === part.instanceId).length
}

const replaceableSet = computed(() => new Set(props.replaceableInstanceIds))

function canReplace(part: Part): boolean {
  return replaceableSet.value.has(part.instanceId)
}
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
        <!-- ⚠ 内部の名前（`onlyUnplaced`）がそのまま出ていた。識別子は英語・**画面は日本語**（§1-8-1） -->
        未配置だけ
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
        <!-- ⚠ 挿入だけがパート単位の操作。だから全部の行に出る -->
        <button type="button" @click="emit('insert', part)">本文へ挿入</button>
        <!-- ⚠ 以下は**素材単位**の操作なので、素材あたり 1 行にしか出さない（上の headKeys を参照） -->
        <template v-if="isInstanceHead(part)">
          <!-- ⚠ 差し替えは**本文に触らない**。置かれている全箇所が同時に変わる（S7-3）。
               画像欄を持たない素材には出さない（出すと実体の行き先が無い） -->
          <button v-if="canReplace(part)" type="button" @click="emit('replace', part)">
            差し替え
          </button>
          <!-- ⚠⚠ 消えるのは素材まるごと。パートが 2 つ以上あるときは**押す前に**件数を言う -->
          <button type="button" @click="emit('remove', part)">
            {{ partCountOf(part) > 1 ? `素材ごと消す（パート ${partCountOf(part)} 件）` : '消す' }}
          </button>
        </template>
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
