import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { MobileNav } from '@/components/layouts/MobileNav'
import { ConnectionStatus } from '@/components/field/ConnectionStatus'
import { FieldLangProvider } from '@/lib/field/lang-context'

export const dynamic = 'force-dynamic'

/**
 * 現場（スタッフ・作業者）サーフェスの外枠。
 * - 下部バー（その他・下部選択項目）を全撤去し、画面を広く使えるようにシンプル化。
 * - 全画面ナビは上部メニュー（MobileNav）に集約。
 * - 現場向け認証チェック: 未ログインは /login へ。
 * - FieldLangProvider により、パック画面・配送画面間で言語モード（🇯🇵/🇹🇭）を完全同期。
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()
  // ロール解決に失敗したら最小権限（staff）にフォールバック。無言にはしない。
  if (profileErr) console.error('[field/layout] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  // 経営者欄には個人の名前を出さず、農園名「小島農園」を表示する
  const name = role === 'admin' ? '小島農園' : (profile?.full_name?.trim() || user.email?.split('@')[0] || 'スタッフ')
  const roleLabel = role === 'admin' ? '経営者' : '現場スタッフ'

  return (
    <FieldLangProvider>
      <div className="flex min-h-screen flex-col">
        <MobileNav role={role} persistent user={{ name, roleLabel }} />
        <main className="flex-1 p-4 pb-4 lg:p-8">{children}</main>
        {/* 圏外インジケーター（features.md §10 失敗#4） */}
        <ConnectionStatus />
      </div>
    </FieldLangProvider>
  )
}
