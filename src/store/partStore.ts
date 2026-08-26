import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Liquid } from 'liquidjs'
import {
  derivePartsOf,
  imageFieldKeyOf,
  partKeyOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../template/model'
import { deriveLiquidPartsOf, liquidPartToPart } from '../template/liquid/outputs'
import { markdownLiquidEngine } from '../template/liquid/engine'
import { readBundledTemplates } from '../template/loader'
import { IMAGE_KEY, CAPTION_KEY, IMAGE_TEMPLATE_ID } from '../template/render/image'

/**
 * liquid の描画がいまどうなっているか（DESIGN-v0.md §1-13-1f 決定1・移行 P-d1）。
 *
 * ⚠ **`'ready'` は「エラーが 1 件も無い」であって「liquid の出力がある」ではない**
 *   （`liquidOutputs` を 1 つも持たない構成でも `'ready'` になる）。
 */
export type LiquidRenderStatus = 'ready' | 'rendering' | 'error'

/**
 * 描画に失敗した素材 1 件。
 *
 * ⚠⚠ **`message` は liquidjs の文面そのまま**である。ラップも日本語化もしない
 *   （§1-13-1c のロイス決定「エラーは教えてあげましょう。特に日本語化とかする必要はないです」）。
 *   `LiquidError` の `message` は末尾に `, line:N, col:M` を含み、`context` に
 *   `^` 付きの該当行が入っている——**両方そのまま利用者へ渡す**のがこの型の役目。
 *
 * ⚠ `context` が `undefined` になるのは `parseLimit` 超過（生の `AssertionError`）だけだが、
 *   本番のエンジンは `parseLimit` を設定していないので通常は来ない。
 *   **それでも省略可にしてある**——`e.context` を一律に読む UI がその 1 ケースで壊れる、と
 *   §1-13-1c が名指ししているため。
 */
export interface LiquidRenderFailure {
  instanceId: string
  templateId: string
  /** liquidjs の `message`（英語のまま） */
  message: string
  /** liquidjs の `context`（該当行と `^` の抜粋）。持たない例外もある */
  context?: string
}

function failureOf(instance: TemplateInstance, error: unknown): LiquidRenderFailure {
  const context = (error as { context?: unknown }).context
  return {
    instanceId: instance.id,
    templateId: instance.templateId,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof context === 'string' ? { context } : {}),
  }
}

/**
 * ⚠ 実体は `template/render/image.ts` へ移した（同梱 JSON と対になるキー名を持つのと同じ場所）。
 *   ここからの re-export は、これまでどおり store 経由で参照できるようにするためだけのもの。
 */
export { IMAGE_TEMPLATE_ID }

let sequence = 0
function newId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

/**
 * テンプレ定義とインスタンスの置き場。
 * ⚠ ProseMirror のドキュメントの「外」にある。本文はここへの参照しか持たない。
 *
 * ⚠ **パートの配列は持たない**（1-7-4）。素材一覧は毎回ここから導出するビューで、
 *   保存すると「消したのに一覧に残る／差し替えたのに古い名前が出る」が構造的に発生しうる。
 */
export const usePartStore = defineStore('parts', () => {
  const definitions = ref<Record<string, TemplateDefinition>>({})
  const instances = ref<Record<string, TemplateInstance>>({})

  /**
   * ⭐⭐ liquid の描画に使うエンジン（DESIGN-v0.md §1-13-1c・移行 P-d1）。
   *
   * ⚠⚠ **ここが「どちらのエンジンを使うか」を選んでいる唯一の場所**である。
   *   `engine.ts` から既定（`defaultLiquidEngine`）を消したので、選ばずに済ませる道は無い。
   *   md 側なのは **P-d1 が繋いだのが md 経路だから**（HTML 経路＝iframe sandbox は P4-a）。
   *
   * ⚠ 差し替えられるようにしてあるのは、テストが**描画の途中の状態**を作れるようにするため
   *   （解決を握った偽エンジンを挿す）。⚠ 差し替えても再描画は起きないので、
   *   **インスタンスを登録する前に差し替えること**。
   */
  const liquidEngine = shallowRef<Liquid>(markdownLiquidEngine)

  /**
   * ⭐ 直前に成功した liquid のパート（素材ごと）。
   *
   * ⚠⚠ **描画中でも、エラー中でも、ここは空にしない**（§1-13-1f 決定1）。
   *   ロイスが同日に止めた「**あ！消えちゃった！**」を作らないのがこの決定の主旨で、
   *   状態は本文を消すことではなく**ステータスバー**で知らせる。
   *   → だから「描画を始めたら一旦クリア」は**やってはいけない**（バグではなく決定違反になる）。
   *
   * ⚠ `shallowRef` ＋ 丸ごと差し替えにしてあるのは、Map の中身を変えるより
   *   「いつ入れ替わったか」が読める形にするため。
   */
  const liquidPartsByInstance = shallowRef<ReadonlyMap<string, Part[]>>(new Map())

  /** ⚠ 「liquid の出力があるか」ではなく「エラーが出ていないか」を表す（型の注記を参照）。 */
  const liquidStatus = ref<LiquidRenderStatus>('ready')

  /** ⚠ 握りつぶさない（§1-13-1c）。ここが空なら本当にエラーが無かったということ。 */
  const liquidFailures = ref<LiquidRenderFailure[]>([])

  /**
   * 走っている描画の世代。
   * ⚠ **古い描画の結果（成功も失敗も）で新しい結果を上書きしない**ための番号。
   *   データを速く連続で変えると描画は重なりうる（`renderLimit` は 10 秒ある）。
   */
  let renderGeneration = 0

  /** liquid のパートを平らに並べたもの（ステータスバーの件数表示と、下の `parts` が使う）。 */
  const liquidParts = computed<Part[]>(() => {
    const out: Part[] = []
    for (const instance of Object.values(instances.value)) {
      const found = liquidPartsByInstance.value.get(instance.id)
      if (found) out.push(...found)
    }
    return out
  })

  /**
   * 生きているパート全部。データを変えるとここが作り直され、NodeView が追従する。
   *
   * ⭐⭐ **同期経路（`derivePartsOf`）と非同期経路（liquid）がここで合流する**（移行 P-d1）。
   *   ⚠ **同期の側は liquid の完了を待たない**——待たせると、テンプレを 1 行直すたびに
   *   既存のパートまで消えることになる。liquid は**遅れて後から入ってくる**。
   *
   * ⚠ 並びは「素材ごとに 同期 → liquid」。素材一覧（`MaterialPane`）は
   *   **素材あたり 1 行にしか出さない操作**を「いま見えている中の 1 行目」で決めるので、
   *   同じ素材のパートが離れて並ぶと同じ素材に 2 回「消す」が出る。
   */
  const parts = computed<Part[]>(() => {
    const out: Part[] = []
    for (const instance of Object.values(instances.value)) {
      const def = definitions.value[instance.templateId]
      if (!def) continue
      out.push(...derivePartsOf(instance, def))
      const rendered = liquidPartsByInstance.value.get(instance.id)
      if (rendered) out.push(...rendered)
    }
    return out
  })

  /**
   * liquid のパートを描き直す。
   *
   * ⚠ **素材ごとに try/catch する**。`deriveLiquidPartsOf` は 1 件目のエラーで throw するので、
   *   まとめて回すと**壊れた素材 1 つで全素材の liquid パートが消える**。
   *
   * ⚠ エラーになった素材は**直前に成功した結果を持ち越す**（§1-13-1f 決定1）。
   *   持ち越さないと、テンプレを編集している最中の 1 文字ごとに本文が消える。
   */
  async function renderLiquidParts(): Promise<void> {
    renderGeneration += 1
    const generation = renderGeneration
    liquidStatus.value = 'rendering'

    const previous = liquidPartsByInstance.value
    const next = new Map<string, Part[]>()
    const failures: LiquidRenderFailure[] = []

    for (const instance of Object.values(instances.value)) {
      const def = definitions.value[instance.templateId]
      if (!def?.liquidOutputs?.length) continue
      try {
        const rendered = await deriveLiquidPartsOf(instance, def, liquidEngine.value)
        next.set(instance.id, rendered.map(liquidPartToPart))
      } catch (error) {
        failures.push(failureOf(instance, error))
        const kept = previous.get(instance.id)
        if (kept) next.set(instance.id, kept)
      }
    }

    // ⚠ 追い越された描画の結果は捨てる（成功も失敗も）。ここを外すと、
    //   古い描画が後から着地して新しいデータの結果を巻き戻す。
    if (generation !== renderGeneration) return
    liquidPartsByInstance.value = next
    liquidFailures.value = failures
    liquidStatus.value = failures.length > 0 ? 'error' : 'ready'
  }

  // ⚠ 定義（テンプレ文字列）とインスタンス（データ）のどちらが変わっても描き直す。
  //   ⚠⚠ `deep` が要る——`instances.value[id].data` の中身だけが変わる経路がある。
  watch([instances, definitions], () => void renderLiquidParts(), { deep: true, immediate: true })

  const partIndex = computed<Map<string, Part>>(
    () => new Map(parts.value.map((p) => [partKeyOf(p.instanceId, p.partId), p])),
  )

  function findPart(instanceId: string, partId: string): Part | undefined {
    return partIndex.value.get(partKeyOf(instanceId, partId))
  }

  /** そのインスタンスから生まれているパート（削除時のアラートで「何が消えるか」を言うため）。 */
  function partsOfInstance(instanceId: string): Part[] {
    return parts.value.filter((p) => p.instanceId === instanceId)
  }

  function registerDefinition(def: TemplateDefinition) {
    definitions.value[def.id] = def
  }

  function upsertInstance(instance: TemplateInstance) {
    instances.value[instance.id] = instance
  }

  function removeInstance(instanceId: string) {
    delete instances.value[instanceId]
  }

  /**
   * 同梱テンプレを登録する。⚠ 壊れていれば例外が飛ぶ（呼び手が利用者へ見せる）。
   * 冪等（同じ id を上書きするだけ）なので、何度呼んでもよい。
   */
  function registerBundledTemplates() {
    for (const def of readBundledTemplates()) registerDefinition(def)
  }

  /**
   * テンプレのフォームから作られたインスタンスを 1 件足す（P2 完了条件 #4）。
   * ⚠ **保存はしない**（`addImage` と同じ線。呼び手が `saveInstance()` へ渡す）。
   */
  function createInstance(
    templateId: string,
    data: Record<string, unknown>,
    images: Record<string, Blob> = {},
  ): TemplateInstance {
    const instance: TemplateInstance = {
      id: newId('instance'),
      templateId,
      data,
      // ⚠ フォームの `image` 欄で選ばれた実体（`collectImages()` の結果）。
      //   ⚠⚠ **`addImage()` と経路を分けない**——あちらは「素材を追加」ボタン専用の入口で、
      //   定義に `image` 欄を持つ**利用者のテンプレ**はこちらを通る（§1-7-2 の線）。
      images,
    }
    upsertInstance(instance)
    return instance
  }

  /**
   * 画像を 1 枚追加する。
   * ⚠ **UI にテンプレートであることを見せないだけで、内部では普通のインスタンス 1 件**（1-7-2）。
   */
  function addImage(file: Blob, caption: string): TemplateInstance {
    const instance: TemplateInstance = {
      id: newId('image'),
      templateId: IMAGE_TEMPLATE_ID,
      data: { [CAPTION_KEY]: caption },
      images: { [IMAGE_KEY]: file },
    }
    upsertInstance(instance)
    return instance
  }

  /**
   * ⭐⭐ 生成済み素材の中身を差し替える（DESIGN-v0.md §1-11・要望B）。
   *
   * ⚠⚠ **`id` と `templateId` は変えない。** 新しいインスタンスを作ると
   *   **本文に置いた `partRef.instanceId` が全部行方不明になる**（§1-11-1 と同じ穴の、
   *   インスタンス側の面）。⚠ 例外は出ない。
   *
   * ⚠ **保存はしない**（`createInstance` / `addImage` と同じ線。呼び手が `saveInstance()` へ渡す）。
   *
   * @returns 更新後のインスタンス。対象が無ければ undefined
   */
  function updateInstance(
    instanceId: string,
    data: Record<string, unknown>,
    images: Record<string, Blob> = {},
  ): TemplateInstance | undefined {
    const instance = instances.value[instanceId]
    if (!instance) return undefined
    const updated: TemplateInstance = { ...instance, data, images }
    upsertInstance(updated)
    return updated
  }

  /**
   * そのインスタンスの差し替え可能な画像フィールドのキー（無ければ undefined）。
   * ⚠ 宣言（定義の `fields`）に聞く。**インスタンスに実体が入っているかは見ない**——
   *   まだ 1 枚も入れていない素材にも「差し替え」は出てよい。
   */
  function imageFieldKeyOfInstance(instanceId: string): string | undefined {
    const instance = instances.value[instanceId]
    const def = instance && definitions.value[instance.templateId]
    return def ? imageFieldKeyOf(def) : undefined
  }

  /**
   * 画像フィールドを差し替える（同じインスタンスなので、置かれた全箇所が同時に変わる）。
   * ⚠ **保存はしない。** 呼び手が返り値を `saveInstance()` へ渡すこと
   *   （保存の責務をストアへ持ち込むと、テストのたびに IndexedDB が要る）。
   *
   * ⚠⚠ **書き込み先は定義から引く**（`IMAGE_KEY` を決め打ちしない）。
   *   決め打ちだと、画像欄を持たない素材（迷宮マップ等）にも実体を書き込めてしまい、
   *   **画面には何も起きないのに保存だけされる**。UI 側の出し分けが緩んでも、ここで止まる。
   *
   * @returns 差し替え後のインスタンス。対象が無い／画像欄を持たない定義なら undefined
   */
  function replaceImage(instanceId: string, file: Blob): TemplateInstance | undefined {
    const instance = instances.value[instanceId]
    if (!instance) return undefined
    const key = imageFieldKeyOfInstance(instanceId)
    if (!key) return undefined
    instance.images = { ...instance.images, [key]: file }
    return instance
  }

  return {
    definitions,
    instances,
    parts,
    liquidParts,
    liquidEngine,
    liquidStatus,
    liquidFailures,
    renderLiquidParts,
    partIndex,
    findPart,
    partsOfInstance,
    registerDefinition,
    upsertInstance,
    removeInstance,
    registerBundledTemplates,
    createInstance,
    updateInstance,
    addImage,
    imageFieldKeyOfInstance,
    replaceImage,
  }
})
