import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Schema } from '@tiptap/pm/model'
import { PartRef } from './partRefExtension'
import { HeadingSync, SourceHeading } from './headingSource'
import { CurrentBlock } from './currentBlock'

/**
 * P1 のエディタが使う拡張一式。
 *
 * ⚠ アプリ本体（App.vue）とテストが **同じ配列** を使うこと自体が重要。
 *    別々に組むと「テストでは通るがアプリでは違うスキーマ」という差分が生まれ、
 *    md 往復（往復テストの対象）がアプリ側でだけ壊れうる。
 */
export const documentExtensions = [
  // ⚠ 既定の Heading は「記号を消して見出しにする」入力規則を持っていて、
  //   ソース方式（CONCEPT Q2 改訂）と正面からぶつかるので **切ってある**。
  StarterKit.configure({ heading: false }),
  // 記号を本文に残す見出し（完了条件 #1・2026-08-23 改訂）
  SourceHeading,
  HeadingSync,
  // フォーカスの所在をブロック単位で示す（要望1）
  CurrentBlock,
  // P0 で実証済みのパート参照ノード。P1 では「本文に居ても壊れない」ことだけを担保する。
  PartRef,
]

/**
 * 上の拡張から導いたスキーマ。
 * md の入出力（markdown.ts）はエディタの実体が無くてもこれだけで動く。
 */
export const documentSchema: Schema = getSchema(documentExtensions)
