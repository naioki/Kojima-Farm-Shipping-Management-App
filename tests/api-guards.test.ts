/**
 * 社内APIの権限を fail closed に揃えたことを固定する（security.md）。
 *
 * 1) 静的走査: app/api 配下の全 route.ts / route.tsx の各ハンドラ（GET/POST/PUT/PATCH/DELETE）が
 *    requireStaffApi / requireAdminApi を呼ぶこと。呼ばないのは下の許可リスト（理由つき・1件ずつ）だけ。
 *    あわせて「ロール不明を staff 扱い」（?? 'staff' / || 'staff'）と手書きのロール判定を検知する。
 * 2) 実行テスト: 取引先ポータルの利用者（auth.users にだけ居て public.users に行が無い）や
 *    ロール取得失敗が、積込写真・印刷キュー・並び順更新で 403 になること。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'

// ---------------------------------------------------------------------------
// 1) 静的走査
// ---------------------------------------------------------------------------

const API_ROOT = join(process.cwd(), 'app', 'api')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const GUARD_RE = /\brequire(Staff|Admin)Api\s*\(/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return name === 'route.ts' || name === 'route.tsx' ? [p] : []
  })
}

/** app/api からの相対パス（区切りは / に統一）。例: 'cron/poll-drive/route.ts' */
function rel(p: string): string {
  return relative(API_ROOT, p).split(sep).join('/')
}

interface AllowEntry {
  /** 'cron/poll-drive/route.ts#GET' の形。ハンドラ単位で許可する */
  key: string
  /** ガードを呼ばない理由（必須） */
  reason: string
  /** そのハンドラ（または同じファイル）が代わりに持つべき認証の目印。消えたら検知する */
  mustContain?: RegExp
}

/**
 * ガード（requireStaffApi / requireAdminApi）を呼ばなくてよいハンドラの許可リスト。
 * 「社内ユーザーではない正規の呼び出し元」だけを載せる。増やすときは理由を書くこと。
 */
const ALLOWLIST: AllowEntry[] = [
  // --- 死活監視（認証なし・DBの中身を返さない） ---
  { key: 'health/route.ts#GET', reason: 'Cloud Run / 外形監視の死活確認。秘密情報を返さない' },
  { key: 'healthz/route.ts#GET', reason: 'Kojima-FAX の疎通確認（/api/healthz 互換）。固定文言のみ返す', mustContain: /receiptsGET\(\)/ },
  { key: 'receipts/healthz/route.ts#GET', reason: 'Kojima-FAX の疎通確認（/api/receipts/healthz 互換）。固定文言のみ返す', mustContain: /receiptsGET\(\)/ },
  { key: 'receipts/route.ts#GET', reason: 'Kojima-FAX check_health() の疎通確認。固定文言のみ返す' },

  // --- FAX 取り込みの互換エイリアス（認証は /api/receipts の POST が行う：トークン or 社内ユーザー） ---
  { key: 'route.ts#GET', reason: 'FAX 取り込み互換エイリアス（/api）。疎通確認を /api/receipts に委譲', mustContain: /receiptsGET\(\)/ },
  { key: 'route.ts#POST', reason: 'FAX 取り込み互換エイリアス（/api）。認証は /api/receipts POST に委譲', mustContain: /receiptsPOST\(req\)/ },
  { key: 'orders/ingest/route.ts#GET', reason: 'FAX 取り込み互換エイリアス。疎通確認を /api/receipts に委譲', mustContain: /receiptsGET\(\)/ },
  { key: 'orders/ingest/route.ts#POST', reason: 'FAX 取り込み互換エイリアス。認証は /api/receipts POST に委譲', mustContain: /receiptsPOST\(req\)/ },
  { key: 'receipts/orders/ingest/route.ts#GET', reason: 'FAX 取り込み互換エイリアス。疎通確認を /api/receipts に委譲', mustContain: /receiptsGET\(\)/ },
  { key: 'receipts/orders/ingest/route.ts#POST', reason: 'FAX 取り込み互換エイリアス。認証は /api/receipts POST に委譲', mustContain: /receiptsPOST\(req\)/ },

  // --- Cloud Scheduler（x-cron-secret を verifyCronRequest で検証） ---
  { key: 'cron/cleanup-receipts/route.ts#GET', reason: 'Cloud Scheduler 専用（verifyCronRequest）', mustContain: /verifyCronRequest\(/ },
  { key: 'cron/overdue-shipments/route.ts#GET', reason: 'Cloud Scheduler 専用（verifyCronRequest）', mustContain: /verifyCronRequest\(/ },
  { key: 'cron/poll-drive/route.ts#GET', reason: 'Cloud Scheduler 専用（verifyCronRequest）', mustContain: /verifyCronRequest\(/ },
  { key: 'cron/poll-email/route.ts#GET', reason: 'Cloud Scheduler 専用（verifyCronRequest）', mustContain: /verifyCronRequest\(/ },

  // --- 取引先ポータル（Magic Link。public.users に行が無いのが正常。app_metadata.customer_id で自社に限定） ---
  {
    key: 'portal/orders/route.ts#POST',
    reason: '取引先ポータルからの発注。社内ガードを掛けると正規の取引先が締め出される。customer_id で自社に限定',
    mustContain: /app_metadata[\s\S]*customer_id/,
  },
]

/** ファイルから exported なハンドラ本体を切り出す（次の export か末尾まで） */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g
  const starts: Array<{ method: string; index: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) starts.push({ method: m[1] ?? '', index: m.index })
  return starts.map((s, i) => {
    const nextExport = src.indexOf('\nexport ', s.index + 1)
    const next = starts[i + 1]
    const end = next ? next.index : nextExport === -1 ? src.length : nextExport
    return { method: s.method, body: src.slice(s.index, Math.max(end, s.index + 1)) }
  })
}

/** ハンドラ内でガードを直接呼ぶか、ガードを呼ぶ同ファイル内の関数（verifyAdmin 等）を呼ぶか */
function callsGuard(src: string, body: string): boolean {
  if (GUARD_RE.test(body)) return true
  const helperRe = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)[^{]*\{/g
  let m: RegExpExecArray | null
  while ((m = helperRe.exec(src))) {
    const name = m[1] ?? ''
    if ((METHODS as readonly string[]).includes(name)) continue
    const start = m.index
    const end = src.indexOf('\n}\n', start)
    const helperBody = src.slice(start, end === -1 ? src.length : end)
    if (GUARD_RE.test(helperBody) && new RegExp(`\\b${name}\\s*\\(`).test(body)) return true
  }
  return false
}

const files = walk(API_ROOT)

describe('社内APIの権限ガード（静的走査）', () => {
  it('app/api のルートを取りこぼさず走査している', () => {
    expect(files.length).toBeGreaterThan(60)
    expect(files.some((f) => f.endsWith('.tsx'))).toBe(true)
  })

  it('全ハンドラがガードを呼ぶ。呼ばないのは許可リストのものだけ', () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.key))
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const hs = handlers(src)
      expect(hs.length, `${rel(f)} にハンドラが見つからない`).toBeGreaterThan(0)
      for (const h of hs) {
        const key = `${rel(f)}#${h.method}`
        if (allowed.has(key)) continue
        if (!callsGuard(src, h.body)) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })

  it('許可リストの各項目は実在し、理由と代わりの認証の目印を持つ', () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.length, a.key).toBeGreaterThan(5)
      const [path = '', method] = a.key.split('#')
      const file = join(API_ROOT, ...path.split('/'))
      const src = readFileSync(file, 'utf8')
      const h = handlers(src).find((x) => x.method === method)
      expect(h, `${a.key} が存在しない（消したなら許可リストからも消す）`).toBeDefined()
      if (a.mustContain) expect(a.mustContain.test(h!.body) || a.mustContain.test(src), a.key).toBe(true)
    }
  })

  it("ロール不明を staff 扱いにする ?? 'staff' / || 'staff' が app/api に無い", () => {
    const bad = files.filter((f) => /(\?\?|\|\|)\s*['"]staff['"]/.test(readFileSync(f, 'utf8'))).map(rel)
    expect(bad).toEqual([])
  })

  it('手書きのロール判定（users.role の直接参照・isStaffUser・JWT の role）が app/api に無い', () => {
    const bad = files
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return (
          /\.select\(\s*['"]role['"]\s*\)/.test(src) ||
          /\bisStaffUser\s*\(/.test(src) ||
          /app_metadata[^\n]*\brole\b/.test(src)
        )
      })
      .map(rel)
    expect(bad).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2) 実行テスト（fake-supabase）
// ---------------------------------------------------------------------------

type Role = 'admin' | 'staff' | null
let currentUser: { id: string; app_metadata?: Record<string, unknown> } | null = null
/** users 行の取得結果。null = 行なし（取引先ポータル）、'error' = 取得失敗 */
let usersRow: Role | 'error' = null
let extra: (call: FakeCall) => FakeResult | undefined = () => undefined

function resolve(call: FakeCall): FakeResult | undefined {
  if (call.table === 'users') {
    if (usersRow === 'error') return { data: null, error: { message: 'boom' } }
    return { data: usersRow ? { role: usersRow } : null }
  }
  return extra(call)
}
let fake = createFakeSupabase(resolve)

const storageCalls: string[] = []
function adminClient() {
  return {
    ...fake.client,
    storage: {
      from: () => ({
        upload: async () => {
          storageCalls.push('upload')
          return { error: null }
        },
        createSignedUrl: async () => {
          storageCalls.push('sign')
          return { data: { signedUrl: 'https://example.invalid/signed' }, error: null }
        },
      }),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => currentUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient() }))
vi.mock('@/lib/field/features', () => ({
  getStaffFeatures: async () => ({ printDocs: false }),
  canStaffUse: (_f: string, role: string, features: Record<string, boolean>) => role === 'admin' || !!features[_f],
}))
vi.mock('@/lib/shipping-docs/queue', () => ({ enqueuePrintJob: async () => ({ ok: true, id: 'job-1' }) }))

const PORTAL_USER = { id: 'portal-1', app_metadata: { customer_id: '33333333-3333-4333-8333-333333333333' } }
const DELIVERY_ID = '44444444-4444-4444-8444-444444444444'
const CUST = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  fake = createFakeSupabase(resolve)
  extra = () => undefined
  storageCalls.length = 0
  currentUser = PORTAL_USER
  usersRow = null
})

function photoForm(): FormData {
  const form = new FormData()
  form.set('delivery_date', '2026-11-11')
  form.set('customer_id', CUST)
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }))
  return form
}

function writes(): FakeCall[] {
  return fake.calls.filter((c) => c.op !== 'select')
}

describe('lib/auth/api-guard', () => {
  it('未ログインは 401', async () => {
    currentUser = null
    const { requireStaffApi } = await import('@/lib/auth/api-guard')
    const g = await requireStaffApi()
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(401)
  })

  it('users に行が無い（取引先ポータル）・ロール取得失敗は 403', async () => {
    const { requireStaffApi } = await import('@/lib/auth/api-guard')
    usersRow = null
    let g = await requireStaffApi()
    expect(!g.ok && g.response.status).toBe(403)
    usersRow = 'error'
    g = await requireStaffApi()
    expect(!g.ok && g.response.status).toBe(403)
  })

  it('requireAdminApi は staff を 403、admin を通す。403 の文言を指定できる', async () => {
    const { requireAdminApi } = await import('@/lib/auth/api-guard')
    currentUser = { id: 'u-1' }
    usersRow = 'staff'
    const g = await requireAdminApi('管理者のみ操作できます')
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.response.status).toBe(403)
      expect(await g.response.json()).toEqual({ error: '管理者のみ操作できます' })
    }
    usersRow = 'admin'
    const g2 = await requireAdminApi()
    expect(g2.ok && g2.role).toBe('admin')
  })
})

describe('/api/deliveries/photo（積込写真）', () => {
  it('GET: users に行の無いログイン利用者は 403 で、署名URLを発行しない', async () => {
    const { GET } = await import('@/app/api/deliveries/photo/route')
    const res = await GET(new Request(`http://x/api/deliveries/photo?id=${DELIVERY_ID}`))
    expect(res.status).toBe(403)
    expect(storageCalls).toEqual([])
    expect(fake.calls.filter((c) => c.table === 'deliveries')).toEqual([])
  })

  it('POST: users に行の無いログイン利用者は 403 で、配送行の作成もアップロードもしない', async () => {
    const { POST } = await import('@/app/api/deliveries/photo/route')
    const res = await POST(new Request('http://x/api/deliveries/photo', { method: 'POST', body: photoForm() }))
    expect(res.status).toBe(403)
    expect(storageCalls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('GET/POST: ロール取得に失敗したら 403', async () => {
    usersRow = 'error'
    currentUser = { id: 'u-1' }
    const { GET, POST } = await import('@/app/api/deliveries/photo/route')
    expect((await GET(new Request(`http://x/api/deliveries/photo?id=${DELIVERY_ID}`))).status).toBe(403)
    expect((await POST(new Request('http://x/api/deliveries/photo', { method: 'POST', body: photoForm() }))).status).toBe(403)
    expect(storageCalls).toEqual([])
  })

  it('GET: 社内スタッフは署名URLへリダイレクトされる', async () => {
    currentUser = { id: 'u-1' }
    usersRow = 'staff'
    extra = (c) => (c.table === 'deliveries' ? { data: { photo_url: '2026-11-11/x.jpg' } } : undefined)
    const { GET } = await import('@/app/api/deliveries/photo/route')
    const res = await GET(new Request(`http://x/api/deliveries/photo?id=${DELIVERY_ID}`))
    expect(res.status).toBe(307)
    expect(storageCalls).toEqual(['sign'])
  })
})

describe('/api/print-jobs と /api/order-items/reorder（旧: ロール不明を staff 扱い）', () => {
  const printBody = () => JSON.stringify({ date: '2026-11-11', docType: 'sheet' })
  const reorderBody = () => JSON.stringify({ items: [{ id: 'i-1', sortOrder: 1 }] })

  it('print-jobs: users に行なし・ロール取得失敗は 403', async () => {
    const { POST } = await import('@/app/api/print-jobs/route')
    for (const row of [null, 'error'] as const) {
      usersRow = row
      const res = await POST(new Request('http://x/api/print-jobs', { method: 'POST', body: printBody() }))
      expect(res.status, String(row)).toBe(403)
    }
  })

  it('print-jobs: 解放されていない staff は従来どおり 403、admin は通る（後段の canStaffUse は維持）', async () => {
    const { POST } = await import('@/app/api/print-jobs/route')
    currentUser = { id: 'u-1' }
    usersRow = 'staff'
    const staffRes = await POST(new Request('http://x/api/print-jobs', { method: 'POST', body: printBody() }))
    expect(staffRes.status).toBe(403)
    expect(await staffRes.json()).toEqual({ error: '帳票印刷は解放されていません' })
    usersRow = 'admin'
    const adminRes = await POST(new Request('http://x/api/print-jobs', { method: 'POST', body: printBody() }))
    expect(adminRes.status).not.toBe(403)
  })

  it('reorder: users に行なし・ロール取得失敗は 403 で、order_items を更新しない', async () => {
    const { POST } = await import('@/app/api/order-items/reorder/route')
    for (const row of [null, 'error'] as const) {
      usersRow = row
      const res = await POST(
        new Request('http://x/api/order-items/reorder', { method: 'POST', body: reorderBody() }) as never,
      )
      expect(res.status, String(row)).toBe(403)
    }
    expect(writes()).toEqual([])
  })

  it('reorder: JWT に role が付いていても users に行が無ければ 403（JWT を信用しない）', async () => {
    currentUser = { id: 'u-x', app_metadata: { role: 'staff' } }
    usersRow = null
    const { POST } = await import('@/app/api/order-items/reorder/route')
    const res = await POST(new Request('http://x/api/order-items/reorder', { method: 'POST', body: reorderBody() }) as never)
    expect(res.status).toBe(403)
  })

  it('reorder: 社内スタッフは更新できる', async () => {
    currentUser = { id: 'u-1' }
    usersRow = 'staff'
    const { POST } = await import('@/app/api/order-items/reorder/route')
    const res = await POST(new Request('http://x/api/order-items/reorder', { method: 'POST', body: reorderBody() }) as never)
    expect(res.status).toBe(200)
    expect(writes().some((c) => c.table === 'order_items' && c.op === 'update')).toBe(true)
  })
})
