import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type RouteOverride = {
  departureTime: string | null
  shippingRouteName: string | null
}

const SETTING_KEY = 'v5_destination_routes'

/**
 * 0026未適用環境でも出荷時間・便名を確実に永続化するための app_settings ストア
 */
export async function getRouteOverrides(admin: SupabaseClient): Promise<Record<string, RouteOverride>> {
  try {
    const { data } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle()
    if (!data?.value) return {}
    return JSON.parse(data.value) as Record<string, RouteOverride>
  } catch {
    return {}
  }
}

/**
 * 指定されたキー群（納入先ID、取引先+納入先名、取引先デフォルト等）すべてに RouteOverride を記録・保存する
 */
export async function saveRouteOverride(
  admin: SupabaseClient,
  keys: string[],
  override: RouteOverride,
): Promise<void> {
  const validKeys = keys.filter((k) => typeof k === 'string' && k.trim().length > 0)
  if (validKeys.length === 0) return

  const existing = await getRouteOverrides(admin)
  for (const k of validKeys) {
    existing[k] = {
      departureTime: override.departureTime ?? null,
      shippingRouteName: override.shippingRouteName ?? null,
    }
  }

  await admin.from('app_settings').upsert(
    {
      key: SETTING_KEY,
      value: JSON.stringify(existing),
      is_secret: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
}
