/**
 * テスト用の最小 Supabase クライアント（DB 不要で業務フローを通しで確かめるため）。
 * 呼び出し（テーブル・操作・絞り込み・送信内容）を記録し、結果は resolver が返す。
 * 結合（orders!inner 等）は解釈しない。resolver が「結合済みの行」を返せばよい。
 */
export type FakeOp = 'select' | 'insert' | 'update' | 'delete' | 'upsert'
export interface FakeCall {
  table: string
  op: FakeOp
  payload?: unknown
  columns?: string
  filters: { method: string; args: unknown[] }[]
  terminal: 'single' | 'maybeSingle' | null
}
export interface FakeResult {
  data?: unknown
  error?: { message: string; code?: string } | null
  count?: number | null
}
export type FakeResolver = (call: FakeCall) => FakeResult | undefined
export type FakeRpcResolver = (fn: string, args: Record<string, unknown>) => FakeResult | undefined

const FILTERS = [
  'eq', 'neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt', 'or', 'not', 'order', 'limit', 'range',
  'contains', 'ilike', 'like', 'match', 'filter',
] as const

export function createFakeSupabase(resolver: FakeResolver, rpcResolver: FakeRpcResolver = () => undefined) {
  const calls: FakeCall[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

  function builder(table: string) {
    const call: FakeCall = { table, op: 'select', filters: [], terminal: null }
    let opSet = false
    const run = (): Promise<FakeResult> => {
      calls.push(call)
      const r = resolver(call) ?? {}
      let data = r.data ?? (call.op === 'select' ? [] : null)
      if (call.terminal && Array.isArray(data)) data = data[0] ?? null
      if (call.terminal === 'single' && data == null && !r.error) {
        return Promise.resolve({ data: null, error: { message: 'no rows' }, count: null })
      }
      return Promise.resolve({ data, error: r.error ?? null, count: r.count ?? null })
    }
    const b: Record<string, unknown> = {
      select(columns?: string) {
        if (!opSet) call.op = 'select'
        call.columns = columns
        return b
      },
      insert(payload: unknown) {
        call.op = 'insert'; call.payload = payload; opSet = true
        return b
      },
      update(payload: unknown) {
        call.op = 'update'; call.payload = payload; opSet = true
        return b
      },
      upsert(payload: unknown) {
        call.op = 'upsert'; call.payload = payload; opSet = true
        return b
      },
      delete() {
        call.op = 'delete'; opSet = true
        return b
      },
      single() { call.terminal = 'single'; return run() },
      maybeSingle() { call.terminal = 'maybeSingle'; return run() },
      then(onF: (v: FakeResult) => unknown, onR?: (e: unknown) => unknown) { return run().then(onF, onR) },
    }
    for (const m of FILTERS) {
      b[m] = (...args: unknown[]) => { call.filters.push({ method: m, args }); return b }
    }
    return b
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      const r = rpcResolver(fn, args) ?? {}
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
  }
  return { client, calls, rpcCalls }
}

/** 記録した呼び出しのうち、絞り込み method/列 が一致する最初の値（例: eq の id） */
export function filterValue(call: FakeCall, method: string, column: string): unknown {
  return call.filters.find((f) => f.method === method && f.args[0] === column)?.args[1]
}
