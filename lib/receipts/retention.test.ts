import { describe, it, expect, vi } from 'vitest'
import { purgeOldReceiptBase64 } from './retention'

describe('purgeOldReceiptBase64', () => {
  it('7日以上前のレコードから file_base64 のみを削除し、他フィールドは保持する', async () => {
    const mockReceipts = [
      {
        id: 'rec-old-1',
        raw_payload: {
          file_base64: 'JVBERi0xLjQK...',
          text: '注文書テキスト',
          filename: 'fax.pdf',
        },
      },
      {
        id: 'rec-old-2',
        raw_payload: {
          file_base64: 'JVBERi0xLjQK...',
          slip_data: { slip_no: '123' },
        },
      },
    ]

    const updatedRows: Record<string, unknown>[] = []

    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockReceipts, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockImplementation((payload) => ({
          eq: vi.fn().mockImplementation((col, id) => {
            updatedRows.push({ id, ...payload })
            return Promise.resolve({ error: null })
          }),
        })),
      }),
    }

    const result = await purgeOldReceiptBase64(mockAdmin as unknown as import('@supabase/supabase-js').SupabaseClient, 7)

    expect(result.checkedCount).toBe(2)
    expect(result.purgedCount).toBe(2)
    expect(updatedRows).toHaveLength(2)

    // file_base64 が消去され、text や filename は保持されていることを検証
    const row1 = updatedRows.find((r) => r.id === 'rec-old-1') as { id: string; raw_payload: Record<string, unknown> }
    expect(row1.raw_payload.file_base64).toBeUndefined()
    expect(row1.raw_payload.text).toBe('注文書テキスト')
    expect(row1.raw_payload.filename).toBe('fax.pdf')
  })

  it('対象レコードが0件の場合は purgedCount 0 で正常終了する', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }

    const result = await purgeOldReceiptBase64(mockAdmin as unknown as import('@supabase/supabase-js').SupabaseClient, 7)
    expect(result.checkedCount).toBe(0)
    expect(result.purgedCount).toBe(0)
  })
})
