import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getOrdersList, type OrderFilter } from '@/lib/orders/list'
import { statusLabel, sourceLabel } from '@/components/admin/OrderStatusBadge'
import { jstTodayStr } from '@/lib/dates'

export const runtime = 'nodejs'

/** Excel(日本語)で文字化けしないための UTF-8 BOM。 */
const CSV_BOM = '﻿'

const dateRe = /^\d{4}-\d{2}-\d{2}$/
const querySchema = z.object({
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  start: z.string().regex(dateRe).optional(),
  end: z.string().regex(dateRe).optional(),
})

/** 1セルを CSV 用にエスケープ（ダブルクォート・改行・カンマ対応）。 */
function cell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 受注一覧の CSV ダウンロード（UTF-8 BOM・受注1件＝1行）。
 * 一覧画面と同じ絞り込み（状態・取引先・期間）をクエリで受け取り、同じ並び順で出力する。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({
    status: searchParams.get('status') || undefined,
    customerId: searchParams.get('customerId') || undefined,
    start: searchParams.get('start') || undefined,
    end: searchParams.get('end') || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const filter = parsed.data as OrderFilter
  if (filter.start && filter.end && filter.start > filter.end) {
    return NextResponse.json({ error: 'invalid', detail: '開始日は終了日以前にしてください' }, { status: 400 })
  }

  let rows
  try {
    rows = await getOrdersList(filter, 5000)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }

  const header = ['受注日', '納品日', '取引先', '受注元', '状態', '件数', '金額（税込）']
  const lines = [header.map(cell).join(',')]
  for (const o of rows) {
    lines.push(
      [
        o.orderDate ?? '',
        o.deliveryDate ?? '',
        o.customerName,
        sourceLabel(o.source),
        statusLabel(o.status),
        o.itemCount,
        Math.round(o.amount),
      ]
        .map(cell)
        .join(','),
    )
  }
  const csv = CSV_BOM + lines.join('\r\n')

  const stamp = jstTodayStr()
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv;charset=utf-8',
      'content-disposition': `attachment; filename="orders_${stamp}.csv"`,
    },
  })
}
