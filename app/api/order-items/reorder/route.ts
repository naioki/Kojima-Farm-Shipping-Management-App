import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { noteSideEffectFailure, runSideEffect, withWarnings } from '@/lib/api/side-effects'

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
      // 未適用環境ではこの退避ストアが唯一の保存先。保存できなければ成功扱いにしない
      const { data: settingRow, error: readErr } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'v5_pack_sort_order')
        .maybeSingle()
      if (readErr) {
        // 読めないまま書くと他の明細の並び順を消してしまうため、ここで止める
        console.error('[order-items/reorder] 退避ストア v5_pack_sort_order の読み込みに失敗:', readErr.message)
        return NextResponse.json({ error: '並び順の保存に失敗しました。もう一度お試しください' }, { status: 500 })
      }

      let map: Record<string, number> = {}
      if (settingRow?.value) {
        try {
          map = JSON.parse(settingRow.value) as Record<string, number>
        } catch (parseErr) {
          // 壊れた値は読み直せないので作り直す（ログに残す）
          console.error('[order-items/reorder] v5_pack_sort_order が壊れているため作り直します:', parseErr)
        }
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

      const { error: fbErr } = await admin.from('app_settings').upsert(
        {
          key: 'v5_pack_sort_order',
          value: JSON.stringify(map),
          is_secret: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      if (fbErr) {
        console.error('[order-items/reorder] 退避ストア v5_pack_sort_order への保存に失敗:', fbErr.message)
        return NextResponse.json({ error: '並び順の保存に失敗しました。もう一度お試しください' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, fallback: true })
    }
    console.error('[order-items/reorder] failed:', failed.error.message)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  // 【#9-04 解消】DBカラム更新が成功した際も、app_settings(v5_pack_sort_order) に残っている古いソート値を同期・削除し、「自動順に戻す」が100%確実に効くようにする
  // 本体（order_items）は保存済みなので、ここの失敗は 500 にせず警告で返す
  const warnings: string[] = []
  const SYNC_WARN = '並び順は保存しましたが、古い並び順の片付けに失敗しました。画面を読み込み直して並びを確認してください'
  const SYNC_TAG = '[order-items/reorder] 退避ストア v5_pack_sort_order の同期に失敗'
  const { data: settingRow, error: syncReadErr } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'v5_pack_sort_order')
    .maybeSingle()
  if (syncReadErr) {
    noteSideEffectFailure(warnings, SYNC_TAG, syncReadErr, SYNC_WARN)
  } else if (settingRow?.value) {
    let map: Record<string, number> | null = null
    try {
      map = JSON.parse(settingRow.value) as Record<string, number>
    } catch (parseErr) {
      noteSideEffectFailure(warnings, SYNC_TAG, parseErr, SYNC_WARN)
    }
    if (map) {
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
        const syncMap = map
        await runSideEffect(warnings, SYNC_TAG, SYNC_WARN, () =>
          admin.from('app_settings').upsert(
            {
              key: 'v5_pack_sort_order',
              value: JSON.stringify(syncMap),
              is_secret: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' },
          ),
        )
      }
    }
  }

  return NextResponse.json(withWarnings({ ok: true }, warnings))
}
