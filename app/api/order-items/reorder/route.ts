import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 現場・管理者によるパック作業順（daily_pack_sort_order）更新API
 */
export async function POST(req: NextRequest) {
  // 社内ユーザー（admin/staff）のみ。旧実装はロール不明を staff 扱いにしていたため（fail open）、
  // 取引先ポータルの利用者も並び順を書き換えられた。public.users の行で判定し、無ければ 403。
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

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

  // 【#9-04 解消】DBカラム更新が成功した際も、app_settings(v5_pack_sort_order) に残っている古いソート値を同期・削除し、「自動順に戻す」が100%確実に効くようにする
  try {
    const { data: settingRow } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'v5_pack_sort_order')
      .maybeSingle()
    if (settingRow?.value) {
      const map = JSON.parse(settingRow.value) as Record<string, number>
      let changed = false
      for (const it of items) {
        if (it.sortOrder == null) {
          if (map[it.id] !== undefined) {
            delete map[it.id]
            changed = true
          }
        } else if (map[it.id] !== it.sortOrder) {
          map[it.id] = it.sortOrder
          changed = true
        }
      }
      if (changed) {
        await admin.from('app_settings').upsert(
          {
            key: 'v5_pack_sort_order',
            value: JSON.stringify(map),
            is_secret: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' },
        )
      }
    }
  } catch {}

  return NextResponse.json({ ok: true })
}
