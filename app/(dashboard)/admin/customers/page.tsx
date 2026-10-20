import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { AddCustomerForm } from '@/components/admin/AddCustomerForm'
import { ColorDot } from '@/components/ui/ColorDot'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 取引先設定 一覧（Laravel版 画面5）。
 * 取引先を一覧し、各取引先のP/C・荷姿・「いつものセット」編集（詳細画面）へ導線。
 */
export default async function CustomersPage() {
  const guard = await requireAdmin('取引先設定は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, name_kana, payment_terms, is_active, display_color')
    .order('name')
  if (error) return <ErrorState message="取引先を読み込めませんでした。時間をおいて再度お試しください。" detail={error.message} />

  const activeCustomers = (customers ?? []).filter((c) => c.is_active)
  const inactiveCustomers = (customers ?? []).filter((c) => !c.is_active)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">取引先設定</h1>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">取引先を追加</h2>
        <AddCustomerForm />
      </Card>

      {!customers?.length ? (
        <EmptyState title="取引先がありません" description="上のフォームから追加してください。" />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              利用中の取引先 ({activeCustomers.length}件)
            </h2>
            {activeCustomers.map((c) => (
              <Link key={c.id} href={`/admin/customers/${c.id}`}>
                <Card variant="elevated" interactive className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <ColorDot color={c.display_color} name={c.name} size="md" />
                    <div>
                      <p className="font-medium text-ink">{c.name}</p>
                      {c.name_kana && <p className="text-xs text-ink-faint">{c.name_kana}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-ink-soft">
                    {c.payment_terms && <span>{c.payment_terms}</span>}
                    <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {inactiveCustomers.length > 0 && (
            <details className="group rounded-xl border border-line bg-bg-soft/40 p-3">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-ink-soft">
                <span>停止中・非表示の取引先 ({inactiveCustomers.length}件)</span>
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90 text-ink-faint" />
              </summary>
              <div className="mt-3 space-y-2">
                {inactiveCustomers.map((c) => (
                  <Link key={c.id} href={`/admin/customers/${c.id}`}>
                    <Card variant="elevated" interactive className="flex items-center justify-between opacity-75">
                      <div className="flex items-center gap-2.5">
                        <ColorDot color={c.display_color} name={c.name} size="md" />
                        <div>
                          <p className="font-medium text-ink-soft line-through">
                            {c.name}
                            <span className="ml-2 text-xs text-ink-faint">（停止中）</span>
                          </p>
                          {c.name_kana && <p className="text-xs text-ink-faint">{c.name_kana}</p>}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                    </Card>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
