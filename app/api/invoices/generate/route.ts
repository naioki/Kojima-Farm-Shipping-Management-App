import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { generateInvoiceForCustomer } from '@/lib/invoices/generate'

export const runtime = 'nodejs'

const inputSchema = z
  .object({
    customer_id: z.string().uuid(),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.period_start <= v.period_end, {
    message: '開始日は終了日以前である必要があります',
    path: ['period_end'],
  })

/**
 * 請求書生成（1取引先・任意期間）。tax.md 厳守。ロジックは lib/invoices/generate に集約し
 * 一括生成（generate-bulk）と共有する。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, period_start, period_end } = parsed.data
  const supabase = createClient()

  const r = await generateInvoiceForCustomer(supabase, {
    customerId: customer_id,
    periodStart: period_start,
    periodEnd: period_end,
    userId: user.id,
  })
  if (!r.ok) {
    if (r.reason === 'no_items') return NextResponse.json({ error: 'no_billable_items' }, { status: 404 })
    return NextResponse.json({ error: r.message }, { status: 500 })
  }
  return NextResponse.json({ invoice_id: r.invoice_id, invoice_number: r.invoice_number, total: r.total }, { status: 201 })
}
