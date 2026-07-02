import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Settings } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { getMissingSpecs } from '@/lib/masters/missing-specs'

export const dynamic = 'force-dynamic'

/**
 * 規格未登録一覧（マスタ健全性・pull型）。集計は lib/masters/missing-specs に集約し、
 * ダッシュボードのアラート件数と表示を一致させる（同じ定義で数える）。
 *
 * 設計判断: 空でも常に警告は出さない。注文実績がある＝実際に使う組み合わせだけを対象にする。
 */
export default async function RulesMissingPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')
  const sb = createClient()
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="このページは管理者のみ利用できます。" />
  }

  const missing = await getMissingSpecs(createAdminClient())

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <AlertTriangle className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">規格の未登録一覧</h1>
          <p className="text-sm text-ink-soft">
            注文実績はあるのに<strong>入り数(P/C)・規格</strong>が未登録の商品です。設定しておくと、
            FAXのケース表記（例「15c2」）が自動で総数に展開され、出荷の荷姿も明確になります。
          </p>
        </div>
      </div>

      {missing.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3 py-6 text-sm text-ink-soft">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-harvest-600" aria-hidden />
            注文実績のある取引先×商品はすべて規格が登録済みです。
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">取引先</th>
                  <th className="px-3 py-2 text-left font-medium">商品</th>
                  <th className="px-3 py-2 text-left font-medium">未登録</th>
                  <th className="px-3 py-2 text-right font-medium">注文数</th>
                  <th className="px-3 py-2 text-right font-medium">設定</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {missing.map((m) => (
                  <tr key={`${m.customerId}:${m.productName}`}>
                    <td className="px-3 py-2 font-medium text-ink">{m.customerName}</td>
                    <td className="px-3 py-2 text-ink">{m.productName}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {m.missingPacks && (
                          <span className="rounded-full bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
                            入り数
                          </span>
                        )}
                        {m.missingSpec && (
                          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                            規格
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num px-3 py-2 text-right tabular-nums text-ink-soft">{m.count}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/customers/${m.customerId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
                      >
                        <Settings className="h-3 w-3" aria-hidden />
                        設定する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
