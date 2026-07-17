import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'
import { enqueuePrintJob } from '@/lib/shipping-docs/queue'

export const runtime = 'nodejs'

/**
 * 印刷キュー投入（統合2D）。出荷帳票PDFを生成して Storage に置き、print_jobs に登録する。
 * 事務所の常駐エージェント（v4 print_agent.py 無改修）が pending を拾って自動印刷する。
 * 権限は現場印刷ページと同じ（STAFF_CAN_PRINT_DOCS。admin は常に可）。
 */

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  docType: z.enum(['sheet', 'labels']),
  productId: z.string().uuid().nullish(),
  customerIds: z.array(z.string().uuid()).nullish(),
})

export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const features = await getStaffFeatures()
  if (!canStaffUse('printDocs', role, features)) {
    return NextResponse.json({ error: '帳票印刷は解放されていません' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { date, docType, productId, customerIds } = parsed.data

  // PDF生成 → Storage保存 → 署名URL → キュー登録は lib/shipping-docs/queue.ts に集約
  // （チャット自動化と共有）。キュー登録は利用者クライアントで行い RLS staff_insert を効かせる。
  const result = await enqueuePrintJob(supabase, {
    date,
    docType,
    productId,
    customerIds,
    requestedBy: user.id,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ id: result.id })
}
