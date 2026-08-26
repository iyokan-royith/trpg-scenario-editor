<script setup lang="ts">
import { computed } from 'vue'
import type { LiquidRenderFailure, LiquidRenderStatus } from '../store/partStore'

/**
 * 画面下端の状態表示（DESIGN-v0.md §1-13-1f 決定1・移行 P-d1）。
 *
 * **ロイスの要求**:「**画面の下にステータスバーみたいなの出す事は可能ですかね。
 * そんなに目立たなくてもいいですが、見れば状況がわかるかんじになってほしい**」。
 *
 * ⚠⚠ **これは「本文を消さない」ことと対になっている。**
 *   liquid の描画は非同期なので「いま古い内容を見ている」瞬間が必ずある。
 *   本文を空にしてそれを知らせる（＝「あ！消えちゃった！」）代わりに、
 *   **本文はそのままで、状態だけここに出す**というのが決定の中身。
 *
 * ⚠⚠ **エラーの文面はラップも日本語化もしない**（§1-13-1c のロイス決定
 *   「エラーは教えてあげましょう。特に日本語化とかする必要はないです」）。
 *   `message` は末尾に `, line:N, col:M` を持ち、`context` は `^` 付きの該当行なので、
 *   **そのまま出すのがいちばん情報量が多い**。ここで整形すると作者が現物へ辿り着けなくなる。
 *
 * ⚠ 「目立たなく」は**小さく・地の色で**という意味に取っている。
 *   エラー時だけ色を変えるが、帯そのものは太らせない（本文の面積を奪わない）。
 */
const props = defineProps<{
  status: LiquidRenderStatus
  failures: LiquidRenderFailure[]
  /** 生きているパートの総数（同期＋liquid） */
  partCount: number
  /** そのうち liquid が描いたもの */
  liquidPartCount: number
}>()

/** ⚠ 件数は 3 状態とも同じ形で出す（状態が変わっても読む場所が動かない）。 */
const counts = computed(
  () => `パート ${props.partCount} 件（うち liquid ${props.liquidPartCount} 件）`,
)

const summary = computed(() => {
  if (props.status === 'rendering') return `描画中… ／ ${counts.value}`
  if (props.status === 'error') return `⚠ 描画エラー ${props.failures.length} 件 ／ ${counts.value}`
  return `描画済み ／ ${counts.value}`
})
</script>

<template>
  <footer class="status" :data-status="status">
    <!-- ⚠ `role="status"` は読み上げにも出す（帯が小さいぶん、見落としの逃げ道を残す） -->
    <p class="status__summary" role="status">{{ summary }}</p>
    <ul v-if="failures.length > 0" class="status__failures">
      <li v-for="failure in failures" :key="failure.instanceId" class="status__failure">
        <span class="status__where">{{ failure.templateId }}</span>
        <!-- ⚠⚠ liquidjs の文面そのまま。整形しない -->
        <code class="status__message">{{ failure.message }}</code>
        <pre v-if="failure.context" class="status__context">{{ failure.context }}</pre>
      </li>
    </ul>
  </footer>
</template>

<style scoped>
.status {
  border-top: 1px solid #ddd;
  padding: 0.15rem 1rem;
  font-size: 0.75rem;
  color: #666;
  background: #fafafa;
  max-height: 8rem;
  overflow-y: auto;
}
.status[data-status='error'] {
  background: #fff6f5;
  color: #8a2b22;
}
.status__summary {
  margin: 0;
}
.status__failures {
  list-style: none;
  margin: 0.15rem 0 0;
  padding: 0;
}
.status__failure {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-top: 0.15rem;
}
.status__where {
  color: #a05a52;
}
.status__message,
.status__context {
  font-family: monospace;
  /* ⚠ 折り返す。`^` の位置がずれるので、桁は保ったまま行だけ折る */
  white-space: pre-wrap;
  margin: 0;
}
</style>
