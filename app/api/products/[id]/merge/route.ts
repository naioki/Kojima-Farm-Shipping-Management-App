import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { productMergeSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 品目の統合（管理者）。重複品目（例「トマト 箱」）を別品目（「トマト」）の【荷姿】に寄せる。
 *   1. 対象品目に pack_config を作成（販売単位＝この品目の単位、base_per_selling＝基準単位換算）
 *   2. この重複品目を無効化（参照があれば履歴保護のため is_active=false、未使用なら物理削除）
 * 既存注文の product_id は再ポインティングしない（履歴は元のまま＝安全）。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者のみ操作できます' }, { status: 403 })

  const parsed = productMergeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const d = parsed.data
  const sourceId = params.id
  if (d.target_product_id === sourceId) {
    return NextResponse.json({ error: '同じ品目には統合できません' }, { status: 400 })
  }

  const { data: source } = await supabase.from('products').select('id, name, unit').eq('id', sourceId).maybeSingle()
  if (!source) return NextResponse.json({ error: '統合元の品目が見つかりません' }, { status: 404 })
  const { data: target } = await supabase.from('products').select('id, name').eq('id', d.target_product_id).maybeSingle()
  if (!target) return NextResponse.json({ error: '統合先の品目が見つかりません' }, { status: 404 })

  // ① 統合先に荷姿を作成
  const { error: pcErr } = await supabase.from('pack_configs').insert({
    product_id: d.target_product_id,
    customer_id: null,
    label: d.label ?? `${source.name}（${source.unit}）`,
    selling_unit_label: d.selling_unit_label,
    base_per_selling: d.base_per_selling,
  })
  if (pcErr) return NextResponse.json({ error: `荷姿の作成に失敗: ${pcErr.message}` }, { status: 500 })

  // ② 重複品目の参照を確認 → 未使用なら削除、使用中なら無効化
  const [oi, cpr, ht, he, pr, pc] = await Promise.all([
    supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    supabase.from('customer_product_rules').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    supabase.from('harvest_tasks').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    supabase.from('harvest_estimates').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    supabase.from('price_rules').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
    supabase.from('pack_configs').select('id', { count: 'exact', head: true }).eq('product_id', sourceId),
  ])
  const refTotal =
    (oi.count ?? 0) + (cpr.count ?? 0) + (ht.count ?? 0) + (he.count ?? 0) + (pr.count ?? 0) + (pc.count ?? 0)

  let deleted = false
  if (refTotal === 0) {
    const { error: delErr } = await supabase.from('products').delete().eq('id', sourceId)
    if (delErr) {
      // 物理削除に失敗したら無効化にフォールバック
      await supabase.from('products').update({ is_active: false }).eq('id', sourceId)
    } else {
      deleted = true
    }
  } else {
    const { error: deactErr } = await supabase.from('products').update({ is_active: false }).eq('id', sourceId)
    if (deactErr) return NextResponse.json({ error: `無効化に失敗: ${deactErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ merged: true, deleted, targetName: target.name })
}
