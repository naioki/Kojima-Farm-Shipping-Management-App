import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Settings } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { getMissingSpecs } from '@/lib/masters/missing-specs'
import { requireAdmin } from '@/lib/auth/require-admin'
import { ErrorState } from '@/components/ui/States'
import type { MissingSpec } from '@/lib/masters/missing-specs'

export const dynamic = 'force-dynamic'

function missingBadges(m: { missingPacks: boolean; missingSpec: boolean }) {
  return (
    <>
      {m.missingPacks && (
        <span className="rounded-full bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">入数</span>
      )}
      {m.missingSpec && (
        <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">規格</span>
      )}
    </>
  )
}

/**
 * 規格未登録一覧（マスタ健全性・pull型）。集計は lib/masters/missing-specs に集約し、
 * ダッシュボードのアラート件数と表示を一致させる（同じ定義で数える）。
 *
 * 設計判断: 空でも常に警告は出さない。注文実績がある＝実際に使う組み合わせだけを対象にする。
 */
export default async function RulesMissingPage() {
  const guard = await requireAdmin('このページは管理者のみ利用できます。')
  if (guard) return guard

  let missing: MissingSpec[]
  try {
    missing = await getMissingSpecs(createAdminClient())
  } catch (e) {
    return (
      <ErrorState
        message="規格未登録の一覧を読み込めませんでした。時間をおいて再度お試しください。"
        detail={e instanceof Error ? e.message : String(e)}
      />
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <AlertTriangle className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">規格の未登録</h1>
          <p className="text-sm text-ink-soft">
            注文実績はあるのに<strong>入数・規格</strong>が未登録の品目です。取引先ごとの設定か「単価・荷姿の設定」の荷姿のどちらかがあれば、登録済みとして数えます。設定しておくと、
            FAXのケース表記（例「15c2」）が自動で総数に展開され、出荷の荷姿も明確になります。
          </p>
        </div>
      </div>

      {missing.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3 py-6 text-sm text-ink-soft">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-harvest-600" aria-hidden />
            注文実績のある取引先×品目は、すべて規格・荷姿が登録済みです。
          </div>
        </Card>
      ) : (
        <>
          {/* スマホ: カード型 */}
          <ul className="space-y-2 md:hidden">
            {missing.map((m) => (
              <li key={`${m.customerId}:${m.productName}`} className="rounded-xl border border-line bg-bg-card p-3">
                <p className="break-words text-base font-bold text-ink">{m.productName}</p>
                <p className="break-words text-sm text-ink-soft">{m.customerName}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {missingBadges(m)}
                  <span className="text-xs text-ink-soft">
                    注文 <span className="num tabular-nums">{m.count}</span>件
                  </span>
                </div>
                <Link
                  href={`/admin/customers/${m.customerId}`}
                  className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-trust-700 hover:underline"
                >
                  <Settings className="h-4 w-4" aria-hidden />
                  設定する
                </Link>
              </li>
            ))}
          </ul>

          {/* PC: 表 */}
          <Card className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">取引先</th>
                  <th className="px-3 py-2 text-left font-medium">品目</th>
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
                      <span className="flex flex-wrap gap-1">{missingBadges(m)}</span>
                    </td>
                    <td className="num px-3 py-2 text-right tabular-nums text-ink-soft">{m.count}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/customers/${m.customerId}`}
                        className="inline-flex min-h-10 items-center gap-1 whitespace-nowrap text-sm font-medium text-trust-700 hover:underline"
                      >
                        <Settings className="h-4 w-4" aria-hidden />
                        設定する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
