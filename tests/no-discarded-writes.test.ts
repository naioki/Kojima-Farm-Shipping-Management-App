/**
 * supabase の書き込みを await して、結果（{ error }）を受け取らずに捨てる文を検知する
 * （engineering.md §5・CLAUDE.md NEVER swallow errors）。
 *
 * supabase-js は失敗しても例外を投げないため、try で囲んでいなくても
 *   await admin.from('x').update(...).eq('id', id)
 * と書くと、失敗は誰にも気づかれない。結果は次のどれかで扱う:
 *   - 本体の書き込み: `const { error } = await ...` で受けて、失敗なら 500
 *   - 付随の更新:     lib/api/side-effects.ts の runSideEffect(warnings, ..., () => ...) に渡して警告で返す
 *   - 巻き戻し:       error を受けて console.error、応答に「一部が残っている可能性」を含める
 *   - 記録だけ:       error を受けて console.error（現場が対処できないもの）
 * 走査の実装は tests/support/discarded-writes.ts。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { findDiscardedWrites } from './support/discarded-writes'

const ROOT = process.cwd()
const SCAN_DIRS = ['app/api', 'lib']

interface AllowEntry {
  /** ルートからの相対パス（区切りは /） */
  file: string
  /** 許可する件数（増えたら検知する） */
  count: number
  /** 結果を捨ててよい理由（必須） */
  reason: string
}

/**
 * 結果を捨ててよいもの（1件ずつ理由つき）。現時点で該当なし。
 * 追加するときは「best-effort の利用記録で、関数内で別途ログしている」など、捨ててよい理由を書く。
 */
const ALLOWLIST: AllowEntry[] = []

function walk(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (e) {
    throw new Error(`走査対象のディレクトリを読めません: ${dir} (${String(e)})`)
  }
  return names.flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    if (!/\.(ts|tsx)$/.test(name)) return []
    if (/\.test\.(ts|tsx)$/.test(name)) return []
    return [p]
  })
}

function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const d of SCAN_DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const r = relative(ROOT, file).split(sep).join('/')
      const hits = findDiscardedWrites(readFileSync(file, 'utf8'))
      if (hits.length > 0) found.set(r, hits.map((h) => `${r}:${h.line}  ${h.text}`))
    }
  }
  return found
}

const hit = (src: string) => findDiscardedWrites(src).length > 0

describe('supabase の書き込みの結果を捨てない', () => {
  it('結果を捨てている形は検知する（自己確認）', () => {
    const bad = [
      "await admin.from('orders').update({ status: 'x' }).eq('id', id)",
      "async function f() {\n  await admin\n    .from('harvest_tasks')\n    .delete()\n    .in('order_item_id', ids)\n}",
      "const a = 1\nawait supabase.from('order_receipts').insert({ a: 1 })",
      "if (ids.length) await admin.from('harvest_tasks').delete().in('id', ids)",
      "if (x) {\n  await admin.from('ai_rules').upsert(row)\n} else await db.from('t').delete().eq('id', 1)",
      "try {\n  await createAdminClient().from('x').update(p).eq('id', 1)\n} catch (e) {\n  console.warn(e)\n}",
      "await admin.rpc('do_something', { a: 1 })",
      "await Promise.allSettled([\n  admin.from('a').delete().eq('id', 1),\n  admin.from('b').delete().eq('id', 1),\n])",
      "await writeDroppingMissingColumns(p, (q) => admin.from('x').update(q).eq('id', 1))",
      "// コメント\nawait admin.from('x').delete().eq('id', 1)",
      "void admin.from('ai_rules').update({ a: 1 }).eq('id', r.id)",
      "if (x) {\n  void admin\n    .from('ai_rules')\n    .update({ a: 1 })\n    .eq('id', 1)\n  return 1\n}",
      "admin.from('x').update({ a: 1 }).eq('id', 1)",
      "const a = 1\nadmin\n  .from('x')\n  .insert({ a })\nfoo()",
      "createAdminClient().from('x').delete().eq('id', 1)",
      "void admin.rpc('do_something', { a: 1 })",
    ]
    for (const s of bad) expect(hit(s), s).toBe(true)
  })

  it('結果を受けている形は通す（自己確認）', () => {
    const ok = [
      "const { error } = await admin.from('orders').update({ status: 'x' }).eq('id', id)",
      "const { error: delErr } = await admin\n  .from('harvest_tasks')\n  .delete()\n  .in('order_item_id', ids)",
      "const res =\n  await admin.from('x').insert(row)",
      "let { data, error } = await admin.from('x').insert(row).select().single()",
      "return await admin.from('x').delete().eq('id', 1)",
      "await runSideEffect(warnings, '[x] 失敗', '警告', () => admin.from('harvest_tasks').update(p).eq('id', 1))",
      "await runSideEffect(null, '[x]', undefined, () =>\n  admin.from('x').delete().in('id', ids),\n)",
      "const results = await Promise.allSettled([admin.from('a').delete().eq('id', 1)])",
      "await admin.from('x').update(p).eq('id', 1).then(({ error }) => { if (error) console.error(error) })",
      "const { data } = await admin.from('orders').select('id').eq('id', 1)",
      "await admin.from('orders').select('id')",
      "await writeAuditAfterSuccess(admin, entry, '[x]')",
      "const r = await writeDroppingMissingColumns(p, (q) => admin.from('x').update(q))",
      "const x = cond ? await admin.from('a').delete() : null",
      "foo(await admin.from('a').insert(r))",
      "void runSideEffect(null, '[x]', undefined, () => admin.from('x').update(p).eq('id', 1))",
      "admin.from('x').update(p).eq('id', 1).then(({ error }) => { if (error) console.error(error) })",
      "void admin.from('x').update(p).eq('id', 1).then(({ error }) => { if (error) console.error(error) })",
      "const q = admin.from('x').update(p).eq('id', 1)",
      "const { data } = await admin.from('x').select('id')\nadmin.from('x').select('id')",
    ]
    for (const s of ok) expect(hit(s), s).toBe(false)
  })

  it('app/api と lib に、結果を捨てている書き込みが無い（理由つき許可リストを除く）', () => {
    const found = scan()
    const allowed = new Map(ALLOWLIST.map((a) => [a.file, a]))
    const unexpected: string[] = []
    for (const [file, hits] of found) {
      const a = allowed.get(file)
      if (!a || hits.length > a.count) unexpected.push(...hits)
    }
    expect(
      unexpected,
      `supabase の書き込みの結果を捨てています。const { error } = await ... で受けるか、付随更新なら lib/api/side-effects.ts の runSideEffect に渡してください:\n${unexpected.join('\n')}`,
    ).toEqual([])
  })

  it('許可リストに古い項目が残っていない・理由が書いてある', () => {
    const found = scan()
    for (const a of ALLOWLIST) {
      expect(a.reason.trim().length, a.file).toBeGreaterThan(10)
      expect(found.get(a.file)?.length ?? 0, `${a.file} の件数が許可リストと違う（直したら減らす）`).toBe(a.count)
    }
  })
})
