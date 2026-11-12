/**
 * 本番 Supabase に無い列（engineering.md §1・2026-11-04 確認）を、フォールバック無しで読み書きしていないかの静的検査。
 *
 * 本番に無い9列:
 * - delivery_destinations: departure_time / shipping_route_name / pack_sort_order / default_container_type
 * - order_items: bag_type / seal_text / has_seal / is_manual_modified
 * - customer_product_rules: seal_text
 *
 * `app` と `lib`（テストを除く）の `.from('<table>')` の呼び出しごとに、
 * - `.select('...')` の文字列にその表の欠落列が含まれる、または
 * - insert / update / upsert のペイロード（同じ呼び出しのインライン、または直前で組み立てた変数）に欠落列のキーがある
 * ものを「該当」とし、その付近（同じ関数のおおよその範囲）に
 * - `lib/supabase/missing-column.ts` の関数（isMissingColumnError / writeDroppingMissingColumns / missingColumnName）の利用、または
 * - 同じ表を欠落列なしの基本列で取り直す select
 * があれば「フォールバックあり」とする。無いものは ALLOWLIST（理由つき）に載っているものだけ通す。
 *
 * 文字数の窓で「同じ関数」を近似しているため完全ではない。誤検知は ALLOWLIST に理由を書いて載せ、
 * 見逃しを減らすためペイロードのキーは広めに拾う。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

export const MISSING_COLUMNS: Record<string, string[]> = {
  delivery_destinations: ['departure_time', 'shipping_route_name', 'pack_sort_order', 'default_container_type'],
  order_items: ['bag_type', 'seal_text', 'has_seal', 'is_manual_modified'],
  customer_product_rules: ['seal_text'],
}

/**
 * フォールバックが無くても通すもの（ファイル → 理由）。DB に送らない・列が無くても壊れない場合に限る。
 * キーは `相対パス::表名`。
 */
const ALLOWLIST: Record<string, string> = {}

/** 呼び出しの後ろ・前で「同じ関数」とみなす文字数 */
const WINDOW_AFTER = 2500
const WINDOW_BEFORE = 3000
const FALLBACK_FN_RE = /\b(isMissingColumnError|writeDroppingMissingColumns|missingColumnName)\s*(?:<[^()]*>)?\s*\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(text)
}

/** オブジェクトのキー・代入として列名が出てくるか（型注釈 `col?:` は除く） */
function hasPayloadKey(text: string, col: string): boolean {
  return new RegExp(
    `(?:[{,\\s]${col}\\s*:(?!:)|\\.${col}\\s*=(?![=>])|\\[['"]${col}['"]\\]\\s*=(?![=>])|['"]${col}['"]\\s*:|[{,]\\s*${col}\\s*[,}])`,
  ).test(text)
}

/** start から括弧の釣り合いを取りながら、深さ0で改行・; に達するまでの文字列 */
function balancedFrom(src: string, start: number): string {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth < 0) return src.slice(start, i)
    } else if (depth === 0 && (ch === ';' || (ch === '\n' && i > start && /\S/.test(src.slice(start, i))))) {
      // 次の行が . や ? : などで続く場合は継続
      const rest = src.slice(i + 1).match(/^\s*(\S)/)?.[1]
      if (ch === ';' || !rest || !/[.?:&|+\-]/.test(rest)) return src.slice(start, i)
    }
  }
  return src.slice(start)
}

/** `.select(` の直後の文字列リテラル（'..' / ".." / `..`）を返す */
function selectLiterals(chain: string): string[] {
  const out: string[] = []
  const re = /\.select\(\s*(['"`])([\s\S]*?)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(chain))) out.push(m[2]!)
  return out
}

/** select 文字列が使う欠落列（自表の列と、埋め込み `T(...)` / `T!hint(...)` / `alias:T(...)` の列） */
function missingInSelect(table: string, lit: string): string[] {
  const out = new Set<string>()
  // 埋め込み部分を取り出す（入れ子1段まで）
  const embedRe = /\b([a-z_]+)(?:![a-z_]+)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
  let top = lit
  let m: RegExpExecArray | null
  while ((m = embedRe.exec(lit))) {
    const t = m[1]!
    for (const c of MISSING_COLUMNS[t] ?? []) if (hasWord(m[2]!, c)) out.add(`${t}.${c}`)
    top = top.replace(m[0], ' ')
  }
  for (const c of MISSING_COLUMNS[table] ?? []) if (hasWord(top, c)) out.add(`${table}.${c}`)
  return [...out]
}

/** 書き込みの引数（インラインのオブジェクト、または直前で組み立てた変数）に入っている欠落列 */
function missingInWrite(src: string, chainStart: number, chain: string, table: string): string[] {
  const cols = MISSING_COLUMNS[table] ?? []
  const m = /\.(insert|update|upsert)\(\s*/.exec(chain)
  if (!m || cols.length === 0) return []
  const argStart = chainStart + m.index + m[0].length
  const arg = balancedFrom(src, argStart)
  const ident = /^([A-Za-z_$][\w$]*)\s*(?:as\b[^,)]*)?$/.exec(arg.trim())?.[1]
  let text: string
  if (ident) {
    const before = src.slice(Math.max(0, chainStart - WINDOW_BEFORE), chainStart)
    const defRe = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\b[^=]*=`, 'g')
    let def: RegExpExecArray | null
    let last: RegExpExecArray | null = null
    while ((def = defRe.exec(before))) last = def
    if (last) {
      const defStart = Math.max(0, chainStart - WINDOW_BEFORE) + last.index + last[0].length
      const assigns = before
        .slice(last.index)
        .split('\n')
        .filter((l) => new RegExp(`\\b${ident}(?:\\.|\\[)`).test(l))
        .join('\n')
      text = balancedFrom(src, defStart) + '\n' + assigns
    } else {
      // 引数（関数の引数など）。定義が見つからないときは直前の範囲を広く見る（見逃しより誤検知を選ぶ）
      text = before
    }
  } else {
    text = arg
  }
  return cols.filter((c) => hasPayloadKey(text, c)).map((c) => `${table}.${c}`)
}

export type Finding = { table: string; columns: string[]; kind: 'select' | 'write'; offset: number; hasFallback: boolean }

/** 1ファイル分の走査（自己確認テストでも使う） */
export function scanSource(src: string): Finding[] {
  const findings: Finding[] = []
  const fromRe = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g
  const fromPositions: { table: string; index: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = fromRe.exec(src))) fromPositions.push({ table: m[1]!, index: m.index, end: m.index + m[0].length })

  const chainOf = (i: number) => {
    const fp = fromPositions[i]!
    const nextFrom = fromPositions[i + 1]?.index ?? src.length
    return src.slice(fp.end, Math.min(nextFrom, fp.end + 800))
  }

  fromPositions.forEach((fp, i) => {
    const chain = chainOf(i)
    const selCols = new Set<string>()
    for (const lit of selectLiterals(chain)) for (const c of missingInSelect(fp.table, lit)) selCols.add(c)
    const writeCols = new Set(missingInWrite(src, fp.end, chain, fp.table))
    if (selCols.size === 0 && writeCols.size === 0) return

    const near = src.slice(Math.max(0, fp.index - WINDOW_BEFORE), Math.min(src.length, fp.end + WINDOW_AFTER))
    const usesFallbackFn = FALLBACK_FN_RE.test(near)

    // 後ろ（同じ関数の範囲）で同じ表を「欠落列なし」で取り直す／書き直すか
    let reselect = false
    let rewrite = false
    for (let j = i + 1; j < fromPositions.length; j++) {
      const later = fromPositions[j]!
      if (later.index > fp.end + WINDOW_AFTER) break
      if (later.table !== fp.table) continue
      const laterChain = chainOf(j)
      const lits = selectLiterals(laterChain)
      const isWrite = /\.(insert|update|upsert)\(/.test(laterChain)
      if (!isWrite && lits.length > 0 && lits.every((l) => missingInSelect(later.table, l).length === 0)) reselect = true
      if (isWrite && missingInWrite(src, later.end, laterChain, later.table).length === 0) rewrite = true
    }

    if (selCols.size > 0 && !/\.(insert|update|upsert)\(/.test(chain)) {
      findings.push({ table: fp.table, columns: [...selCols], kind: 'select', offset: fp.index, hasFallback: usesFallbackFn || reselect })
    }
    if (writeCols.size > 0 || (selCols.size > 0 && /\.(insert|update|upsert)\(/.test(chain))) {
      findings.push({
        table: fp.table,
        columns: [...new Set([...writeCols, ...selCols])],
        kind: 'write',
        offset: fp.index,
        hasFallback: usesFallbackFn || rewrite,
      })
    }
  })
  return findings
}

describe('本番に無い列のフォールバック漏れ（静的走査）', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'lib'))]
  const all = files.flatMap((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/')
    return scanSource(fs.readFileSync(f, 'utf8')).map((x) => ({ ...x, file: rel }))
  })

  it('該当ファイルを洗い出せている（走査が空振りしていない）', () => {
    expect(all.length).toBeGreaterThan(0)
  })

  it('フォールバックの無い読み書きは許可リスト（理由つき）に載っているものだけ', () => {
    const violations = all
      .filter((x) => !x.hasFallback && !ALLOWLIST[`${x.file}::${x.table}`])
      .map((x) => `${x.file} (${x.table}.${x.columns.join('/')} ${x.kind})`)
    expect(violations).toEqual([])
  })

  it('許可リストに使われていない項目が残っていない', () => {
    const used = new Set(all.filter((x) => !x.hasFallback).map((x) => `${x.file}::${x.table}`))
    expect(Object.keys(ALLOWLIST).filter((k) => !used.has(k))).toEqual([])
    for (const reason of Object.values(ALLOWLIST)) expect(reason.trim().length).toBeGreaterThan(10)
  })
})

describe('静的走査の自己確認（検知が効くこと）', () => {
  it('フォールバックの無い select を検知する', () => {
    const src = `
      const r = await admin.from('delivery_destinations').select('id, full_name, default_container_type').eq('is_active', true)
      if (r.error) return <ErrorState message="x" />
    `
    const f = scanSource(src)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ table: 'delivery_destinations', kind: 'select', hasFallback: false })
  })

  it('isMissingColumnError で基本列に取り直す select はフォールバックありとする', () => {
    const src = `
      const r1 = await admin.from('delivery_destinations').select('id, departure_time')
      if (r1.error && isMissingColumnError(r1.error)) { /* ... */ }
    `
    expect(scanSource(src).every((x) => x.hasFallback)).toBe(true)
  })

  it('同じ表を基本列で取り直す select はフォールバックありとする', () => {
    const src = `
      const r1 = await admin.from('order_items').select('id, has_seal, bag_type').in('order_id', ids)
      if (r1.error) {
        const r2 = await admin.from('order_items').select('id, quantity').in('order_id', ids)
      }
    `
    expect(scanSource(src)).toEqual([expect.objectContaining({ kind: 'select', hasFallback: true })])
  })

  it('フォールバックの無い書き込み（変数で組み立てたペイロード）を検知する', () => {
    const src = `
      const payload = { quantity: 1, has_seal: true }
      await admin.from('order_items').update(payload).eq('id', id)
    `
    expect(scanSource(src)).toEqual([expect.objectContaining({ kind: 'write', columns: ['order_items.has_seal'], hasFallback: false })])
  })

  it('writeDroppingMissingColumns を通す書き込みはフォールバックありとする', () => {
    const src = `
      const payload = { quantity: 1, bag_type: 'FG' }
      await writeDroppingMissingColumns(payload, (p) => admin.from('order_items').update(p).eq('id', id))
    `
    expect(scanSource(src).every((x) => x.hasFallback)).toBe(true)
  })

  it('インラインのペイロードで欠落列を送り、戻り値も見ない書き込み（修正前の orders/revise）を検知する', () => {
    const src = `
      await admin
        .from('order_items')
        .update({
          quantity: newQty,
          has_seal: typeof newItem.has_seal === 'boolean' ? newItem.has_seal : undefined,
          bag_type: newItem.bag_type ?? undefined,
        })
        .eq('id', dbItem.id)
    `
    expect(scanSource(src)).toEqual([
      expect.objectContaining({ kind: 'write', columns: ['order_items.bag_type', 'order_items.has_seal'], hasFallback: false }),
    ])
  })

  it('埋め込み select（orders → delivery_destinations(...)）の欠落列も検知する', () => {
    const src = `
      const r = await supabase.from('orders').select('id, delivery_destinations (full_name, departure_time)').eq('id', id)
    `
    expect(scanSource(src)).toEqual([
      expect.objectContaining({ table: 'orders', columns: ['delivery_destinations.departure_time'], hasFallback: false }),
    ])
  })

  it('基本列のペイロードで書き直す（v5 → base の再試行）はフォールバックありとする', () => {
    const src = `
      const baseRow = { order_id: id, quantity: 1 }
      const v5Row = { ...baseRow, has_seal: true }
      let { error } = await admin.from('order_items').insert(v5Row)
      if (error) {
        const retry = await admin.from('order_items').insert(baseRow)
        error = retry.error
      }
    `
    const f = scanSource(src)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'write', hasFallback: true })
  })

  it('本番にある列（pack_configs.has_seal・customer_product_rules.has_card）は対象外', () => {
    const src = `
      await admin.from('pack_configs').select('id, has_seal, has_card')
      await admin.from('customer_product_rules').select('id, has_card, container_type')
    `
    expect(scanSource(src)).toEqual([])
  })
})
