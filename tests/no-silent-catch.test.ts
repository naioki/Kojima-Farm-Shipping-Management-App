/**
 * 失敗を黙って消す書き方を静的走査で検知する（engineering.md §5・CLAUDE.md NEVER swallow errors）。
 *
 * supabase-js は失敗しても例外を投げず `{ error }` を返すため、書き込みを空の catch で囲んでも
 * 失敗は一切検知できない。付随更新は lib/api/side-effects.ts（runSideEffect 等）で error を確認する。
 *
 * 検知するもの（app / lib / components / hooks の .ts / .tsx）:
 *   1) 中身が空の catch 節            … catch {} / catch (e) {}
 *   2) 中身が空の Promise の catch    … .catch(() => {}) / .catch((e) => {})
 *   3) app/api と lib では、コメントだけで処理の無い catch も検知する
 *      … catch { // 無視 } / .catch(() => { /* 無視 *\/ })
 *      （supabase の書き込みを try で囲みコメントだけの catch を付けても、{ error } は検知できないため。
 *        サーバー側は console.error 等の処理を書くか、lib/api/side-effects.ts で error を確認する）
 * 画面側（components・app の画面・hooks）は、catch の中に「無視してよい理由のコメント」があれば対象外。
 * どうしても空・コメントのみで残すものは、下の許可リストに 1 件ずつ理由つきで載せる。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks']

/** 空の catch 節（本文が空白のみ）。コメントだけの本文は「理由が書いてある」ので対象外。 */
const EMPTY_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g
/** 空の Promise catch（.catch(() => {}) / .catch((e) => {}) / .catch(_ => {})）。 */
const EMPTY_PROMISE_CATCH_RE = /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/g
/** 本文が空白とコメントだけの catch 節（app/api・lib で検知）。 */
const COMMENT_ONLY_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g
/** 本文が空白とコメントだけの Promise catch（app/api・lib で検知）。 */
const COMMENT_ONLY_PROMISE_CATCH_RE =
  /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}\s*\)/g

interface AllowEntry {
  /** ルートからの相対パス（区切りは /） */
  file: string
  /** 許可する件数（増えたら検知する） */
  count: number
  /** 空のまま残してよい理由（必須） */
  reason: string
}

/**
 * app/api・lib で「コメントのみの catch」を残してよいもの（書き込みの失敗ではなく、本当に無視してよいもの）。
 * 中身が完全に空の catch は app/api・lib では許可しない。
 */
const SERVER_COMMENT_ONLY_ALLOWLIST: AllowEntry[] = [
  {
    file: 'lib/field/lang-context.tsx',
    count: 2,
    reason:
      '表示言語の localStorage 読み書き。プライベートモード等で使えないときは既定の言語のまま・次回起動時に既定へ戻るだけで、' +
      'データの保存失敗ではない（画面上の切り替えは効いている）',
  },
  {
    file: 'lib/excel/parse.ts',
    count: 1,
    reason: 'Shift_JIS の CSV として読めなかったときに、次の XLSX パーサーへ進むための分岐。失敗は次のパーサーが判定する',
  },
  {
    file: 'lib/supabase/server.ts',
    count: 1,
    reason:
      'Server Component からは cookie を set できない（Next.js の仕様）。セッション更新は middleware 側で行うので、ここは無視してよい（@supabase/ssr の公式の書き方）',
  },
]

const ALLOWLIST: AllowEntry[] = [
  {
    file: 'app/layout.tsx',
    count: 1,
    reason:
      'ダークモードの初期化用インラインスクリプト（文字列として <head> に埋め込む）。描画前に1行で動かす必要があり、' +
      'localStorage が使えない環境（プライベートモード等）では既定のライト表示のままでよい',
  },
]

function walk(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    // 走査対象のディレクトリが無いだけ（例: hooks を持たない構成）。走査しない
    return []
  }
  return names.flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    if (!/\.(ts|tsx)$/.test(name)) return []
    // テスト自身は走査しない（検知パターンを例として含むため）
    if (/\.test\.(ts|tsx)$/.test(name)) return []
    return [p]
  })
}

function rel(p: string): string {
  return relative(ROOT, p).split(sep).join('/')
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

function isServerSide(file: string): boolean {
  return file.startsWith('app/api/') || file.startsWith('lib/')
}

function matchAll(src: string, file: string, res: RegExp[]): string[] {
  const hits: string[] = []
  for (const re of res) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) hits.push(`${file}:${lineOf(src, m.index)}  ${m[0].replace(/\s+/g, ' ')}`)
  }
  return hits
}

/** ファイルごとの検知箇所（"path:line  抜粋"）。empty=中身が空、commentOnly=app/api・lib のコメントのみ（空を含む） */
function scan(): { empty: Map<string, string[]>; commentOnly: Map<string, string[]> } {
  const empty = new Map<string, string[]>()
  const commentOnly = new Map<string, string[]>()
  for (const d of SCAN_DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const src = readFileSync(file, 'utf8')
      const r = rel(file)
      const hits = matchAll(src, r, [EMPTY_CATCH_RE, EMPTY_PROMISE_CATCH_RE])
      if (hits.length > 0) empty.set(r, hits)
      if (isServerSide(r)) {
        const c = matchAll(src, r, [COMMENT_ONLY_CATCH_RE, COMMENT_ONLY_PROMISE_CATCH_RE])
        if (c.length > 0) commentOnly.set(r, c)
      }
    }
  }
  return { empty, commentOnly }
}

/** 文字列がサーバー側の基準（空・コメントのみの catch）に当たるか */
function hitsServerRule(s: string): boolean {
  COMMENT_ONLY_CATCH_RE.lastIndex = 0
  COMMENT_ONLY_PROMISE_CATCH_RE.lastIndex = 0
  return COMMENT_ONLY_CATCH_RE.test(s) || COMMENT_ONLY_PROMISE_CATCH_RE.test(s)
}

describe('空の catch で失敗を握りつぶさない', () => {
  const { empty: found, commentOnly } = scan()

  it('検知パターンが実際に効く（自己確認）', () => {
    const samples = ['try { a() } catch {}', 'try { a() } catch (e) {\n  }', 'p.catch(() => {})', 'p.catch((err) => { })']
    for (const s of samples) {
      EMPTY_CATCH_RE.lastIndex = 0
      EMPTY_PROMISE_CATCH_RE.lastIndex = 0
      expect(EMPTY_CATCH_RE.test(s) || EMPTY_PROMISE_CATCH_RE.test(s), s).toBe(true)
    }
    const ok = ['try { a() } catch {\n  // 理由: 表示用の控えなので無視\n}', "p.catch((e) => console.error('x', e))"]
    for (const s of ok) {
      EMPTY_CATCH_RE.lastIndex = 0
      EMPTY_PROMISE_CATCH_RE.lastIndex = 0
      expect(EMPTY_CATCH_RE.test(s) || EMPTY_PROMISE_CATCH_RE.test(s), s).toBe(false)
    }
  })

  it('サーバー側の基準はコメントだけの catch も検知し、処理があれば通す（自己確認）', () => {
    const bad = [
      'try { a() } catch {}',
      'try { await db.from("x").insert(r) } catch {\n  // 記録失敗で本処理は止めない\n}',
      'try { a() } catch (e) { /* 無視 */ }',
      'try { a() } catch {\n  // 1行目\n  /* 2行目 */\n}',
      'p.catch(() => {\n  // 無視\n})',
      'p.catch((e) => { /* 無視 */ })',
    ]
    for (const s of bad) expect(hitsServerRule(s), s).toBe(true)
    const ok = [
      "try { a() } catch (e) {\n  // 本処理は止めない\n  console.error('x', e)\n}",
      'try { a() } catch {\n  // 壊れた値は null\n  return null\n}',
      "p.catch((e) => console.error('x', e))",
      "p.catch((e) => {\n  // ログに残す\n  console.error('x', e)\n})",
    ]
    for (const s of ok) expect(hitsServerRule(s), s).toBe(false)
  })

  it('app/api と lib に、コメントだけで処理の無い catch が無い（理由つき許可リストを除く）', () => {
    const allowed = new Map(SERVER_COMMENT_ONLY_ALLOWLIST.map((a) => [a.file, a]))
    const unexpected: string[] = []
    for (const [file, hits] of commentOnly) {
      const a = allowed.get(file)
      if (!a || hits.length > a.count) unexpected.push(...hits)
    }
    expect(
      unexpected,
      `app/api・lib に処理の無い catch があります。console.error で記録するか、supabase の結果なら lib/api/side-effects.ts で error を確認してください:\n${unexpected.join('\n')}`,
    ).toEqual([])
  })

  it('サーバー側の許可リストに古い項目が残っていない・理由が書いてある', () => {
    for (const a of SERVER_COMMENT_ONLY_ALLOWLIST) {
      expect(a.reason.trim().length, a.file).toBeGreaterThan(10)
      expect(isServerSide(a.file), `${a.file} は app/api・lib ではない`).toBe(true)
      expect(commentOnly.get(a.file)?.length ?? 0, `${a.file} の件数が許可リストと違う（直したら減らす）`).toBe(a.count)
    }
  })

  it('app/api と lib に空の catch が無い（許可リストなし）', () => {
    const hits = [...found.entries()]
      .filter(([f]) => f.startsWith('app/api/') || f.startsWith('lib/'))
      .flatMap(([, h]) => h)
    expect(hits, `空の catch があります。lib/api/side-effects.ts で error を確認するか、理由を書いてください:\n${hits.join('\n')}`).toEqual([])
  })

  it('画面側（app・components・hooks）も、許可リスト以外に空の catch が無い', () => {
    const allowed = new Map(ALLOWLIST.map((a) => [a.file, a]))
    const unexpected: string[] = []
    for (const [file, hits] of found) {
      const a = allowed.get(file)
      if (!a || hits.length > a.count) unexpected.push(...hits)
    }
    expect(unexpected, `空の catch があります。理由コメントか console.error を書くか、許可リストに理由つきで載せてください:\n${unexpected.join('\n')}`).toEqual([])
  })

  it('許可リストに古い項目が残っていない（直したら消す）・理由が書いてある', () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.trim().length, a.file).toBeGreaterThan(10)
      expect(a.file.startsWith('app/api/') || a.file.startsWith('lib/'), `${a.file} は許可できない`).toBe(false)
      expect(found.get(a.file)?.length ?? 0, `${a.file} はもう空の catch が無いので許可リストから消す`).toBe(a.count)
    }
  })
})
