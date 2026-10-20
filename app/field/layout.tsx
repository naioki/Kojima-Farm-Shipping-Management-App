import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { MobileNav } from '@/components/layouts/MobileNav'
import { FieldBottomBar, type FieldAction } from '@/components/field/FieldBottomBar'
import { ConnectionStatus } from '@/components/field/ConnectionStatus'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/**
 * 現場（スタッフ・作業者）サーフェスの外枠。
 * - MobileNav は persistent（lg 以上でもハンバーガーを残す：タブレット/PC で全画面作業）。
 * - FieldBottomBar（画面最下部固定の3ボタン、design.md）。
 * - 現場向け権限チェック: 未ログインは /login へ。admin は全機能パス、staff は解放済み機能のみ。
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

  // 解放済み機能を「その他」ドロワーに並べる（admin は常に全許可）。
  const features = await getStaffFeatures()
  const actions: FieldAction[] = [
    { key: 'delivery', label: '配送リスト', href: '/field/deliveries', icon: 'delivery' },
    { key: 'matrix', label: '週間マトリックス', href: '/field/matrix', icon: 'matrix' },
  ]
  if (canStaffUse('ocr', role, features)) {
    actions.push({ key: 'ocr', label: '注文を 読む', href: '/field/ocr', icon: 'ocr' })
  }
  if (canStaffUse('reportSpec', role, features)) {
    actions.push({ key: 'report', label: '規格を ほうこく', href: '/field/report-spec', icon: 'report' })
  }
  if (canStaffUse('approve', role, features)) {
    actions.push({ key: 'approve', label: '承認', href: '/field/approvals', icon: 'approve' })
  }
  if (canStaffUse('printDocs', role, features)) {
    actions.push({ key: 'print', label: '帳票を 印刷', href: '/field/print', icon: 'report' })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MobileNav role={role} persistent user={{ name, roleLabel }} />
      <main className="flex-1 p-4 pb-0 lg:p-8">{children}</main>
      {/* 圏外インジケーター（features.md §10 失敗#4）。下部バーの真上に固定表示する。 */}
      <ConnectionStatus />
      <FieldBottomBar actions={actions} />
    </div>
  )
}
