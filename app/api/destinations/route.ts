import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingColumnError } from '@/lib/supabase/missing-column'
import { normalizeOrgName } from '@/lib/normalize/org-name'
import { saveRouteOverride } from '@/lib/field/destination-routes-store'
import { noteSideEffectFailure, withWarnings } from '@/lib/api/side-effects'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const createSchema = z.object({
  customer_id: z.string().uuid(),
  /** 略称/コード（表示用・FAX左の短い名）。例: マルタ */
  code: z.string().trim().min(1).nullish(),
  /** 正式名（伝票用）。例: 東海コープ(株)エムエルティ */
  full_name: z.string().trim().min(1),
  /** OCR表記ゆれ吸収用。 */
  aliases: z.array(z.string().trim().min(1)).default([]),
  departure_time: z.string().trim().nullish(),
  shipping_route_name: z.string().trim().nullish(),
  default_container_type: z.string().trim().nullish(),
})

/** 納入先の新規作成（取引先の配下）。admin のみ（RLS）。 */
export async function POST(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', detail: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createAdminClient()

  // 重複登録防止（Issue#6-(5)）: 同一取引先の配下で正規化名が一致する既存を先に探す。
  // DB の UNIQUE INDEX(uq_dest_norm_fullname) が最終防波堤。ここで 409＋既存候補を返し、
  // UI が「既存の◯◯を使いますか？」を提示できるようにする。
  const norm = normalizeOrgName(parsed.data.full_name)
  const { data: siblings, error: listErr } = await supabase
    .from('delivery_destinations')
    .select('id, code, full_name, aliases, is_active')
    .eq('customer_id', parsed.data.customer_id)

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }

  const existing = (siblings ?? []).find((d) => normalizeOrgName(d.full_name) === norm)
  if (existing) {
    return NextResponse.json({ error: 'duplicate', existing }, { status: 409 })
  }

  const basePayload = {
    customer_id: parsed.data.customer_id,
    code: parsed.data.code ?? null,
    full_name: parsed.data.full_name,
    aliases: parsed.data.aliases,
  }

  const hasRouteData = Boolean(parsed.data.departure_time?.trim() || parsed.data.shipping_route_name?.trim() || parsed.data.default_container_type?.trim())
  let insRes: { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null } = { data: null, error: null }
  // 出発時刻・便名を列に保存できたか（本番は列が無いので false。そのときは退避ストアが唯一の保存先）
  let routeSavedToColumns = false

  if (hasRouteData) {
    // 拡張カラム指定時: カラムが存在すれば直接保存を試みる
    const fullPayload = {
      ...basePayload,
      departure_time: parsed.data.departure_time ?? null,
      shipping_route_name: parsed.data.shipping_route_name ?? null,
      default_container_type: parsed.data.default_container_type ?? null,
    }
    const r1 = await supabase
      .from('delivery_destinations')
      .insert(fullPayload)
      .select('id, code, full_name, aliases, is_active, departure_time, shipping_route_name, default_container_type')
      .single()

    if (r1.error && isMissingColumnError(r1.error)) {
      // 0026 未適用環境（PGRST204 / 42703）: 基本カラムで確実に作成
      const r2 = await supabase
        .from('delivery_destinations')
        .insert(basePayload)
        .select('id, code, full_name, aliases, is_active')
        .single()
      insRes = { data: r2.data as Record<string, unknown> | null, error: r2.error }
    } else {
      insRes = { data: r1.data as Record<string, unknown> | null, error: r1.error }
      routeSavedToColumns = !r1.error
    }
  } else {
    // 通常（納入先名・略称のみ）: 未適用カラムへのアクセスを最初から完全に回避し一発で作成
    const r = await supabase
      .from('delivery_destinations')
      .insert(basePayload)
      .select('id, code, full_name, aliases, is_active')
      .single()
    insRes = { data: r.data as Record<string, unknown> | null, error: r.error }
  }

  if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 500 })

  // departure_time や shipping_route_name が指定されている場合は app_settings の RouteOverride にも保存。
  // 納入先そのもの（名前など）は作成済みなので 500 にはしない（500 にすると再登録が重複扱いになる）。
  // ただし列に保存できていないときは出発時刻・便名が未保存なので、それが分かる警告にする。
  const warnings: string[] = []
  if (insRes.data?.id && (parsed.data.departure_time !== undefined || parsed.data.shipping_route_name !== undefined)) {
    try {
      const admin = createAdminClient()
      await saveRouteOverride(admin, [`dest:${insRes.data.id}`], {
        departureTime: parsed.data.departure_time ?? null,
        shippingRouteName: parsed.data.shipping_route_name ?? null,
      })
    } catch (e) {
      noteSideEffectFailure(
        warnings,
        routeSavedToColumns
          ? '[api/destinations] 出発時刻・便名の退避保存（app_settings v5_destination_routes）の同期に失敗'
          : '[api/destinations] 出発時刻・便名の保存（app_settings v5_destination_routes・唯一の保存先）に失敗',
        e,
        routeSavedToColumns
          ? '納入先と出発時刻・便名は保存しましたが、控えの更新に失敗しました。表示が古いままの場合は、出発時刻・便名をもう一度保存してください'
          : '納入先は登録しましたが、出発時刻・便名は保存できませんでした。この納入先の出発時刻・便名をもう一度保存してください',
      )
    }
  }

  return NextResponse.json(withWarnings({ destination: insRes.data }, warnings), { status: 201 })
}
