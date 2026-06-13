import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { generateInvoiceForCustomer } from '@/lib/invoices/generate'

export const runtime = 'nodejs'

const inputSchema = z
  .object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.period_start <= v.period_end, {
    message: '開始日は終了日以前である必要があります',
    path: ['period_end'],
  })

/**
 * 月次一括生成（全取引先まとめて）。指定期間で、有効な取引先ごとに請求書を生成する。
 *   - 請求対象明細が無い取引先はスキップ（空の請求書・無駄な採番をしない）。
 *   - 同一 (取引先×期間) に既に請求書があればスキップ（二重作成防止）。
 *   - 番号は終了日の月で欠番なし採番（取引先をまたいで連番・税務上正しい）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { period_start, period_end } = parsed.data
  const supabase = createClient()

  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })

  // 同一期間の既存請求書（二重作成防止）
  const { data: existing } = await supabase
    .from('invoices')
    .select('customer_id')
    .eq('period_start', period_start)
    .eq('period_end', period_end)
  const alreadyBilled = new Set((existing ?? []).map((e) => e.customer_id))

  const created: { customer: string; invoice_number: string; total: number }[] = []
  const skipped: { customer: string; reason: string }[] = []

  for (const c of customers ?? []) {
    if (alreadyBilled.has(c.id)) {
      skipped.push({ customer: c.name, reason: 'already_billed' })
      continue
    }
    const r = await generateInvoiceForCustomer(supabase, {
      customerId: c.id,
      periodStart: period_start,
      periodEnd: period_end,
      userId: user.id,
    })
    if (r.ok) created.push({ customer: c.name, invoice_number: r.invoice_number, total: r.total })
    else if (r.reason === 'no_items') skipped.push({ customer: c.name, reason: 'no_items' })
    else skipped.push({ customer: c.name, reason: r.message })
  }

  return NextResponse.json({ created_count: created.length, skipped_count: skipped.length, created, skipped }, { status: 201 })
}
