import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActorUserIdSetting } from './config'

/**
 * 承認を実行するアプリユーザー（users.id）を解決する（2E-1 申し送り事項）。
 * approveAndPrint は実在する users.id を要求するが、Discord ユーザーIDは別ID体系のため橋渡しが必要。
 *
 * 解決順（v4踏襲）:
 *   1. 設定 CHAT_BOT_ACTOR_USER_ID があればそれを使う（運用で明示指定できる）
 *   2. 無ければ users テーブルの role='admin' 先頭（created_at 昇順）
 *   3. どちらも無ければ日本語エラーを返し、承認を止める（握りつぶさない）
 */
export type ResolveActorResult = { ok: true; userId: string } | { ok: false; error: string }

export async function resolveChatActorUserId(): Promise<ResolveActorResult> {
  const configured = await getActorUserIdSetting()
  if (configured) return { ok: true, userId: configured }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) {
      return { ok: false, error: `承認実行ユーザーの解決に失敗しました: ${error.message}` }
    }
    if (!data) {
      return {
        ok: false,
        error:
          '承認を実行できる管理者ユーザーが見つかりません。設定 CHAT_BOT_ACTOR_USER_ID を指定してください。',
      }
    }
    return { ok: true, userId: data.id }
  } catch (e) {
    return {
      ok: false,
      error: `承認実行ユーザーの解決に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
