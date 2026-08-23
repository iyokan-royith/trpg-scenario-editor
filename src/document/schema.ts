import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Schema } from '@tiptap/pm/model'
import { PartRef } from '../p0/partRefExtension'

/**
 * P1 のエディタが使う拡張一式。
 *
 * ⚠ アプリ本体（App.vue）とテストが **同じ配列** を使うこと自体が重要。
 *    別々に組むと「テストでは通るがアプリでは違うスキーマ」という差分が生まれ、
 *    md 往復（往復テストの対象）がアプリ側でだけ壊れうる。
 */
export const documentExtensions = [
  // 見出し記号（`## `）を打つと見出しになる入力規則は Heading が持っている（完了条件 #1）。
  StarterKit,
  // P0 で実証済みのパート参照ノード。P1 では「本文に居ても壊れない」ことだけを担保する。
  PartRef,
]

/**
 * 上の拡張から導いたスキーマ。
 * md の入出力（markdown.ts）はエディタの実体が無くてもこれだけで動く。
 */
export const documentSchema: Schema = getSchema(documentExtensions)
