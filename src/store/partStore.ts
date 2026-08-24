import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  derivePartsOf,
  partKeyOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../template/model'
import { readBundledTemplates } from '../template/loader'
import { IMAGE_KEY, CAPTION_KEY, IMAGE_TEMPLATE_ID } from '../template/render/image'

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

  /** 生きているパート全部。データを変えるとここが作り直され、NodeView が追従する。 */
  const parts = computed<Part[]>(() => {
    const out: Part[] = []
    for (const instance of Object.values(instances.value)) {
      const def = definitions.value[instance.templateId]
      if (!def) continue
      out.push(...derivePartsOf(instance, def))
    }
    return out
  })

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
  function createInstance(templateId: string, data: Record<string, unknown>): TemplateInstance {
    const instance: TemplateInstance = {
      id: newId('instance'),
      templateId,
      data,
      // ⚠ 画像の実体はフォームからは入らない（`image` 型は入力 UI が未対応）。
      images: {},
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
   * 画像フィールドを差し替える（同じインスタンスなので、置かれた全箇所が同時に変わる）。
   * ⚠ **保存はしない。** 呼び手が返り値を `saveInstance()` へ渡すこと
   *   （保存の責務をストアへ持ち込むと、テストのたびに IndexedDB が要る）。
   * @returns 差し替え後のインスタンス。対象が無ければ undefined
   */
  function replaceImage(instanceId: string, file: Blob): TemplateInstance | undefined {
    const instance = instances.value[instanceId]
    if (!instance) return undefined
    instance.images = { ...instance.images, [IMAGE_KEY]: file }
    return instance
  }

  return {
    definitions,
    instances,
    parts,
    partIndex,
    findPart,
    partsOfInstance,
    registerDefinition,
    upsertInstance,
    removeInstance,
    registerBundledTemplates,
    createInstance,
    addImage,
    replaceImage,
  }
})
