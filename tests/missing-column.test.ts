import { describe, it, expect } from 'vitest'
import { missingColumnName, writeDroppingMissingColumns } from '@/lib/supabase/missing-column'

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
