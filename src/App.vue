<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { createDocumentEditor } from './document/editor'
import { flattenOutline, outline } from './document/outline'
import {
  dropTargetPos,
  moveSection,
  setSectionLevel,
  setPartRefDepth,
  canChangeLevel,
  isPartRefAt,
} from './document/sections'
import { docToMd, mdToDoc } from './document/markdown'
import { restoreHeadingMarksInJson } from './document/heading'
import { documentSchema } from './document/schema'
import OutlinePane from './ui/OutlinePane.vue'
import MaterialPane from './ui/MaterialPane.vue'
import TemplatePane from './ui/TemplatePane.vue'
import TemplateForm from './ui/TemplateForm.vue'
import CenterTabs from './ui/CenterTabs.vue'
import type { CenterTab } from './ui/centerTabs'
import { usePartStore } from './store/partStore'
import {
  createAutoSaver,
  deleteInstance,
  loadDocument,
  loadInstances,
  saveInstance,
} from './store/persistence'
import { analyzePlacement } from './document/placement'
import {
  collectPlacedRefs,
  remapPartRefsInJson,
  PART_REF_INLINE_NODE,
  PART_REF_NODE,
} from './document/partRefExtension'
import { legacyImagePartIdRemap, IMAGE_TEMPLATE_ID } from './template/render/image'
import { draftFromInstance } from './template/form'
import {
  partKeyOf,
  type Part,
  type TemplateDefinition,
  type TemplateInstance,
} from './template/model'

/**
 * v0 の画面。左に見出しツリー、右に 1 枚の連続文書（CONCEPT Q5）。
 *
 * ⚠ ツリーは doc から導出しているだけで、状態を持っていない。
 */
const store = usePartStore()
const editor = shallowRef<Editor | null>(null)
const revision = ref(0) // doc が変わったことをツリーに伝えるためだけの数
const notice = ref('')
const md = ref('')
const mdOpen = ref(false)

const headingTree = computed(() => {
  void revision.value // 依存を作る（doc は Vue のリアクティブ対象ではないため）
  const doc = editor.value?.state.doc
  // ⚠ parts を渡すのが契約（DESIGN 1-6-4）。渡さないと独立章パートの見出しがツリーに出ない。
  return doc ? outline(doc, store.parts) : []
})

/**
 * 配置の突き合わせ（DESIGN 1-5）。⚠ 「配置済みフラグ」をデータ側に持たせない。
 * 本文とパートの現状から**毎回**求める。
 */
const placement = computed(() => {
  void revision.value
  const doc = editor.value?.state.doc
  return doc
    ? analyzePlacement(doc, store.parts)
    : { unplaced: [], dangling: [], duplicated: [] as string[] }
})

const unplacedKeys = computed(() =>
  placement.value.unplaced.map((p) => partKeyOf(p.instanceId, p.partId)),
)

/**
 * ⭐ 中央ペインのタブ（DESIGN-v0.md §1-9）。
 *
 * ⚠ **これは新機能ではなく、仕様に戻す作業**（§1-9-1）。CONCEPT が最初から
 *   「まんなかにテキストエディタ、**もしくは固有エディタ**」と書いている。
 *
 * ⚠⚠ **閉じるのは明示操作のときだけ**（保存／やめる／タブの ✕）。
 *   左ペインのクリック・md 書き出しは**本文タブへ移るだけ**でフォームは閉じない——
 *   モードの暗黙切り替えだと「下書きが失われたのか隠れただけなのか」を利用者が見分けられない。
 */
const BODY_TAB_ID = 'body'
const FORM_TAB_ID = 'form'

/** いま開いているテンプレのフォーム（`null` ならフォームのタブは無い）。 */
const selectedTemplate = ref<TemplateDefinition | null>(null)
/** フォームの下書きに値が入っているか。⚠ 判定はフォーム側（新規＝空と違うか／編集＝開いた時と違うか）。 */
const formDirty = ref(false)

/**
 * ⭐ いま**編集**している素材（`null` なら新規作成）。§1-11。
 * ⚠ フォームの中身は開いた時に 1 度だけ作る（`initialDraft`）。以後は `TemplateForm` が持つ。
 */
const editingInstanceId = ref<string | null>(null)
const initialDraft = ref<Record<string, unknown> | null>(null)

/**
 * ⚠⚠ **フォームを作り直す単位**。同じテンプレでも「新規」と「素材Aの編集」と「素材Bの編集」は別物で、
 *   `def.id` だけを見ると**中身が前のまま残る**（`TemplateForm` の作り直しは `def.id` 変化が契機）。
 *   → `:key` に使って**開き直すたびに作り直す**。
 */
const formKey = computed(() =>
  editingInstanceId.value ? `edit:${editingInstanceId.value}` : `new:${selectedTemplate.value?.id ?? ''}`,
)
const activeTabId = ref<string>(BODY_TAB_ID)

/**
 * ⚠ **フォームのタブは同時に 1 つ**（§1-9-2）。ただし**器は複数タブ前提**なので、
 *   ここが配列を渡す形になっている（増やすときは push を足すだけ）。
 */
const centerTabs = computed<CenterTab[]>(() => {
  const tabs: CenterTab[] = [{ id: BODY_TAB_ID, label: '本文' }]
  const def = selectedTemplate.value
  if (def) {
    // ⚠ 編集中は名前で分かるようにする（新規と編集は見分けが付かないと、上書きの事故になる）
    tabs.push({
      id: FORM_TAB_ID,
      label: editingInstanceId.value ? `${def.name}（編集）` : def.name,
      closable: true,
      dirty: formDirty.value,
    })
  }
  return tabs
})

/**
 * ⭐⭐ **打った下書きが失われる操作**（§1-9-3a・ロイス「確認は逐一出しましょう」）。
 *
 * ⚠⚠ **確認は「何を聞いたか」ではなく「何をするか」を持つ。**
 *   `pendingAction` に**実行する操作そのもの**を入れ、承諾したらそれを走らせる——
 *   こうすると「帯に出ている文と、押したときに起きること」が構造的にずれない。
 *   経路が 3 つに増えたので、文言と処理を別々に持つと取り違えが起きうる。
 *
 * ⚠ 帯が出ている最中に別の経路を踏んだら、**後から踏んだ方で置き換える**
 *   （どちらも同じ下書きを捨てる操作なので、最後の意思を残すのが素直）。
 *   ⚠ 「出ている間は無視する」にすると、押しても何も起きない画面になる。
 */
type PendingAction =
  | { kind: 'closeForm' }
  | { kind: 'switchTemplate'; def: TemplateDefinition }
  /** ⭐ 4 経路目（§1-11-5）: 編集で別の素材を開く。⚠ 新しい確認機構を作らず同じ入口に載せる */
  | { kind: 'editInstance'; instanceId: string }

const pendingAction = ref<PendingAction | null>(null)

/** 帯に出す文。⚠ 何が失われるかを先に言う（「よろしいですか」だけでは判断できない）。 */
const pendingMessage = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'closeForm':
      return '打ちかけの内容があります。捨ててフォームを閉じますか？'
    case 'switchTemplate':
      return '打ちかけの内容があります。捨てて別のテンプレートを開きますか？'
    case 'editInstance':
      return '打ちかけの内容があります。捨てて別の素材を編集しますか？'
    default:
      return ''
  }
})

/**
 * 下書きを失う操作の入口はここ 1 本（§1-9-3a）。
 * ⚠⚠ **下書きが空なら聞かない。** 確認は「失われるものがあるとき」だけ意味を持つ——
 *   毎回出すと読まずに押す操作になって、機能そのものが死ぬ。
 */
function requestDestructive(action: PendingAction) {
  if (!formDirty.value) {
    runDestructive(action)
    return
  }
  pendingAction.value = action
}

function runDestructive(action: PendingAction) {
  pendingAction.value = null
  if (action.kind === 'closeForm') closeFormTab()
  else if (action.kind === 'editInstance') openInstanceEditor(action.instanceId)
  else openTemplateForm(action.def)
}

function onConfirmYes() {
  const action = pendingAction.value
  if (action) runDestructive(action)
}

/**
 * ⚠ 下書きが空になったら問いも畳む（打ちかけを自分で消した等）。
 *   残すと「もう無いものを捨てますか」と聞き続ける＝押しても何も起きないボタンになる。
 */
watch(formDirty, (dirty) => {
  if (!dirty) pendingAction.value = null
})

function openTemplateForm(def: TemplateDefinition) {
  selectedTemplate.value = def
  // ⚠ 新規で開くときは編集状態を落とす（残すと、次の保存が**別の素材を上書きする**）
  editingInstanceId.value = null
  initialDraft.value = null
  activeTabId.value = FORM_TAB_ID
}

/**
 * ⭐⭐ 生成済み素材をフォームで開く（§1-11）。**入口は複数でよいが、経路はこの 1 本**（§1-11-5）。
 *
 * ⚠ 下書きは**開いた時に 1 度だけ**作る（`draftFromInstance`）。
 *   ⚠⚠ **保存済みの `id` はここで持ち越される**——採番し直すと本文の参照が全部行方不明になる（§1-11-1）。
 */
function openInstanceEditor(instanceId: string) {
  const instance = store.instances[instanceId]
  const def = instance && store.definitions[instance.templateId]
  if (!instance || !def) {
    notice.value = 'その素材はもうありません'
    return
  }
  selectedTemplate.value = def
  editingInstanceId.value = instanceId
  initialDraft.value = draftFromInstance(def.fields, instance.data, instance.images)
  activeTabId.value = FORM_TAB_ID
}

/** 素材一覧の「編集」から。⚠ 下書きを失う操作なので、同じ 1 本の入口を通す（§1-9-3a の 4 経路目）。 */
function onEditMaterial(part: Part) {
  requestDestructive({ kind: 'editInstance', instanceId: part.instanceId })
}

/**
 * テンプレを選んだ＝中央にフォームのタブを開く（§1-9-5 の #1）。
 *
 * ⚠⚠ **選び直しは下書きを捨てる操作である**（`TemplateForm` が `def.id` の変化で作り直すため）。
 *   §1-9-3 は当初「既存動作なので変更しない」としていたが、**確認なしで消える穴として残った**
 *   （台帳 A55）。→ ✕ と同じ規則に載せる。
 */
function onSelectTemplate(def: TemplateDefinition) {
  // ⚠ 同じテンプレをもう一度選んでも下書きは作り直されない＝失うものが無い。聞かずに開く。
  //   ⚠⚠ ただし**編集中は別**——同じ定義でも「素材の編集」から「新規作成」へ移るのは
  //   下書きを捨てる操作である（近道に載せると、打った編集が確認なしで消える）。
  if (editingInstanceId.value === null && selectedTemplate.value?.id === def.id) {
    activeTabId.value = FORM_TAB_ID
    return
  }
  requestDestructive({ kind: 'switchTemplate', def })
}

/**
 * フォームのタブを閉じる（保存／やめる／✕ の確認後）。
 * ⚠ `formDirty` をここで落とす。閉じるときフォームは destroy されるので
 *   `update:dirty` は**もう飛んでこない**——落とし忘れると、次に開いたタブに
 *   前の下書きの印が点いたまま出る。
 */
function closeFormTab() {
  selectedTemplate.value = null
  editingInstanceId.value = null
  initialDraft.value = null
  formDirty.value = false
  // ⚠ 別経路（保存など）で閉じたときに問いが宙に浮かないよう、ここでも畳む。
  pendingAction.value = null
  activeTabId.value = BODY_TAB_ID
}

/** タブの ✕（§1-9-3a の 1 経路目）。 */
function onCloseTab(tabId: string) {
  if (tabId === FORM_TAB_ID) requestDestructive({ kind: 'closeForm' })
}

/**
 * フォームの「やめる」（§1-9-3a の 3 経路目）。
 * ⚠⚠ **✕ と同じ操作なので、同じ入口を通す。** 片方だけ確認すると、
 *   いま塞いだばかりの非対称をそのまま作り直すことになる。
 */
function onFormCancel() {
  requestDestructive({ kind: 'closeForm' })
}

/**
 * 本文タブへ移る。⚠ **フォームは閉じない**（§1-9-2）。
 * ⚠ `await` が要る: 本文は `v-show`（＝`display: none`）で隠れているので、
 *   描き直しの前に `focus()` すると当たらない。
 */
async function showBodyTab() {
  activeTabId.value = BODY_TAB_ID
  await nextTick()
}

const filePicker = ref<HTMLInputElement | null>(null)
/**
 * ファイルを選び終えたときに「追加」なのか「差し替え」なのかを覚えておく口。
 * ⚠ 追加のときは必ず null に戻す（戻さないと、次の「素材を追加」が差し替えになる）。
 */
const replaceTarget = ref<string | null>(null)

const saver = createAutoSaver({
  getDoc: () => editor.value?.getJSON() ?? { type: 'doc', content: [] },
  onError: (error) => {
    notice.value = `保存できませんでした: ${error instanceof Error ? error.message : String(error)}`
  },
})

onMounted(async () => {
  // ⚠ 同梱テンプレも、ユーザーが持ち込む定義とまったく同じ経路（loader.ts）で読む（Q6）。
  //   壊れていれば例外が飛ぶので、黙って「テンプレが 0 件の画面」にはならない。
  try {
    store.registerBundledTemplates()
  } catch (error) {
    notice.value = `同梱テンプレートを読めませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
  // ⚠ 本文より**先**に素材を読む。本文側の旧 partId の読み替えに、
  //   「どれが同梱テンプレ由来のインスタンスか」が要るため（下の remap）。
  let loadedInstances: TemplateInstance[] = []
  try {
    loadedInstances = await loadInstances()
    for (const instance of loadedInstances) store.upsertInstance(instance)
  } catch (error) {
    notice.value = `素材を読み出せませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }

  let initialContent: object | undefined
  try {
    const saved = (await loadDocument())?.doc
    // ⭐⭐ **入口で記号を補う**（`heading.ts` の不変条件）。
    //   旧版（記号を消す方式）が保存した doc には記号の無い見出しが入っており、
    //   そのまま開くと **左ペインから消え、1 文字打った瞬間に段落へ降格して自動保存で確定する**
    //   ＝**利用者の書いたものが黙って失われる**（3巡目監査が実アプリ経路で実測）。
    // ⚠ 併せて、§1-8 の英語化より前に保存された `partId` を読み替える。
    //   ここを通さないと、置いた画像が全部「行方不明のパート」になる（素材側だけ直しても足りない）。
    initialContent =
      saved === undefined
        ? undefined
        : (restoreHeadingMarksInJson(
            remapPartRefsInJson(saved, legacyImagePartIdRemap(loadedInstances)),
            documentSchema,
          ) as object)
  } catch (error) {
    notice.value = `前回の内容を読み出せませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }

  editor.value = createDocumentEditor({
    content: initialContent ?? {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ここに書きはじめる' }] }],
    },
    // ⚠ ツリーを作り直す経路はここ 1 本だけにしてある。
    //   以前は onSelectionUpdate でも版を進めていたが、
    //   **outline(doc, parts) は選択に依存しない**ので、あれは 2 本目の経路でしかなかった。
    //   経路が 2 本あると片方が死んでも検査が鳴らない（陽性対照で実測）ので消した。
    onUpdate: () => {
      revision.value += 1
      saver.schedule()
    },
  })
})

onBeforeUnmount(() => {
  // ⚠ stop() だけだと保留中の書き込みを捨てる。閉じる前に必ず流す。
  // ⚠ ただし **ブラウザのタブを閉じる／リロードするときはここが呼ばれる保証が無い**。
  //   自動保存の待ち時間（500ms）以内の打鍵は、その場合ひとつ前の状態に戻りうる。
  //   要検証[実ブラウザで、文字を打った直後（1 秒以内）にリロードして
  //          直前の打鍵が残るか。残らないなら beforeunload での書き込みを足すか、
  //          待ち時間を詰めるかを決める]
  void saver.flush().finally(() => saver.stop())
  editor.value?.destroy()
})

/**
 * ⚠ テストから本文を触るためだけの口。
 *   これが無いと「本文を編集すると左ペインが追従する」の**アプリ側の配線**（版 → computed）が
 *   1 行も通らないまま緑になる。
 */
defineExpose({ editor })

function onMove(payload: { grabbed: number; droppedOn: number }) {
  const ed = editor.value
  if (!ed) return
  // 「相手の場所を取る」の意味を doc の挿入位置へ翻訳する（sections.ts の責務）。
  const dest = dropTargetPos(ed.state.doc, payload.grabbed, payload.droppedOn)
  if (dest === null) {
    notice.value = 'そこへは移せません'
    return
  }
  const tr = moveSection(ed.state, payload.grabbed, dest)
  if (!tr) {
    notice.value = 'そこへは移せません'
    return
  }
  ed.view.dispatch(tr)
  notice.value = ''
}

/**
 * ⚠ 知らせを出す条件（要望4・2026-08-23）:
 *   **「限界に達している」だけでは何も出さない**——それはボタンが押せないことで示す。
 *   知らせは「**やってみたが、見えない理由で断られた**」ときだけ出す。
 *   いま該当するのは「配下の見出しが範囲外へ押し出される」1 つだけで、
 *   これは左ペインを見ても分からない（配下のレベルまでは読み取れない）。
 */
function onChangeLevel(payload: { pos: number; level: number }) {
  const ed = editor.value
  if (!ed) return
  const result = canChangeLevel(ed.state.doc, payload.pos, payload.level)
  if (!result.ok) {
    notice.value =
      result.reason === 'descendantsOutOfRange'
        ? 'この節の中に、これ以上ずらせない見出しがあります'
        : ''
    return
  }
  // ⚠⚠ **書き換える先が違う**（§1-3-3e-2）——見出しは本文の記号、パート参照はノードの属性。
  //   ⚠ 取り違えると「押せるのに何も起きない」になる（記号が無いので書き換え対象が 0 件）。
  const tr = isPartRefAt(ed.state.doc, payload.pos)
    ? setPartRefDepth(ed.state, payload.pos, payload.level)
    : setSectionLevel(ed.state, payload.pos, payload.level)
  if (!tr) {
    notice.value = ''
    return
  }
  ed.view.dispatch(tr)
  notice.value = ''
}

/**
 * ドラッグ中の挿入位置ガイド（要望3）。
 * ⭐ **`dropTargetPos()` の値そのものを可視化する。** 判定と別の規則を持たせない。
 */
const guide = ref<number | 'end' | null>(null)

function onDragOver(payload: { grabbed: number; over: number }) {
  const ed = editor.value
  if (!ed) return
  const dest = dropTargetPos(ed.state.doc, payload.grabbed, payload.over)
  if (dest === null) {
    guide.value = null
    return
  }
  // 挿入位置（doc 上の境界）を、左ペインのどの項目の手前かに翻訳する。
  const nextItem = flattenOutline(headingTree.value).find((item) => item.pos >= dest)
  guide.value = nextItem ? nextItem.pos : 'end'
}

function onDragEnd() {
  guide.value = null
}

/**
 * 左ペインの見出しをクリック（§1-9-5 の #4）。
 * ⚠⚠ **本文タブへ移るだけ。フォームのタブは残す。**
 */
async function onSelect(pos: number) {
  await showBodyTab()
  editor.value?.commands.focus(pos + 1)
}

/** 「素材を追加」→ ファイルを選ぶ口を開く。⚠ 利用者にテンプレートの存在を見せない（1-7-2）。 */
function onAddImage() {
  replaceTarget.value = null
  filePicker.value?.click()
}

/**
 * 「差し替え」→ 同じ口を開く。
 * ⚠ **本文には一切触らない。** データ側を入れ替えるだけで、置かれている全箇所が同時に変わる
 *   （本文は参照しか持たないので、これが自動的に成り立つ・S7-3）。
 */
function onReplaceMaterial(part: Part) {
  replaceTarget.value = part.instanceId
  filePicker.value?.click()
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // ⚠ 同じファイルを続けて選べるように、値は毎回捨てる（change が飛ばなくなる）。
  input.value = ''
  const replaceTo = replaceTarget.value
  replaceTarget.value = null
  if (!file) return

  const instance = replaceTo ? store.replaceImage(replaceTo, file) : store.addImage(file, file.name)
  // 差し替え先が既に消えていた場合（一覧を開いたまま別経路で消した等）は何も残さない。
  if (!instance) {
    notice.value = 'その素材はもうありません'
    return
  }
  try {
    // ⚠ 保存まで含めて 1 つの操作。ここを忘れると、画面では差し替わったのに
    //   リロードで元に戻る（差し替えたつもりのものが黙って巻き戻る）。
    await saveInstance(instance)
    notice.value = ''
  } catch (error) {
    notice.value = `素材を保存できませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

/**
 * 素材を本文へ挿す。
 * ⚠ どのノードで置くかは **パートの形態**が決める（1-7-3）。
 *   `inline`（画像はこれ）は段落の中に置ける inline 版、`section` はブロック版。
 *   「単独の行にしたい」は**空の段落へ置く**ことで表す＝配置の側の話であって、
 *   パートの側で形を変える話ではない。
 */
async function onInsertMaterial(part: Part) {
  const ed = editor.value
  if (!ed) return
  // ⚠ 本文への操作なので本文タブへ移る（左ペインのクリックと同じ扱い・フォームは閉じない）。
  //   隠れたままだと**挿さったものが見えず、`focus()` も当たらない**。
  await showBodyTab()
  const type = part.form === 'section' ? PART_REF_NODE : PART_REF_INLINE_NODE
  // ⚠ `scrollIntoView: false` は意図的。挿し込むのは**利用者が直前に居た位置**なので、
  //   そこへ自動スクロールし直す必要が無い（画面が跳ねる方が邪魔になる）。
  ed.chain()
    .focus(undefined, { scrollIntoView: false })
    .insertContent({ type, attrs: { instanceId: part.instanceId, partId: part.partId } })
    .run()
}

/**
 * 素材を消す。
 * ⚠⚠ **消す前に「本文に何箇所置かれているか」を数えて知らせる**（S7-2・完了条件 #4）。
 *   消した後では表示名がストアから消えていて、「何が行方不明になったか」を言えない。
 *   本文側の参照は**残す**（勝手に本文を書き換えない）。残った参照は「行方不明のパート」として見える。
 */
async function onRemoveMaterial(part: Part) {
  // ⚠⚠ **消えるのは素材（インスタンス）まるごと**なので、数えるのも知らせるのも素材の全パート分。
  //   押した 1 件だけを数えると、他のパートが置かれていた箇所を黙って行方不明にする。
  const partCount = store.partsOfInstance(part.instanceId).length
  const placedCount = countPlacedOfInstance(part.instanceId)
  store.removeInstance(part.instanceId)
  revision.value += 1
  const what =
    partCount > 1 ? `「${part.title}」の素材（パート ${partCount} 件）` : `「${part.title}」`
  notice.value =
    placedCount > 0
      ? `${what}を消しました。本文に ${placedCount} 箇所、行方不明の参照が残っています`
      : `${what}を消しました`
  try {
    await deleteInstance(part.instanceId)
  } catch (error) {
    notice.value = `素材を消せませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

/**
 * その**素材**（インスタンス）が本文に何箇所置かれているか——パートの別は問わない。
 * ⚠ 走査は document 層の 1 本を使う（数え方を増やさない）。
 * ⚠ パート単位で数えると、複数パートの素材を消したときに件数を過少申告する。
 */
function countPlacedOfInstance(instanceId: string): number {
  const doc = editor.value?.state.doc
  if (!doc) return 0
  return collectPlacedRefs(doc).filter((ref) => ref.instanceId === instanceId).length
}

/**
 * テンプレート一覧に並べる定義。⚠ 同梱と持ち込みを区別しない（Q6）。
 *
 * ⚠⚠ **画像だけは一覧に出さない**（§1-7-2 の 2026-08-24 決定・台帳 A48）。
 *   一覧から画像を選んで保存すると **画像の付けようがない空パートが 1 件**生まれ、
 *   「未配置 N 件」にも入る（`image` 型の入力欄がまだ無いので、この経路では必ず空になる）。
 *   **画像の入口は「素材を追加」ボタン 1 本**である。
 *
 * ⚠ 除外は**この UI 層だけ**で行う。定義そのものは今までどおり登録されているし、
 *   下層（`derivePartsOf` / 保存 / 配置）は 1 行も画像を知らない（§1-7-2「内部で特別扱いしない」）。
 */
const templateList = computed(() =>
  Object.values(store.definitions).filter((def) => def.id !== IMAGE_TEMPLATE_ID),
)

/** 「差し替え」を出してよい素材（＝定義に画像欄がある）。⚠ 判定はストア側（宣言を読む）。 */
const replaceableInstanceIds = computed(() =>
  Object.keys(store.instances).filter((id) => store.imageFieldKeyOfInstance(id) !== undefined),
)

/**
 * テンプレのフォームから素材を 1 件作る（P2 完了条件 #2〜#4）。
 * ⚠ **パートは作らない。** データを足すだけで、パートは `derivePartsOf()` が導出する
 *   （P0 知見 1: 導出したものをデータ側に持たせない）。
 */
async function onFormSave(data: Record<string, unknown>, images: Record<string, Blob>) {
  const def = selectedTemplate.value
  if (!def) return
  const editingId = editingInstanceId.value
  // ⚠ 先に閉じる（§1-9-5 の #5「保存でフォームのタブが閉じ、本文へ戻る」）。
  //   保存の成否を待ってから閉じると、書き込みが遅い環境で**押したのに閉じない**時間ができる。
  closeFormTab()
  if (editingId) await onUpdateInstance(editingId, data, images)
  else await onCreateFromTemplate(def.id, data, images)
}

/**
 * ⭐ 生成済み素材を上書き保存する（§1-11）。
 * ⚠⚠ **新しいインスタンスを作らない。** 作ると本文の参照が全部行方不明になる。
 */
async function onUpdateInstance(
  instanceId: string,
  data: Record<string, unknown>,
  images: Record<string, Blob>,
) {
  const instance = store.updateInstance(instanceId, data, images)
  if (!instance) {
    notice.value = 'その素材はもうありません'
    return
  }
  try {
    await saveInstance(instance)
    notice.value = `素材を更新しました（パート ${store.partsOfInstance(instanceId).length} 件）`
  } catch (error) {
    notice.value = `素材を保存できませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

async function onCreateFromTemplate(
  templateId: string,
  data: Record<string, unknown>,
  images: Record<string, Blob> = {},
) {
  const instance = store.createInstance(templateId, data, images)
  try {
    await saveInstance(instance)
    const born = store.partsOfInstance(instance.id).length
    notice.value = `素材を作りました（パートが ${born} 件生まれました）`
  } catch (error) {
    notice.value = `素材を保存できませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

/** ⚠ md の書き出し・読み込みは**本文への操作**なので本文タブへ移る（フォームは閉じない・§1-9-2）。 */
async function exportMd() {
  const doc = editor.value?.state.doc
  if (!doc) return
  await showBodyTab()
  md.value = docToMd(doc)
  mdOpen.value = true
}

async function importMd() {
  const ed = editor.value
  if (!ed) return
  await showBodyTab()
  try {
    const doc = mdToDoc(md.value, ed.state.schema)
    ed.commands.setContent(doc.toJSON())
    notice.value = 'md を読み込みました'
  } catch (error) {
    notice.value = `md を読み込めませんでした: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}
</script>

<template>
  <div class="app">
    <header class="app__header">
      <h1>シナリオエディタ</h1>
      <div class="app__actions">
        <button type="button" @click="exportMd">md で書き出す</button>
        <button type="button" :disabled="!mdOpen" @click="importMd">md を読み込む</button>
      </div>
    </header>
    <p v-if="notice" class="app__notice" role="status">{{ notice }}</p>
    <!-- ⚠ 下書きを失う操作の確認（§1-9-3a）。ブラウザ既定の `confirm()` は使わない——
         このアプリの知らせは画面内の帯なので、ここだけ OS の窓を開くと
         「止まったときに何が出るか」が別物になる。 -->
    <p v-if="pendingAction" class="app__confirm" role="alert">
      <span class="app__confirmText">{{ pendingMessage }}</span>
      <button type="button" class="app__confirmYes" @click="onConfirmYes">捨てて続ける</button>
      <button type="button" class="app__confirmNo" @click="pendingAction = null">
        やっぱりやめる
      </button>
    </p>
    <div class="app__body">
      <OutlinePane
        class="app__outline"
        :items="headingTree"
        :guide="guide"
        @move="onMove"
        @changeLevel="onChangeLevel"
        @select="onSelect"
        @dragOver="onDragOver"
        @dragEnd="onDragEnd"
      />
      <!-- ⭐ 中央はタブ（§1-9）。「本文」は常にある固定タブで、テンプレのフォームは
           タブとして開く。⚠⚠ 中身は器の側が `v-show` で保持する（`v-if` にしない）。 -->
      <main class="app__center">
        <CenterTabs
          :tabs="centerTabs"
          :activeId="activeTabId"
          @select="activeTabId = $event"
          @close="onCloseTab"
        >
          <template #body>
            <!-- ⚠ この `v-if` は**初期化用**（エディタが立ち上がるまで）。
                 タブの切り替えでは外れない（外すと Tiptap を作り直すことになる）。 -->
            <div class="app__editor">
              <EditorContent v-if="editor" :editor="editor" />
            </div>
          </template>
          <template #form>
            <TemplateForm
              v-if="selectedTemplate"
              :key="formKey"
              :def="selectedTemplate"
              :initialDraft="initialDraft"
              @save="onFormSave"
              @cancel="onFormCancel"
              @update:dirty="formDirty = $event"
            />
          </template>
        </CenterTabs>
      </main>
      <!-- ⚠ 右の列は 2 段。上が「何を作れるか」（定義）・下が「何が置けるか」（パート）。
           1-7-1 のとおり層が違うので混ぜない。 -->
      <div class="app__right">
        <TemplatePane
          class="app__templates"
          :definitions="templateList"
          :selectedId="selectedTemplate?.id ?? null"
          @select="onSelectTemplate"
        />
        <MaterialPane
          class="app__materials"
          :parts="store.parts"
          :unplacedKeys="unplacedKeys"
          :replaceableInstanceIds="replaceableInstanceIds"
          @addImage="onAddImage"
          @insert="onInsertMaterial"
          @replace="onReplaceMaterial"
          @edit="onEditMaterial"
          @remove="onRemoveMaterial"
        />
      </div>
    </div>
    <!-- ⚠ 見えない口。「素材を追加」のボタンから開く（1-7-2: テンプレートの存在は見せない） -->
    <input
      ref="filePicker"
      class="app__file"
      type="file"
      accept="image/*"
      aria-label="画像を選ぶ"
      @change="onFileChosen"
    />
    <section v-if="mdOpen" class="app__md">
      <label for="md">md（書き出した内容。直してから読み込めます）</label>
      <textarea id="md" v-model="md" rows="10"></textarea>
    </section>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: system-ui, sans-serif;
}
.app__header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #ddd;
}
.app__header h1 {
  font-size: 1rem;
  margin: 0;
}
.app__notice {
  margin: 0;
  padding: 0.25rem 1rem;
  background: #fff6d5;
  font-size: 0.9rem;
}
.app__confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.3rem 1rem;
  background: #fff1f0;
  border-bottom: 1px solid #f0b7b2;
  font-size: 0.9rem;
}
.app__body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.app__outline {
  width: 16rem;
  border-right: 1px solid #ddd;
}
.app__right {
  display: flex;
  flex-direction: column;
  width: 18rem;
  min-height: 0;
  border-left: 1px solid #ddd;
}
.app__templates {
  flex: 0 1 auto;
  max-height: 45%;
  border-bottom: 1px solid #ddd;
}
.app__materials {
  flex: 1 1 auto;
  min-height: 0;
}
.app__file {
  display: none;
}
.app__center {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.app__editor {
  padding: 1rem 2rem;
}
.app__md {
  border-top: 1px solid #ddd;
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
}
.app__md textarea {
  width: 100%;
  font-family: monospace;
}

/*
 * ⚠ 以下はエディタの中身（ProseMirror が作る DOM）に当てるので :deep が要る。
 */

/* 要望1: ブラウザ既定の contenteditable の枠を消す。
   ⚠ 消しっぱなしにするとフォーカスの所在が分からなくなるので、
     代わりに「いまカーソルが居るブロック」を示す（CurrentBlock 拡張）。 */
.app__editor :deep(.ProseMirror) {
  outline: none;
}
.app__editor :deep(.ProseMirror > *) {
  /* 印の分の場所を先に取る（印が出た時に行が動かないように） */
  border-left: 3px solid transparent;
  padding-left: 0.5rem;
  margin-left: -0.75rem;
}
.app__editor :deep(.current-block) {
  border-left-color: #2b6cb0;
  background: #f4f8fd;
}

/* 要望2: 見出しは **大きさを変えない**。
   ロイス:「強調も文字の大きさを変更するのではなくて、やるなら別の方法がいい。色がかわるぐらい」 */
.app__editor :deep(.ProseMirror h1),
.app__editor :deep(.ProseMirror h2),
.app__editor :deep(.ProseMirror h3),
.app__editor :deep(.ProseMirror h4),
.app__editor :deep(.ProseMirror h5),
.app__editor :deep(.ProseMirror h6) {
  font-size: 1rem;
  font-weight: 600;
  color: #1a4f8a;
  margin: 0.6em 0 0.2em;
}

/* 記号そのものは本物のテキストとして残っている。装飾で淡く見せるだけ。 */
.app__editor :deep(.heading-mark) {
  color: #9aa5b1;
  font-family: monospace;
}
</style>
