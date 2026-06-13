import 'server-only'
import { createAdminClient } from './supabase/admin'
import { SETTINGS_BY_KEY } from './settings-spec'

/**
 * 設定値のサーバ専用リゾルバ。
 * 解決順: app_settings（DB）→ 環境変数（Secret Manager 由来）。
 * service_role で読むため cron（無セッション）でも server component でも使える。
 * 秘密情報を含むので 'server-only'（client から import 不可）。
 */

let cache: { at: number; map: Map<string, string> } | null = null
const TTL_MS = 30_000

async function loadFromDb(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map
  const admin = createAdminClient()
  const { data } = await admin.from('app_settings').select('key, value')
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (row.value != null && row.value !== '') map.set(row.key, row.value)
  }
  cache = { at: Date.now(), map }
  return map
}

/** 1つの設定値を解決（DB→env）。未設定は null。 */
export async function getSetting(key: string): Promise<string | null> {
  const db = await loadFromDb()
  const v = db.get(key)
  if (v != null && v !== '') return v
  const env = process.env[key]
  return env != null && env !== '' ? env : null
}

/** 設定が「設定済み」か（DB か env のどちらかに値がある）。 */
export async function isConfigured(key: string): Promise<boolean> {
  return (await getSetting(key)) != null
}

/** トグル設定が off かどうか（'off' のときのみ true）。既定は on 扱い。 */
export async function isOff(key: string): Promise<boolean> {
  return (await getSetting(key))?.toLowerCase() === 'off'
}

/** 設定変更後にキャッシュを破棄（保存直後の即時反映用）。 */
export function invalidateSettingsCache(): void {
  cache = null
}

/** SETTINGS_SPEC にあるキーか（API でホワイトリスト検証に使う）。 */
export function isKnownSettingKey(key: string): boolean {
  return key in SETTINGS_BY_KEY
}
