import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 社内ユーザー（admin/staff）判定。DB 関数 public.is_staff()（migrations/0023）と
 * 同じ「public.users に行があるか」の判定を、サーバー側で service_role で行う。
 *
 * 用途: 現場スタッフからの書き込み系 API（スマート追加・取引先/品目のクイック作成）で、
 * RLS を緩めずに「検証済みサーバー経路を admin client で通す」ためのゲート。
 * ポータル取引先ユーザーは auth.users にのみ存在し public.users に行が無いため false。
 *
 * service_role で public.users を直接確認するため users テーブルの RLS に依存しない
 * （app_metadata.role の付与漏れにも影響されない = is_staff() と同じ堅牢性）。
 * 失敗は false（deny）にフォールバックし、無言にはしない（CLAUDE.md）。
 */
export async function isStaffUser(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[is-staff-user] 社内ユーザー判定に失敗:', error.message)
    return false
  }
  return !!data
}
