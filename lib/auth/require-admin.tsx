import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ErrorState } from '@/components/ui/States'

/**
 * 管理者専用ページの共通ガード。未認証は /login へ redirect。
 * RLS設定差や app_metadata.role 付与漏れの影響を受けないよう service_role (createAdminClient) で
 * public.users.role を確実に参照し、JWT app_metadata.role もフォールバックとして併用する。
 * admin でなければ ErrorState を返すので、ページ側は `if (guard) return guard` で使う。
 * null が返れば admin 確定（以降のデータ取得に進んでよい）。
 */
export async function requireAdmin(message = 'この画面は管理者のみアクセスできます。') {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr) console.error('[require-admin] ロールの取得に失敗:', profileErr.message)

  const jwtRole = (user.app_metadata as { role?: string } | undefined)?.role
  const effectiveRole = profile?.role ?? jwtRole

  if (effectiveRole !== 'admin') {
    return <ErrorState title="権限がありません" message={message} />
  }
  return null
}
