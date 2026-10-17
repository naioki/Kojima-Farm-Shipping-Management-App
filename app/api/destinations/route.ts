import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

const createSchema = z.object({
  customer_id: z.string().uuid(),
  /** 略称/コード（表示用・FAX左の短い名）。例: マルタ */
  code: z.string().trim().min(1).nullish(),
  /** 正式名（伝票用）。例: 東海コープ(株)エムエルティ */
  full_name: z.string().trim().min(1),
  /** OCR表記ゆれ吸収用。 */
  aliases: z.array(z.string().trim().min(1)).default([]),
})

/** 納入先の新規作成（取引先の配下）。admin のみ（RLS）。 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', detail: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createClient()

  // 重複登録防止（Issue#6-(5)）: 同一取引先の配下で正規化名が一致する既存を先に探す。
  // DB の UNIQUE INDEX(uq_dest_norm_fullname) が最終防波堤。ここで 409＋既存候補を返し、
  // UI が「既存の◯◯を使いますか？」を提示できるようにする。
  const norm = normalizeOrgName(parsed.data.full_name)
  const { data: siblings, error: listErr } = await supabase
    .from('delivery_destinations')
    .select('id, code, full_name, aliases, is_active')
    .eq('customer_id', parsed.data.customer_id)
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const existing = (siblings ?? []).find((d) => normalizeOrgName(d.full_name) === norm)
  if (existing) {
    return NextResponse.json({ error: 'duplicate', existing }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('delivery_destinations')
    .insert({
      customer_id: parsed.data.customer_id,
      code: parsed.data.code ?? null,
      full_name: parsed.data.full_name,
      aliases: parsed.data.aliases,
    })
    .select('id, code, full_name, aliases, is_active')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ destination: data }, { status: 201 })
}
