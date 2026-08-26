/**
 * liquid エンジンの**実行時オプション**（DESIGN-v0.md §1-13-1c・移行 P-b）。
 *
 * ⭐⭐ **このファイルの合格条件は「設定した」ではなく「設定が効いている」**である。
 *   `engine.options.x === y` だけを見る述語は、`new Liquid()` がその値を無視していても緑になる。
 *   → **原則として「壊れたテンプレを実際に投げて、例外が飛ぶ」側で書く。**
 *   値だけを見る述語を置いた箇所には、そうした理由をその場に書いてある。
 *
 * ⚠ **時間のアサートは書かない。** liquidjs は決められた検査点でしか経過時間を見ないので、
 *   テンプレの形状によって `renderLimit` を大きく超過する（engine.ts の注記・実測 18 倍）。
 *   ここで測ると**環境と形状に依存して落ちるテスト**になる。見るのは例外の型と文面だけ。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AssertionError,
  Liquid,
  LiquidError,
  ParseError,
  RenderError,
  UndefinedVariableError,
  version as installedLiquidVersion,
} from 'liquidjs'
import {
  createLiquidEngine,
  defaultLiquidEngine,
  htmlLiquidEngine,
  liquidOptionsFor,
  markdownLiquidEngine,
  LIQUID_RENDER_LIMIT_MS,
} from '../engine'

/** 両方のエンジンに同じ検査を当てるための組。用途で分かれるのは `outputEscape` だけのはず。 */
const ENGINES = [
  ['html', htmlLiquidEngine],
  ['markdown', markdownLiquidEngine],
] as const

describe('strictVariables — 未定義変数は黙って空文字にならない（§1-13-1c）', () => {
  it.each(ENGINES)(
    '%s: 例外が飛ぶ（既定の false なら空文字で素通りする）',
    async (_name, engine) => {
      await expect(engine.parseAndRender('部屋: {{ roomName }}')).rejects.toThrow(
        UndefinedVariableError,
      )
    },
  )

  it('文面は「どの変数か」と行・列を含む（そのまま利用者に見せられる・翻訳しない）', async () => {
    const error = await defaultLiquidEngine.parseAndRender('|{{ rooms.zz9 }}|', { rooms: {} }).then(
      () => null,
      (e: unknown) => e as LiquidError,
    )
    expect(error).toBeInstanceOf(UndefinedVariableError)
    expect(error!.message).toContain('undefined variable: rooms.zz9')
    expect(error!.message).toContain('line:1')
    // `context` に「該当行＋ ^ のポインタ」が整形済みで入っている（研究 2026-08-26 の①）
    expect(error!.context).toContain('|{{ rooms.zz9 }}|')
    expect(error!.context).toContain('^')
  })

  it('⚠ 反証: 定義されている変数なら同じテンプレが通る（例外が「常に飛ぶ」わけではない）', async () => {
    expect(
      await defaultLiquidEngine.parseAndRender('部屋: {{ roomName }}', { roomName: 'A-1' }),
    ).toBe('部屋: A-1')
  })
})

describe('strictFilters — 存在しないフィルタは黙って無視されない（§1-13-1c）', () => {
  it.each(ENGINES)(
    '%s: 例外が飛ぶ（既定の false ならフィルタが消えて素通りする）',
    async (_name, engine) => {
      await expect(
        engine.parseAndRender('{{ name | nosuchfilter }}', { name: 'ねこ' }),
      ).rejects.toThrow(ParseError)
    },
  )

  it('文面は「どのフィルタか」を含む', async () => {
    await expect(
      defaultLiquidEngine.parseAndRender('{{ name | nosuchfilter }}', { name: 'ねこ' }),
    ).rejects.toThrow(/undefined filter: nosuchfilter/)
  })

  it('⚠ 反証: 実在するフィルタなら通る（フィルタが全部禁止されたわけではない）', async () => {
    expect(await defaultLiquidEngine.parseAndRender('{{ name | upcase }}', { name: 'abc' })).toBe(
      'ABC',
    )
  })
})

describe('renderLimit — 終わらないレンダリングを止める（§1-13-1c）', () => {
  it.each(ENGINES)('%s: 決定値 10 秒が入っている', (_name, engine) => {
    expect(engine.options.renderLimit).toBe(10_000)
    expect(LIQUID_RENDER_LIMIT_MS).toBe(10_000)
  })

  /**
   * ⚠ **これは「前提の確認」であって、私たちのコードの検査ではない**
   *   （`liquidOptionsFor` を壊してもこのテストは緑のまま。上の値述語がその側を見張る）。
   *
   * ⭐ それでも要る理由: 決定 §1-13-1c は「`renderLimit` 1 本で無限ループを覆える」という
   *   **liquidjs の性質に賭けている**。賭けの中身をここに固定しておかないと、
   *   将来の版で止まらなくなったときに**上の値述語は緑のまま**すり抜ける。
   *
   * ⚠ 10 秒待つテストにはしない（毎回 10 秒はスイートの毒）。**同じオプション一式のまま
   *   制限だけ 300ms に縮めて**、構成そのものが再帰 `{% render %}` を止めることを見る。
   */
  it('本物の無限ループ（自己参照 `{% render %}`）が RenderError で止まる', async () => {
    const engine = new Liquid({
      ...liquidOptionsFor('markdown'),
      renderLimit: 300,
      templates: { loop: '{% render "loop" %}' },
    })
    const error = await engine.parseAndRender('{% render "loop" %}').then(
      () => null,
      (e: unknown) => e as LiquidError,
    )
    expect(error).toBeInstanceOf(RenderError)
    expect(error!.message).toContain('template render limit exceeded')
    // ⚠ 止まるだけでなく「どこで」も出る＝利用者に見せられる形（§1-13-1c）
    expect(error!.message).toContain('file:loop')
  })

  it('⚠ 反証: 制限内で終わるテンプレは止められない（制限が常に飛ぶわけではない）', async () => {
    const engine = new Liquid({
      ...liquidOptionsFor('markdown'),
      renderLimit: 300,
      templates: { row: '.' },
    })
    expect(await engine.parseAndRender('{% render "row" %}{% render "row" %}')).toBe('..')
  })
})

describe('outputEscape — HTML 用と md 用でエンジンを分ける（§1-13-1c）', () => {
  const DANGEROUS = '<b>&"\'</b>'

  it('HTML 側は `{{ }}` を自動エスケープする', async () => {
    expect(await htmlLiquidEngine.parseAndRender('{{ x }}', { x: DANGEROUS })).toBe(
      '&lt;b&gt;&amp;&#34;&#39;&lt;/b&gt;',
    )
  })

  it('md 側は値をそのまま出す（md の記号がエスケープされると表も見出しも壊れる）', async () => {
    expect(await markdownLiquidEngine.parseAndRender('{{ x }}', { x: DANGEROUS })).toBe(DANGEROUS)
  })

  it('⭐ 2 つは別インスタンス（`outputEscape` はエンジン単位でしか切り替えられない）', () => {
    expect(htmlLiquidEngine).not.toBe(markdownLiquidEngine)
    expect(typeof htmlLiquidEngine.options.outputEscape).toBe('function')
    expect(markdownLiquidEngine.options.outputEscape).toBeUndefined()
  })

  it('HTML 側でも `| raw` で個別に外せる（テンプレ作者の逃げ道が塞がっていない）', async () => {
    expect(await htmlLiquidEngine.parseAndRender('{{ x | raw }}', { x: '<b>' })).toBe('<b>')
  })

  it('⚠ 用途を省略できない（エスケープの有無が黙って決まらない）', () => {
    // @ts-expect-error 引数は必須。型で塞いだことをテストからも固定する。
    expect(() => createLiquidEngine()).toBeTypeOf('function')
    expect(createLiquidEngine('html').options.outputEscape).toBeTypeOf('function')
    expect(createLiquidEngine('markdown').options.outputEscape).toBeUndefined()
  })

  it('既定のエンジンは md 側（P-a の素の `new Liquid()` と同じ振る舞い＝この commit で変わらない）', () => {
    expect(defaultLiquidEngine).toBe(markdownLiquidEngine)
  })
})

describe('⚠ parseLimit だけ例外の形が違う（研究 2026-08-26 の 6b）', () => {
  it.each(ENGINES)(
    '%s: 本番のエンジンには parseLimit を設定していない（＝この形は飛ばない）',
    (_name, engine) => {
      // ⚠ 設定していないことが述語である。§1-13-1c「他のガードは入れない」。
      //   ここに有限値を入れると、下の `context` を持たない例外が本番経路に現れる。
      expect(engine.options.parseLimit).toBe(Infinity)
      expect(engine.options.memoryLimit).toBe(Infinity)
    },
  )

  it('⭐ parseLimit を設定した場合、飛ぶのは LiquidError ではなく AssertionError で `context` を持たない', async () => {
    const engine = new Liquid({ ...liquidOptionsFor('markdown'), parseLimit: 1 })
    const error = await engine.parseAndRender('部屋がふたつ').then(
      () => null,
      (e: unknown) => e as Error & { context?: unknown; token?: unknown },
    )
    expect(error).toBeInstanceOf(AssertionError)
    // ⚠⚠ ここが分岐の本体。`e.context` を一律に読む UI はこの 1 ケースだけで壊れる。
    expect(error).not.toBeInstanceOf(LiquidError)
    expect(error!.context).toBeUndefined()
    expect(error!.token).toBeUndefined()
    expect(error!.message).toBe('parse length limit exceeded')
    // 行・列も無い（他の 10 種は必ず持っている）
    expect(error!.message).not.toContain('line:')
  })

  it('⚠ 反証: 他の壊し方は LiquidError 系で `context` を持つ（違いが parseLimit 固有だと言える）', async () => {
    const error = await defaultLiquidEngine.parseAndRender('{% for x in y %}').then(
      () => null,
      (e: unknown) => e as LiquidError,
    )
    expect(error).toBeInstanceOf(LiquidError)
    expect(error!.context).toBeTypeOf('string')
  })
})

// ---------------------------------------------------------------------------
// バージョンの下限（CVE-2026-45618・critical・10.26.0 未満は RCE）
// ---------------------------------------------------------------------------

/** `10.29.0` → `[10, 29, 0]`。字句比較だと `"10.9" > "10.26"` になるので必ず数値で比べる。 */
function toTuple(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  if (m === null) throw new Error(`バージョンとして読めません: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isAtLeast(actual: string, minimum: string): boolean {
  const a = toTuple(actual)
  const b = toTuple(minimum)
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true
}

const MINIMUM = '10.26.0'

describe('liquidjs のバージョン下限（CVE-2026-45618）', () => {
  it('比べ方そのものが正しい（前提の確認・字句比較だと落ちる組）', () => {
    expect(isAtLeast('10.29.0', MINIMUM)).toBe(true)
    expect(isAtLeast('10.26.0', MINIMUM)).toBe(true)
    expect(isAtLeast('10.9.0', MINIMUM)).toBe(false) // ⚠ 文字列比較なら true になってしまう組
    expect(isAtLeast('9.99.0', MINIMUM)).toBe(false)
    expect(isAtLeast('11.0.0', MINIMUM)).toBe(true)
  })

  it('⭐ いま入っている実物が 10.26.0 以上', () => {
    expect(isAtLeast(installedLiquidVersion, MINIMUM)).toBe(true)
  })

  it('⭐ package.json の宣言が 10.26.0 未満を許さない', () => {
    // ⚠ `import.meta.url` は jsdom 環境では file: URL にならない（実測）。cwd から引く。
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe('trpg-scenario-editor') // ⚠ 別の package.json を読んでいないこと
    const range = pkg.dependencies['liquidjs']
    // ⚠ **形を絞ってから判定する（fail-closed）**。`>=`・`||`・`*`・`x` を許すと
    //   「10.26.0 以上か」を 1 行では判定できない。書式を変えたくなったらここを直す。
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/)
    expect(isAtLeast(range!.slice(1), MINIMUM)).toBe(true)
  })
})
