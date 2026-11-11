import 'server-only'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Route Handler 用の権限ガード（security.md）。
 * 「ログイン済み」だけでは取引先ポータルのユーザー（public.users に行が無い）も通ってしまうため、
 * 社内APIは必ず public.users のロールを service_role で確認する。fail closed:
 * 取得エラー・行なしは拒否し、無言にはしない。
 *
 * 使い方:
 *   const guard = await requireStaffApi()
 *   if (!guard.ok) return guard.response
 *   const user = guard.user
 */
export type ApiGuardResult =
  | { ok: true; user: User; role: 'admin' | 'staff' }
  | { ok: false; response: NextResponse }

async function resolve(
  allowed: ReadonlyArray<'admin' | 'staff'>,
  forbiddenMessage = '権限がありません',
): Promise<ApiGuardResult> {
  const user = await getAuthedUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }
  const admin = createAdminClient()
  const { data, error } = await admin.from('users').select('role').eq('id', user.id).maybeSingle()
  if (error) console.error('[api-guard] ロールの取得に失敗:', error.message)
  const role = data?.role
  if ((role !== 'admin' && role !== 'staff') || !allowed.includes(role)) {
    return { ok: false, response: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) }
  }
  return { ok: true, user, role }
}

/**
 * 社内ユーザー（admin / staff）のみ許可。取引先ポータルのユーザーは 403。
 * forbiddenMessage: 403 時に画面へ出す文言（省略時「権限がありません」）。
 */
export function requireStaffApi(forbiddenMessage?: string): Promise<ApiGuardResult> {
  return resolve(['admin', 'staff'], forbiddenMessage)
}

/** 管理者（経営）のみ許可。forbiddenMessage は requireStaffApi と同じ。 */
export function requireAdminApi(forbiddenMessage?: string): Promise<ApiGuardResult> {
  return resolve(['admin'], forbiddenMessage)
}
