import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingColumnError } from '@/lib/supabase/missing-column'
import { saveDestinationOverride } from '@/lib/field/destination-routes-store'
import { noteSideEffectFailure, withWarnings } from '@/lib/api/side-effects'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const updateSchema = z.object({
  code: z.string().trim().min(1).nullish(),
  full_name: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  is_active: z.boolean().optional(),
  departure_time: z.string().trim().nullish(),
  shipping_route_name: z.string().trim().nullish(),
  pack_sort_order: z.number().int().optional(),
  default_container_type: z.string().trim().nullish(),
})

/** 納入先の更新（略称・正式名・aliases・便名・出荷時間・規定コンテナ・並び順・有効/無効）。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', detail: parsed.error.flatten() }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.code !== undefined) patch.code = parsed.data.code ?? null
  if (parsed.data.full_name !== undefined) patch.full_name = parsed.data.full_name
  if (parsed.data.aliases !== undefined) patch.aliases = parsed.data.aliases
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active
  if (parsed.data.departure_time !== undefined) patch.departure_time = parsed.data.departure_time ?? null
  if (parsed.data.shipping_route_name !== undefined) patch.shipping_route_name = parsed.data.shipping_route_name ?? null
  if (parsed.data.pack_sort_order !== undefined) patch.pack_sort_order = parsed.data.pack_sort_order
  if (parsed.data.default_container_type !== undefined) patch.default_container_type = parsed.data.default_container_type ?? null

  const admin = createAdminClient()
  let updRes = await admin
    .from('delivery_destinations')
    .update(patch)
    .eq('id', params.id)
    .select('id, code, full_name, aliases, is_active, departure_time, shipping_route_name, pack_sort_order, default_container_type')
    .single()

  // 拡張4列（出発時刻・便名・並び順・規定コンテナ）を列に保存できたか（本番は列が無いので false。そのときは退避ストアが唯一の保存先）
  const routeSavedToColumns = !updRes.error
  const updErrorFirst = updRes.error
  // 出発時刻・便名以外の項目（名前など）を保存したか
  let otherFieldsSaved = !updRes.error && ['code', 'full_name', 'aliases', 'is_active'].some((k) => k in patch)
  if (updRes.error && isMissingColumnError(updRes.error)) {
    // 0026 未適用環境（PGRST204 / 42703 両対応）: 新規追加カラムを除外して更新
    const fallbackPatch: Record<string, unknown> = {}
    if (parsed.data.code !== undefined) fallbackPatch.code = parsed.data.code ?? null
    if (parsed.data.full_name !== undefined) fallbackPatch.full_name = parsed.data.full_name
    if (parsed.data.aliases !== undefined) fallbackPatch.aliases = parsed.data.aliases
    if (parsed.data.is_active !== undefined) fallbackPatch.is_active = parsed.data.is_active

    if (Object.keys(fallbackPatch).length > 0) {
      otherFieldsSaved = true
      updRes = await admin
        .from('delivery_destinations')
        .update(fallbackPatch)
        .eq('id', params.id)
        .select('id, code, full_name, aliases, is_active')
        .single()
    } else {
      updRes = await admin
        .from('delivery_destinations')
        .select('id, code, full_name, aliases, is_active')
        .eq('id', params.id)
        .single()
    }
  }

  if (updRes.error) return NextResponse.json({ error: updRes.error.message }, { status: 500 })

  // 列に保存できなかった項目の扱い（本番は拡張4列が無い）:
  // - 出発時刻・便名: 退避ストア（app_settings v5_destination_routes）に常に保存（列ありでも控えとして同期）
  // - 規定コンテナ: 退避ストアの同じ納入先エントリにも常に保存（列ありでも控えとして同期）。
  //   読む側は「列の値 → 退避ストアの値」なので、列を空にしたときに退避ストアの古い値が復活しないよう、
  //   列に保存できた場合も退避ストアの値を消す／書き換える（docs/migration-v5-columns.md §3）
  // - 並び順（pack_sort_order）: 退避先が無いので、列に保存できなければ警告で返す（黙って捨てない）
  // 退避保存の失敗:
  // - 列に保存できていない かつ 名前など他の項目も無い → ここが唯一の保存先なので 500
  // - 名前など他の項目は保存済み → 成功＋何が未保存か分かる警告
  // - 列に保存済みで退避側の同期だけ失敗 → 成功＋警告
  const warnings: string[] = []
  const routeRequested = parsed.data.departure_time !== undefined || parsed.data.shipping_route_name !== undefined
  const containerToStore = parsed.data.default_container_type !== undefined
  const storeLabels = [
    ...(routeRequested ? ['出発時刻・便名'] : []),
    ...(containerToStore ? ['規定コンテナ'] : []),
  ]
  const storeLabel = storeLabels.join('と')
  let containerSavedToStore = false
  if (storeLabels.length > 0) {
    try {
      await saveDestinationOverride(admin, [`dest:${params.id}`], {
        ...(routeRequested
          ? {
              departureTime: parsed.data.departure_time ?? null,
              shippingRouteName: parsed.data.shipping_route_name ?? null,
            }
          : {}),
        ...(containerToStore ? { defaultContainerType: parsed.data.default_container_type ?? null } : {}),
      })
      containerSavedToStore = containerToStore
    } catch (e) {
      if (!routeSavedToColumns && !otherFieldsSaved) {
        console.error(
          `[api/destinations/[id]] ${storeLabel}の保存（app_settings v5_destination_routes・唯一の保存先）に失敗:`,
          e instanceof Error ? e.message : e,
        )
        return NextResponse.json({ error: `${storeLabel}を保存できませんでした。もう一度お試しください` }, { status: 500 })
      }
      noteSideEffectFailure(
        warnings,
        routeSavedToColumns
          ? `[api/destinations/[id]] ${storeLabel}の退避保存（app_settings v5_destination_routes）の同期に失敗`
          : `[api/destinations/[id]] ${storeLabel}の保存（app_settings v5_destination_routes・唯一の保存先）に失敗`,
        e,
        routeSavedToColumns
          ? `${storeLabel}は保存しましたが、控えの更新に失敗しました。表示が古いままの場合は、もう一度保存してください`
          : `納入先名などは保存しましたが、${storeLabel}は保存できませんでした。${storeLabel}をもう一度保存してください`,
      )
    }
  }
  if (parsed.data.pack_sort_order !== undefined && !routeSavedToColumns) {
    noteSideEffectFailure(
      warnings,
      '[api/destinations/[id]] pack_sort_order 列が無いため並び順を保存できませんでした（退避先なし）',
      updErrorFirst,
      'この環境では納入先の並び順を保存できません。並び順は変わっていません',
    )
  }

  const destination: Record<string, unknown> = { ...(updRes.data as Record<string, unknown>) }
  if (containerSavedToStore) destination.default_container_type = parsed.data.default_container_type?.trim() || null

  return NextResponse.json(withWarnings({ destination }, warnings))
}

/** 納入先の削除。過去の注文履歴を壊さず、実績0件なら物理削除、実績ありなら is_active=false（アーカイブ）に更新する。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()

  // 過去の注文・配送実績を確認（履歴保護）
  const [ord, del] = await Promise.all([
    admin.from('orders').select('id', { count: 'exact', head: true }).eq('destination_id', params.id),
    admin.from('deliveries').select('id', { count: 'exact', head: true }).eq('destination_id', params.id),
  ])

  if ((ord.count ?? 0) === 0 && (del.count ?? 0) === 0) {
    // 実績0件なら物理削除を試行
    const { error: delErr } = await admin.from('delivery_destinations').delete().eq('id', params.id)
    if (!delErr) {
      return NextResponse.json({ deleted: true, mode: 'physical', ok: true })
    }
  }

  // 過去実績がある場合（またはFK保護が働いた場合）は、過去注文の destination_id を壊さずに is_active: false に更新して安全にアーカイブ
  const { error: archErr } = await admin
    .from('delivery_destinations')
    .update({ is_active: false })
    .eq('id', params.id)

  if (archErr) return NextResponse.json({ error: archErr.message }, { status: 500 })

  return NextResponse.json({ deleted: true, mode: 'archived', ok: true })
}
