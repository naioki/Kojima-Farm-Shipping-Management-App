import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * 同じ内容の通知を繰り返し送らないための重複抑止（Cron が5分毎に動いても通知はスパムにならない）。
 * 直近に送った通知の指紋（日付＋内容）を app_settings に保存し、同一なら false を返す。
 * 判定に失敗した場合は true（＝通知する）。見逃しよりも重複を選ぶ。
 */
export async function shouldNotifyOnce(
  admin: SupabaseClient<Database>,
  key: string,
  fingerprint: string,
): Promise<boolean> {
  const { data, error } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) {
    console.error('[notify-dedupe] 前回通知の取得に失敗:', error.message)
    return true
  }
  if (data?.value === fingerprint) return false

  const { error: upErr } = await admin
    .from('app_settings')
    .upsert({ key, value: fingerprint, is_secret: false, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (upErr) console.error('[notify-dedupe] 通知履歴の保存に失敗:', upErr.message)
  return true
}
