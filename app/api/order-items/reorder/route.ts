import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 現場・管理者によるパック作業順（daily_pack_sort_order）更新API
 */
export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 認証済みユーザーであれば並び順の更新を許可（社内スタッフ・管理者）。改ざん可能な user_metadata は参照しない
  let role = user.app_metadata?.role as string | undefined
  if (!role) {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    role = (profile?.role as string) ?? 'staff'
  }
  if (role === 'portal') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { items } = body as { items: Array<{ id: string; sortOrder: number | null }> }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  const admin = createAdminClient()
  // 順次更新（service role で RLS を安全にバイパス）
  const promises = items.map((it) =>
    admin
      .from('order_items')
      .update({ daily_pack_sort_order: it.sortOrder ?? null })
      .eq('id', it.id),
  )

  const results = await Promise.all(promises)
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    // 列がまだDBに存在しない（未マイグレーション）環境でもクライアント側でエラー通知を爆発させず安全にフォールバック
    if (
      failed.error.code === '42703' ||
      failed.error.message?.includes('daily_pack_sort_order')
    ) {
      console.warn('[order-items/reorder] daily_pack_sort_order column not in DB schema, falling back to app_settings:', failed.error.message)
      try {
        const { data: settingRow } = await admin
          .from('app_settings')
          .select('value')
          .eq('key', 'v5_pack_sort_order')
          .maybeSingle()

        let map: Record<string, number> = {}
        if (settingRow?.value) {
          try {
            map = JSON.parse(settingRow.value) as Record<string, number>
          } catch {}
        }

        for (const it of items) {
          if (it.sortOrder == null) {
            delete map[it.id]
          } else {
            map[it.id] = it.sortOrder
          }
        }

        // 肥大化防止（最新500件程度を保持）
        const keys = Object.keys(map)
        if (keys.length > 500) {
          const trimmed: Record<string, number> = {}
          for (const k of keys.slice(-500)) {
            if (map[k] !== undefined) trimmed[k] = map[k]
          }
          map = trimmed
        }

        await admin.from('app_settings').upsert(
          {
            key: 'v5_pack_sort_order',
            value: JSON.stringify(map),
            is_secret: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' },
        )
      } catch (fbErr) {
        console.warn('[order-items/reorder] fallback app_settings failed:', fbErr)
      }
      return NextResponse.json({ ok: true, fallback: true })
    }
    console.error('[order-items/reorder] failed:', failed.error.message)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
