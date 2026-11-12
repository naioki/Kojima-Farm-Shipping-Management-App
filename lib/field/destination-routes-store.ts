import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { truncateForLog } from '@/lib/log/truncate'

export type RouteOverride = {
  departureTime: string | null
  shippingRouteName: string | null
}

const SETTING_KEY = 'v5_destination_routes'

/**
 * 退避データの文字列を読む。JSON として壊れている（または中身がオブジェクトでない）ときは null。
 * 壊れた値は自然には直らないので、呼び出し側で記録したうえで作り直す。
 */
function parseRouteOverrides(raw: string): Record<string, RouteOverride> | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, RouteOverride>
    return null
  } catch {
    // 壊れた JSON は null を返して呼び出し側に任せる（記録・作り直しは呼び出し側）
    return null
  }
}

type ReadResult = { overrides: Record<string, RouteOverride>; broken: string | null }

/**
 * 退避データを読む。通信・DBエラーは throw する（空として上書きすると他の納入先の値を消すため）。
 * 読めたが JSON として壊れているときは broken に元の文字列を入れ、空として返す。
 */
async function readRouteOverridesStrict(admin: SupabaseClient): Promise<ReadResult> {
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()
  if (error) throw new Error(`出荷時間・便名の退避データの読み込みに失敗: ${error.message}`)
  if (!data?.value) return { overrides: {}, broken: null }
  const raw = String(data.value)
  const parsed = parseRouteOverrides(raw)
  if (!parsed) return { overrides: {}, broken: raw }
  return { overrides: parsed, broken: null }
}

export type RouteOverridesLoad = {
  overrides: Record<string, RouteOverride>
  /** 通信・DBエラーのときだけ入る（利用者向けではない詳細。画面では警告帯の詳細欄に出す） */
  error: string | null
}

/**
 * 画面表示用に出発時刻・便名の退避データを読み、失敗を返す（画面側で警告帯を出せるように）。
 * - 通信・DBエラー → error に詳細を入れ、overrides は空
 * - 行が無い → 空・error なし
 * - JSON として壊れている／オブジェクトでない（"null"・配列・数値など）→ 例外を出さず空・error なし。
 *   壊れた値は次の保存（saveRouteOverride）で作り直されるため、画面に警告を出し続けない。console.error には残す。
 */
export async function loadRouteOverrides(admin: SupabaseClient): Promise<RouteOverridesLoad> {
  let r: ReadResult
  try {
    r = await readRouteOverridesStrict(admin)
  } catch (e) {
    return { overrides: {}, error: e instanceof Error ? e.message : String(e) }
  }
  if (r.broken !== null) {
    console.error(
      `[destination-routes-store] 退避データ（${SETTING_KEY}）が JSON として壊れています。空として扱います（次の保存で作り直されます）。値:`,
      truncateForLog(r.broken),
    )
  }
  return { overrides: r.overrides, error: null }
}

/**
 * 0026未適用環境でも出荷時間・便名を確実に永続化するための app_settings ストア。
 * 表示用の読み込みなので、失敗時は console.error に残して空として扱う（失敗を画面に出すなら loadRouteOverrides）。
 */
export async function getRouteOverrides(admin: SupabaseClient): Promise<Record<string, RouteOverride>> {
  const r = await loadRouteOverrides(admin)
  if (r.error) console.error('[destination-routes-store] 出荷時間・便名の退避データを読めませんでした:', r.error)
  return r.overrides
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

  // 読み込み失敗（通信・DBエラー）を空扱いにすると、他の納入先の退避データを上書きで消してしまうため throw する。
  // 読めたが JSON として壊れている値は自然に直らないので、元の値をログに残して作り直す。
  const read = await readRouteOverridesStrict(admin)
  if (read.broken !== null) {
    console.error(
      `[destination-routes-store] 退避データ（${SETTING_KEY}）が壊れているため作り直します。壊れていた値:`,
      truncateForLog(read.broken),
    )
  }
  const existing = read.overrides
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
