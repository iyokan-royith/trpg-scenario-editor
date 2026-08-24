<script setup lang="ts">
import type { ArrayItem, FieldDef } from '../template/model'
import {
  FIELD_TYPE_LABELS,
  ITEM_ID_KEY,
  createArrayItem,
  createDraft,
  isNeverAskedFieldType,
  isSupportedFieldType,
  labelOf,
} from '../template/form'
import {
  COORDINATE_CHOICES,
  childFieldsOf,
  choicesOf,
  formatCoordinate,
  isVariantFieldType,
  parseCoordinate,
  visibleFieldsOf,
} from '../template/domain'

/**
 * 入力欄 1 つ（DESIGN-v0.md §4 の P2 完了条件 #2・#3）。
 *
 * ⭐ **自分自身を再帰的に使う。** `object` の子も、`array` の要素の各項目も、同じこの部品で描く。
 *   → 入れ子の深さに制限が無く、型ごとの分岐が 1 箇所にしか無い。
 *
 * ⚠ 受け渡しは **`v-model`（値を受け取り、新しい値を返す）** で、親のオブジェクトを直接書き換えない。
 *   入れ子は「子の新しい値を差し込んだ**新しい親**」を作って上へ返す。
 *   ⚠⚠ この形は**中継が 1 段でも抜けると値が上まで届かない**——
 *   画面上は入力できているのに保存されない、という壊れ方をする。
 *   だから検査は必ず**いちばん深い所まで打って、保存された値を見る**（`templateForm.spec.ts`）。
 */
import { ref } from 'vue'

const props = defineProps<{ field: FieldDef; modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

/** 未対応の型（`ref` / `oneOf`）。⚠ **落とさず、対応していないと分かる形で出す**（完了条件 #6）。 */
const supported = () => isSupportedFieldType(props.field.type)

/**
 * ⭐⭐ **尋ねない型**（`derived`）。⚠ 「まだ入力できません」と**同じ文言にしない**（§1-3-3）。
 *   導出値は導出されるものなので、待っていても入力欄は出ない——
 *   「まだ」と書くと、いつか出るという嘘になる。
 */
const neverAsked = () => isNeverAskedFieldType(props.field.type)

/** ⚠ 内部の型名（`coordinate` 等）をそのまま画面に出さない（§1-8-2c）。 */
const typeLabel = () => FIELD_TYPE_LABELS[props.field.type]

/** ⚠ 合成型（座標・辺参照）の子は**型が決めている**。定義の `fields` は見ない（`domain.ts`）。 */
const childFields = () => childFieldsOf(props.field)

/**
 * ⭐ 判別子付き共用体（`oneOf` / `ref`）でいま出す欄＝**判別子 + 共有 + 選ばれた枝**。
 *
 * ⚠⚠ 枝を切り替えても、**前の枝に打った値は消さない**（下書きに残り、戻せば出てくる）。
 *   → だから切り替えは「下書きが失われる操作」ではなく、§1-9-3a の逐一確認は要らない。
 *   ⚠ 保存では選ばれた枝だけが書かれる（判別子が値を定義する・`pruneEmpty`）。
 */
const isVariant = () => isVariantFieldType(props.field.type)
const variantFields = () => visibleFieldsOf(props.field, props.modelValue)

/** 固定長（`ends: [座標, 座標]`）の各要素の宣言。⚠ 中身は 1 つのときと同じ部品で描く。 */
const tupleFields = () =>
  Array.from({ length: props.field.tuple ?? 0 }, (_, index) => ({
    ...props.field,
    tuple: undefined,
    label: `${labelOf(props.field)} ${index + 1} つ目`,
  }))

function tupleItems(): unknown[] {
  const values = Array.isArray(props.modelValue) ? props.modelValue : []
  return Array.from({ length: props.field.tuple ?? 0 }, (_, index) => values[index])
}

function updateTupleItem(index: number, value: unknown) {
  emit(
    'update:modelValue',
    tupleItems().map((item, i) => (i === index ? value : item)),
  )
}

/** 文字列として画面に出す値。⚠ 型が合わないデータ（古い保存など）でも落ちないように畳む。 */
function asText(): string {
  return props.modelValue === null || props.modelValue === undefined ? '' : String(props.modelValue)
}

function items(): ArrayItem[] {
  return Array.isArray(props.modelValue) ? (props.modelValue as ArrayItem[]) : []
}

/** `object` の値。⚠ 無ければその場で空の下書きを作って**表示だけ**する（親の値は書き換えない）。 */
function objectValue(): Record<string, unknown> {
  const value = props.modelValue
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return createDraft(childFields())
}

function updateChild(key: string, value: unknown) {
  emit('update:modelValue', { ...objectValue(), [key]: value })
}

function updateItem(id: string, key: string, value: unknown) {
  // ⚠ 添字ではなく id で当てる（並び替えを入れたときに別の行を書き換えない）。
  emit(
    'update:modelValue',
    items().map((item) => (item[ITEM_ID_KEY] === id ? { ...item, [key]: value } : item)),
  )
}

function addItem() {
  emit('update:modelValue', [...items(), createArrayItem(childFields())])
}

function removeItem(id: string) {
  emit(
    'update:modelValue',
    items().filter((item) => item[ITEM_ID_KEY] !== id),
  )
}

/**
 * 整数の入力。⚠ **空欄は `null`** に倒す（`0` にしない）。
 *   空欄を 0 にすると「未入力」と「0 と入力した」が区別できなくなり、
 *   宣言側の既定値（`fieldRef.default`）が発火しなくなる（§1-6-10 の T0/E0）。
 */
function onInteger(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  emit('update:modelValue', raw === '' ? null : Number(raw))
}

function onText(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function onBoolean(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}

function onEnum(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}

/**
 * 選択肢。⚠ `direction`（8 方向）は**選択肢が型で固定された `enum`**なので、
 *   入力欄を別に作らない（§1-3-3 の「新しい概念を足さない」はここにも効く）。
 */
const choices = () => choicesOf(props.field)

/**
 * 画像を 1 枚選ぶ。⚠ **ここでは実体（Blob）を下書きに置くだけ**で、保存はしない。
 *   `TemplateInstance.images` へ移すのは保存時（`collectImages()`）。
 */
const imageInput = ref<HTMLInputElement | null>(null)

function onImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // ⚠ 選び直しを取り消した（ファイルを選ばずに閉じた）ときは、いま持っている画像を消さない。
  if (!file) return
  emit('update:modelValue', file)
}

function clearImage() {
  // ⚠ 入力欄の値も捨てる。捨てないと**同じファイルを選び直しても change が飛ばない**。
  if (imageInput.value) imageInput.value.value = ''
  emit('update:modelValue', null)
}

/**
 * 画像が 1 枚選ばれているか。
 * ⚠ テンプレートの式から `Blob` は引けない（描画スコープに居るのは setup の束縛だけ）ので、
 *   判定はここに置く。⚠⚠ 実際、テンプレートに `modelValue instanceof Blob` と書いたら
 *   **描画そのものが例外で落ちた**（型検査は通る）。
 */
function hasImage(): boolean {
  return props.modelValue instanceof Blob
}

/**
 * ⭐⭐ 座標は **3×3 の 9 択 1 つ**で尋ねる（§1-3-3d ①・ロイスの実機フィードバック
 * 「行と列を別々に尋ねられるのは**予想通り辛い**」）。
 *
 * ⚠⚠ **保存形は変えていない**——画面は `A1`、データは `{row:'A', col:1}`（§1-3-3b）。
 *   ⚠ ここを潰して文字列で保存すると、P4 で図が描けなくなる。
 */
const coordinateChoices = () => COORDINATE_CHOICES

function coordinateText(): string {
  return formatCoordinate(props.modelValue)
}

function onCoordinate(event: Event) {
  emit('update:modelValue', parseCoordinate((event.target as HTMLSelectElement).value))
}

/** 選んだ画像の名前。⚠ 名前を持たない Blob もあるので、そのときは「選んだ」ことだけ言う。 */
function imageName(): string {
  const value = props.modelValue
  if (!(value instanceof Blob)) return '画像を選んでいません'
  const name = (value as File).name
  return name ? name : '画像を選びました'
}
</script>

<template>
  <!-- ⚠ 固定長は入れ物にも印を付ける。付けないと、入れ物と中身が**同じクラス**になり
       （`ends` は「座標が 2 つ」なので入れ物も `field--coordinate`）、
       数えたときに 2 のはずが 3 に見える。 -->
  <div class="field" :class="[`field--${field.type}`, { 'field--tuple': field.tuple !== undefined }]">
    <!-- ⭐⭐ 尋ねない型（導出値）: 「まだ」ではない。待っても入力欄は出ない（§1-3-3） -->
    <p v-if="neverAsked()" class="field__derived">
      <span class="field__label">{{ labelOf(field) }}</span>
      <span class="field__note">（{{ typeLabel() }}）は自動で決まるので入力しません</span>
    </p>

    <!-- 未対応の型: 落とさず「まだ入力できない」と言う（完了条件 #6） -->
    <p v-else-if="!supported()" class="field__unsupported">
      <span class="field__label">{{ labelOf(field) }}</span>
      <span class="field__note">（{{ typeLabel() }}）はまだ入力できません</span>
    </p>

    <!-- ⚠ 固定長（中身の型より**先に**見る。`ends` は「座標」ではなく「座標が 2 つ」）（`ends`）。並びに意味があるので「足す・消す」は出さない -->
    <fieldset v-else-if="field.tuple !== undefined" class="field__group field__tuple">
      <legend>{{ labelOf(field) }}</legend>
      <FieldEditor
        v-for="(child, index) in tupleFields()"
        :key="index"
        :field="child"
        :modelValue="tupleItems()[index]"
        @update:modelValue="(value: unknown) => updateTupleItem(index, value)"
      />
    </fieldset>

    <label v-else-if="field.type === 'string'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <input type="text" :value="asText()" @input="onText" />
    </label>

    <label v-else-if="field.type === 'integer'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <input type="number" :value="asText()" @input="onInteger" />
    </label>

    <label v-else-if="field.type === 'boolean'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <input type="checkbox" :checked="modelValue === true" @change="onBoolean" />
    </label>

    <label v-else-if="field.type === 'text'" class="field__row field__row--block">
      <span class="field__label">{{ labelOf(field) }}</span>
      <textarea rows="4" :value="asText()" @input="onText"></textarea>
    </label>

    <!-- ⚠ 方向も同じ枝を通る（選択肢が型で固定された列挙にすぎない） -->
    <label v-else-if="field.type === 'enum' || field.type === 'direction'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <select :value="asText()" @change="onEnum">
        <!-- ⚠ 空の選択肢を必ず置く。無いと「選んでいない」を表せず、先頭の値が黙って入る -->
        <option value="">（選んでいません）</option>
        <option v-for="choice in choices()" :key="choice.value" :value="choice.value">
          {{ choice.label }}
        </option>
      </select>
    </label>

    <!-- ⚠ 画像の実体は `data` ではなく `TemplateInstance.images` へ行く（保存時に移す） -->
    <div v-else-if="field.type === 'image'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <input ref="imageInput" type="file" accept="image/*" @change="onImage" />
      <span class="field__imageName">{{ imageName() }}</span>
      <button v-if="hasImage()" type="button" @click="clearImage">画像を外す</button>
    </div>

    <!-- ⭐⭐ 判別子付き共用体。⚠ `ref` も同じ枝を通る（枝を型が持っているだけの違い） -->
    <fieldset v-else-if="isVariant()" class="field__group field__variant">
      <legend>{{ labelOf(field) }}</legend>
      <FieldEditor
        v-for="child in variantFields()"
        :key="child.key"
        :field="child"
        :modelValue="objectValue()[child.key]"
        @update:modelValue="(value: unknown) => updateChild(child.key, value)"
      />
    </fieldset>

    <!-- ⭐⭐ 座標は 3×3 の 9 択ひとつ（§1-3-3d ①）。⚠ 保存されるのは今までどおり行と列 -->
    <label v-else-if="field.type === 'coordinate'" class="field__row">
      <span class="field__label">{{ labelOf(field) }}</span>
      <select :value="coordinateText()" @change="onCoordinate">
        <option value="">（選んでいません）</option>
        <option v-for="choice in coordinateChoices()" :key="choice" :value="choice">
          {{ choice }}
        </option>
      </select>
    </label>

    <!-- ⭐ 辺参照は**合成**（`domain.ts`）。入れ子と同じ経路で描く＝新しい概念を足さない。
         ⚠ 中の座標は上の 9 択がそのまま出る（合成なので自動で追随する） -->
    <fieldset
      v-else-if="field.type === 'object' || field.type === 'edgeRef'"
      class="field__group"
    >
      <legend>{{ labelOf(field) }}</legend>
      <FieldEditor
        v-for="child in childFields()"
        :key="child.key"
        :field="child"
        :modelValue="objectValue()[child.key]"
        @update:modelValue="(value: unknown) => updateChild(child.key, value)"
      />
    </fieldset>

    <fieldset v-else class="field__group">
      <legend>{{ labelOf(field) }}（{{ items().length }} 件）</legend>
      <div v-for="(item, index) in items()" :key="item.id" class="field__item">
        <div class="field__itemHead">
          <span class="field__itemNo">{{ index + 1 }}</span>
          <button type="button" @click="removeItem(item.id)">この{{ labelOf(field) }}を消す</button>
        </div>
        <FieldEditor
          v-for="child in childFields()"
          :key="child.key"
          :field="child"
          :modelValue="item[child.key]"
          @update:modelValue="(value: unknown) => updateItem(item.id, child.key, value)"
        />
      </div>
      <button type="button" class="field__add" @click="addItem">{{ labelOf(field) }}を足す</button>
    </fieldset>
  </div>
</template>

<style scoped>
.field {
  margin: 0.4rem 0;
}
.field__row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.field__row--block {
  flex-direction: column;
  align-items: stretch;
}
.field__label {
  min-width: 7rem;
  font-size: 0.85rem;
  color: #444;
}
.field__row input[type='text'],
.field__row input[type='number'],
.field__row select,
.field__row textarea {
  flex: 1;
  min-width: 0;
}
.field__unsupported,
.field__derived {
  margin: 0;
  display: flex;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #777;
}
.field__imageName {
  font-size: 0.8rem;
  color: #555;
}
.field__note {
  font-style: italic;
}
.field__group {
  border: 1px solid #ddd;
  padding: 0.4rem 0.6rem;
  margin: 0.4rem 0;
}
.field__group > legend {
  font-size: 0.85rem;
  color: #1a4f8a;
}
.field__item {
  border-top: 1px dashed #ddd;
  padding: 0.3rem 0;
}
.field__itemHead {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8rem;
}
.field__itemNo {
  color: #999;
}
</style>
