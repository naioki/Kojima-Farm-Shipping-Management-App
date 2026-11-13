import { filterValue, type FakeCall, type FakeResult } from './fake-supabase'

export type HarvestRow = {
  id: string
  product_id: string
  order_item_id: string | null
  required_qty: number
  task_date: string
  status: string
  assigned_to: string | null
}

/**
 * harvest_tasks を記憶する小さな表（select … in / insert / update … eq を解釈）。
 * unique=true なら order_item_id の一意制約（migrations/0034）がある環境を真似て、重複 insert を 23505 で弾く。
 */
export function harvestTable(initial: HarvestRow[] = [], opts: { unique?: boolean; selectError?: string } = {}) {
  const rows: HarvestRow[] = initial.map((r) => ({ ...r }))
  let seq = 0
  const resolve = (c: FakeCall): FakeResult | undefined => {
    if (c.table !== 'harvest_tasks') return undefined
    if (c.op === 'select') {
      if (opts.selectError) return { error: { message: opts.selectError } }
      const ids = (filterValue(c, 'in', 'order_item_id') as string[] | undefined) ?? []
      return { data: rows.filter((r) => r.order_item_id && ids.includes(r.order_item_id)).map((r) => ({ ...r })) }
    }
    if (c.op === 'insert') {
      const list = (Array.isArray(c.payload) ? c.payload : [c.payload]) as Partial<HarvestRow>[]
      if (opts.unique) {
        const taken = new Set(rows.map((r) => r.order_item_id))
        const dup = list.some((p, i) => taken.has(p.order_item_id ?? null) || list.findIndex((q) => q.order_item_id === p.order_item_id) !== i)
        if (dup) return { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      }
      for (const p of list) {
        rows.push({ id: `t-new-${++seq}`, status: 'not_started', assigned_to: null, required_qty: 0, product_id: '', order_item_id: null, task_date: '', ...p } as HarvestRow)
      }
      return { data: null }
    }
    if (c.op === 'update') {
      const itemId = filterValue(c, 'eq', 'order_item_id')
      for (const r of rows) if (r.order_item_id === itemId) Object.assign(r, c.payload as Partial<HarvestRow>)
      return { data: null }
    }
    return undefined
  }
  return { rows, resolve }
}

