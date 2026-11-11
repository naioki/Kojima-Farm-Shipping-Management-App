import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type RouteOverride = {
  departureTime: string | null
  shippingRouteName: string | null
}

const SETTING_KEY = 'v5_destination_routes'

async function readRouteOverridesStrict(admin: SupabaseClient): Promise<Record<string, RouteOverride>> {
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()
  if (error) throw new Error(`出荷時間・便名の退避データの読み込みに失敗: ${error.message}`)
  if (!data?.value) return {}
  try {
    return JSON.parse(data.value) as Record<string, RouteOverride>
  } catch (e) {
    throw new Error(`出荷時間・便名の退避データ（${SETTING_KEY}）が壊れています: ${String(e)}`)
  }
}

/**
 * 0026未適用環境でも出荷時間・便名を確実に永続化するための app_settings ストア。
 * 表示用の読み込みなので、失敗時は console.error に残して空として扱う。
 */
export async function getRouteOverrides(admin: SupabaseClient): Promise<Record<string, RouteOverride>> {
  try {
    return await readRouteOverridesStrict(admin)
  } catch (e) {
    console.error('[destination-routes-store] 出荷時間・便名の退避データを読めませんでした:', e)
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

  // 読み込み失敗を空扱いにすると、他の納入先の退避データを上書きで消してしまうため throw する
  const existing = await readRouteOverridesStrict(admin)
  for (const k of validKeys) {
    existing[k] = {
      departureTime: override.departureTime ?? null,
      shippingRouteName: override.shippingRouteName ?? null,
    }
  }

  const { error } = await admin.from('app_settings').upsert(
    {
      key: SETTING_KEY,
      value: JSON.stringify(existing),
      is_secret: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  // 保存できていないのに成功扱いにしない（呼び出し側が警告として返す）
  if (error) throw new Error(`出荷時間・便名の退避データの保存に失敗: ${error.message}`)
}
