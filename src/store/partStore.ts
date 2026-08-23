import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  derivePartsOf,
  partKeyOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from '../template/model'

/**
 * テンプレ定義とインスタンスの置き場。
 * ⚠ ProseMirror のドキュメントの「外」にある。本文はここへの参照しか持たない。
 */
export const usePartStore = defineStore('p0-parts', () => {
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

  function registerDefinition(def: TemplateDefinition) {
    definitions.value[def.id] = def
  }

  function upsertInstance(instance: TemplateInstance) {
    instances.value[instance.id] = instance
  }

  return { definitions, instances, parts, partIndex, findPart, registerDefinition, upsertInstance }
})
