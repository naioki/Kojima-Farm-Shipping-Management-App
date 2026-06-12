import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * service_role キーを使う管理クライアント（RLS バイパス）。
 * cron 取り込み・集計・請求書生成などサーバー専用処理でのみ使用する。
 *
 * security.md 厳守:
 *   - service_role キーは Secret Manager 由来の環境変数からのみ取得（コード埋め込み禁止）
 *   - このファイルは 'server-only' を import し、'use client' から間接 import されたら
 *     ビルド時にエラーになるようにする
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / URL が未設定です（Secret Manager を確認）')
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
