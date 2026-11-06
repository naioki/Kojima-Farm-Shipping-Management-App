import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Sidebar } from '@/components/layouts/Sidebar'
import { MobileNav } from '@/components/layouts/MobileNav'
import { ConnectionStatus } from '@/components/field/ConnectionStatus'
import { FieldLangProvider } from '@/lib/field/lang-context'
import { getNavBadges } from '@/lib/nav/badges'
import { OpsTracker } from '@/components/layouts/OpsTracker'
import { getStaffFeatures } from '@/lib/field/features'

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

  const supabase = createAdminClient()
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()
  // ロール解決に失敗したら fail closed（社内データを見せない）。無言にはしない。
  if (profileErr) {
    console.error('[field/layout] ロールの取得に失敗:', profileErr.message)
    throw new Error('ユーザー権限の確認に失敗しました。時間をおいて再読み込みしてください。')
  }
  // 社員名簿（public.users）に行が無い＝取引先ポータルのユーザー等。現場画面は見せない。
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    const isPortal = Boolean((user.app_metadata as { customer_id?: string } | undefined)?.customer_id)
    redirect(isPortal ? '/portal/order' : '/login')
  }
  const role = profile.role as 'admin' | 'staff'
  // 設定「現場スタッフに任せること」でオフの機能は、スタッフのメニューに出さない（管理者は全部出す）
  const hiddenHrefs: string[] = []
  if (role === 'staff') {
    const f = await getStaffFeatures()
    if (!f.approve) hiddenHrefs.push('/field/approvals')
    if (!f.printDocs) hiddenHrefs.push('/field/print')
    if (!f.reportSpec) hiddenHrefs.push('/field/report-spec')
  }
  // 経営者欄には個人の名前を出さず、農園名「小島農園」を表示する
  const name = role === 'admin' ? '小島農園' : (profile?.full_name?.trim() || user.email?.split('@')[0] || 'スタッフ')
  const roleLabel = role === 'admin' ? '経営者' : '現場スタッフ'
  const badges = await getNavBadges(role)

  return (
    <FieldLangProvider>
      <div className="flex min-h-screen">
        {/* 管理者はPC幅で管理画面と同じ左サイドバー。スタッフは従来どおりハンバーガーのみ */}
        {role === 'admin' && <Sidebar role={role} user={{ name, roleLabel }} badges={badges} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav
            role={role}
            persistent={role === 'staff'}
            user={{ name, roleLabel }}
            hiddenHrefs={hiddenHrefs}
            badges={badges}
          />
          <main className="flex-1 px-2.5 py-2 sm:p-4 lg:p-8">{children}</main>
          <OpsTracker />
          {/* 圏外インジケーター（features.md §10 失敗#4） */}
          <ConnectionStatus />
        </div>
      </div>
    </FieldLangProvider>
  )
}
