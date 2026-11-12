import { describe, it, expect } from 'vitest'
import { missingColumnName, writeDroppingMissingColumns, isMissingColumnError } from '@/lib/supabase/missing-column'

describe('isMissingColumnError', () => {
  it('delivery_destinations の PGRST204（departure_time）を未適用列として判定する', () => {
    expect(
      isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'departure_time' column of 'delivery_destinations' in the schema cache" }),
    ).toBe(true)
  })
  it('42703 も判定し、無関係なエラーは false', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column x does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})

describe('missingColumnName', () => {
  it('PGRST204 から列名を取り出す', () => {
    expect(
      missingColumnName({ code: 'PGRST204', message: "Could not find the 'is_manual_modified' column of 'order_items' in the schema cache" }),
    ).toBe('is_manual_modified')
  })
  it('42703 から列名を取り出す', () => {
    expect(missingColumnName({ code: '42703', message: 'column order_items.is_new_addition does not exist' })).toBe('is_new_addition')
  })
  it('他のエラーは null', () => {
    expect(missingColumnName({ code: '23502', message: 'null value' })).toBeNull()
  })
})

describe('writeDroppingMissingColumns', () => {
  it('欠落列だけを外して再試行し、他の列は保持する', async () => {
    const calls: Record<string, unknown>[] = []
    const res = await writeDroppingMissingColumns({ quantity: 300, is_manual_modified: true }, async (p) => {
      calls.push(p)
      if ('is_manual_modified' in p)
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'is_manual_modified' column of 'order_items' in the schema cache" } }
      return { data: { id: '1', ...p }, error: null }
    })
    expect(res.error).toBeNull()
    expect(res.droppedColumns).toEqual(['is_manual_modified'])
    expect(calls[1]).toEqual({ quantity: 300 })
  })
  it('列を外した結果 update が空になったら、書き込みを投げずに成功（skipped）で返す', async () => {
    const calls: Record<string, unknown>[] = []
    const res = await writeDroppingMissingColumns({ has_seal: false, seal_text: 'x' }, async (p) => {
      calls.push(p)
      const col = Object.keys(p)[0]
      return { data: null, error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'customer_product_rules' in the schema cache` } }
    })
    expect(res.error).toBeNull()
    expect(res.skipped).toBe(true)
    expect(res.droppedColumns).toEqual(['has_seal', 'seal_text'])
    // 空 {} の update は投げていない
    expect(calls.every((c) => Object.keys(c).length > 0)).toBe(true)
    expect(calls).toHaveLength(2)
  })
  it('最初から空の payload は一度も投げない', async () => {
    let n = 0
    const res = await writeDroppingMissingColumns({}, async () => {
      n++
      return { data: null, error: null }
    })
    expect(n).toBe(0)
    expect(res.skipped).toBe(true)
    expect(res.error).toBeNull()
  })
  it('insert で keyColumns しか残らないときは投げない（取引先・品目だけの空ルールを作らない）', async () => {
    const calls: Record<string, unknown>[] = []
    const res = await writeDroppingMissingColumns(
      { customer_id: 'c', product_id: 'p', has_seal: true },
      async (p) => {
        calls.push(p)
        return 'has_seal' in p
          ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'has_seal' column of 'customer_product_rules' in the schema cache" } }
          : { data: null, error: null }
      },
      5,
      { keyColumns: ['customer_id', 'product_id'] },
    )
    expect(calls).toHaveLength(1)
    expect(res.skipped).toBe(true)
    expect(res.error).toBeNull()
  })
  it('keyColumns 以外の実在する列が残れば書き込む', async () => {
    const calls: Record<string, unknown>[] = []
    await writeDroppingMissingColumns(
      { customer_id: 'c', product_id: 'p', container_type: '青コン' },
      async (p) => {
        calls.push(p)
        return { data: null, error: null }
      },
      5,
      { keyColumns: ['customer_id', 'product_id'] },
    )
    expect(calls).toEqual([{ customer_id: 'c', product_id: 'p', container_type: '青コン' }])
  })
  it('欠落列以外のエラーは再試行せずそのまま返す', async () => {
    let n = 0
    const res = await writeDroppingMissingColumns({ quantity: 1 }, async () => {
      n++
      return { data: null, error: { code: '23502', message: 'x' } }
    })
    expect(n).toBe(1)
    expect(res.error?.code).toBe('23502')
  })
})
