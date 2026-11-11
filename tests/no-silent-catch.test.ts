/**
 * 失敗を黙って消す書き方を静的走査で検知する（engineering.md §5・CLAUDE.md NEVER swallow errors）。
 *
 * supabase-js は失敗しても例外を投げず `{ error }` を返すため、書き込みを空の catch で囲んでも
 * 失敗は一切検知できない。付随更新は lib/api/side-effects.ts（runSideEffect 等）で error を確認する。
 *
 * 検知するもの（app / lib / components / hooks の .ts / .tsx）:
 *   1) 中身が空の catch 節            … catch {} / catch (e) {}
 *   2) 中身が空の Promise の catch    … .catch(() => {}) / .catch((e) => {})
 * catch の中に「無視してよい理由のコメント」か処理（console.error 等）があれば対象外。
 * どうしても空のまま残すものは、下の許可リストに 1 件ずつ理由つきで載せる。
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

interface AllowEntry {
  /** ルートからの相対パス（区切りは /） */
  file: string
  /** 許可する件数（増えたら検知する） */
  count: number
  /** 空のまま残してよい理由（必須） */
  reason: string
}

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

/** ファイルごとの検知箇所（"path:line  抜粋"） */
function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const d of SCAN_DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const src = readFileSync(file, 'utf8')
      const hits: string[] = []
      for (const re of [EMPTY_CATCH_RE, EMPTY_PROMISE_CATCH_RE]) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${m[0].replace(/\s+/g, ' ')}`)
      }
      if (hits.length > 0) found.set(rel(file), hits)
    }
  }
  return found
}

describe('空の catch で失敗を握りつぶさない', () => {
  const found = scan()

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
