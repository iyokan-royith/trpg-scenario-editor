import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  derivePartsOf,
  partKeyOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../template/model'
import { 同梱テンプレを読む } from '../template/loader'
import { 画像キー, 表示名キー } from '../template/render/image'

/** 同梱テンプレート「画像」の id。⚠ 綴りの真実は `src/templates/image.json` 側。 */
export const 画像テンプレID = 'builtin.image'

let 連番 = 0
function 新しいID(接頭辞: string): string {
  連番 += 1
  return `${接頭辞}-${Date.now().toString(36)}-${連番}`
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
  function 同梱テンプレを登録する() {
    for (const def of 同梱テンプレを読む()) registerDefinition(def)
  }

  /**
   * 画像を 1 枚追加する。
   * ⚠ **UI にテンプレートであることを見せないだけで、内部では普通のインスタンス 1 件**（1-7-2）。
   */
  function 画像を追加する(file: Blob, 表示名: string): TemplateInstance {
    const instance: TemplateInstance = {
      id: 新しいID('画像'),
      templateId: 画像テンプレID,
      data: { [表示名キー]: 表示名 },
      images: { [画像キー]: file },
    }
    upsertInstance(instance)
    return instance
  }

  /** 画像フィールドを差し替える（同じインスタンスなので、置かれた全箇所が同時に変わる）。 */
  function 画像を差し替える(instanceId: string, file: Blob) {
    const instance = instances.value[instanceId]
    if (!instance) return
    instance.images = { ...instance.images, [画像キー]: file }
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
    同梱テンプレを登録する,
    画像を追加する,
    画像を差し替える,
  }
})
