import { Gauge, Timer, AlertTriangle, Clock, FileX, TrendingDown, TrendingUp, Minus, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { requireAdmin } from '@/lib/auth/require-admin'
import { formatJpDateShort, jstTodayStr } from '@/lib/dates'
import { loadWeeklyMetrics } from '@/lib/metrics/load'
import { CHANNEL_KEYS, weekProgress, type ChannelKey, type WeekMetrics } from '@/lib/metrics/compute'
import { cn } from '@/lib/cn'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  fax: 'FAX',
  email: 'メール',
  portal: 'ポータル',
  phone: '電話',
  line: 'LINE',
  paper: '紙・口頭',
  other: 'その他',
  unknown: '不明',
}

function fmtMin(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)}分`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}時間${m}分` : `${h}時間`
}

/**
 * 今週と先週の比較。lowerIsBetter=true の指標（時間・ミス）は減ったら「良化」。
 * 色だけに頼らずアイコン＋文言で伝える（design.md アクセシビリティ）。
 */
function Trend({
  cur,
  prev,
  lowerIsBetter = true,
  fmt = (n: number) => `${n}件`,
}: {
  cur: number | null
  prev: number | null
  lowerIsBetter?: boolean
  fmt?: (n: number) => string
}) {
  if (cur == null || prev == null) return <span className="text-xs text-ink-soft">先週データなし</span>
  if (cur === prev)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
        <Minus className="h-3.5 w-3.5" aria-hidden />
        先週と同じ
      </span>
    )
  const better = lowerIsBetter ? cur < prev : cur > prev
  const Icon = cur < prev ? TrendingDown : TrendingUp
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', better ? 'text-harvest-700' : 'text-alert')}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {better ? '良化' : '悪化'}（先週 {fmt(prev)}）
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border border-line bg-bg-soft p-3">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="num text-2xl font-bold text-ink">{value}</p>
      {sub}
    </div>
  )
}

function WeekTable({ weeks, cols }: { weeks: WeekMetrics[]; cols: { label: string; get: (w: WeekMetrics) => string }[] }) {
  const rows = [...weeks].reverse()
  return (
    <div>
      {/* スマホでは表が右に続くことを、右端の影と文言で知らせる */}
      <p className="mb-1 text-right text-xs text-ink-faint sm:hidden" aria-hidden>
        横にスクロールできます →
      </p>
      <div className="relative">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-soft">
            <th className="py-2 pr-3 font-medium">週（月曜〜）</th>
            {cols.map((c, i) => (
              <th key={i} className="py-2 pr-3 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.week} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-3 text-ink">{formatJpDateShort(w.week)}</td>
              {cols.map((c, i) => (
                <td key={i} className="num py-1.5 pr-3 text-right tabular-nums text-ink">
                  {c.get(w)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
          </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg-card to-transparent sm:hidden" aria-hidden />
      </div>
    </div>
  )
}

/**
 * 評価指標ダッシュボード（オーナー定義の4指標）。
 * 1注文あたり処理時間・出荷/請求ミス件数・事務作業時間・紙の卒業 を週単位で追う。
 */
export default async function MetricsPage() {
  const guard = await requireAdmin('評価指標は管理者のみです。')
  if (guard) return guard

  let weeks: WeekMetrics[]
  try {
    weeks = await loadWeeklyMetrics(8)
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : '評価指標の集計に失敗しました'} />
  }
  const cur = weeks[weeks.length - 1]!
  const prev = weeks[weeks.length - 2] ?? null
  const mistakes = (w: WeekMetrics) => w.qtyCorrections + w.noteRevisions + w.invoiceVoids + w.deliveryIssues
  const paperish = (w: WeekMetrics) => w.channels.phone + w.channels.line + w.channels.paper
  // 今週は月曜〜今日までの途中集計。先週（まる1週）と比べるときは件数が少なめに出る
  const wp = weekProgress(cur.week, jstTodayStr())
  const weekInProgress = wp.inProgress
  const curRangeLabel = `${formatJpDateShort(cur.week)}〜${formatJpDateShort(wp.lastDay)}`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
          <Gauge className="h-6 w-6 text-earth-600" aria-hidden />
          評価指標
        </h1>
        <p className="text-sm text-ink-soft">
          今週（<span className="num">{curRangeLabel}</span>）と直近8週。処理時間・ミス・事務時間は少ないほど良い。
          受注経路・承認時刻・操作時間は 2026年11月の計測開始以降の分だけが正確です。
        </p>
        {weekInProgress && (
          <p className="text-sm font-medium text-warning">
            今週は途中（{wp.elapsedDays}日分）の集計です。先週はまる1週（7日分）なので、件数や操作時間は今週のほうが少なく出ます。
          </p>
        )}
      </header>

      {/* 1. 処理時間 */}
      <Card variant="elevated" className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Timer className="h-5 w-5 text-trust-600" aria-hidden />
          1注文あたりの処理時間（中央値）
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            label={`受信 → 承認（FAX・メール・ポータル／${cur.intakeToApproveN}件）`}
            value={fmtMin(cur.intakeToApproveMin)}
            sub={<Trend cur={cur.intakeToApproveMin} prev={prev?.intakeToApproveMin ?? null} fmt={fmtMin} />}
          />
          <Stat
            label={`承認 → 全明細出荷（${cur.approveToShipN}件）`}
            value={fmtMin(cur.approveToShipMin)}
            sub={<Trend cur={cur.approveToShipMin} prev={prev?.approveToShipMin ?? null} fmt={fmtMin} />}
          />
        </div>
        <WeekTable
          weeks={weeks}
          cols={[
            { label: '受信→承認', get: (w) => fmtMin(w.intakeToApproveMin) },
            { label: '件数(承認)', get: (w) => String(w.intakeToApproveN) },
            { label: '承認→出荷', get: (w) => fmtMin(w.approveToShipMin) },
            { label: '件数(出荷)', get: (w) => String(w.approveToShipN) },
          ]}
        />
      </Card>

      {/* 2. ミス件数 */}
      <Card variant="elevated" className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <AlertTriangle className="h-5 w-5 text-alert" aria-hidden />
          出荷・請求ミスの件数
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={weekInProgress ? '今週（途中）の合計' : '今週の合計'} value={`${mistakes(cur)}件`} sub={<Trend cur={mistakes(cur)} prev={prev ? mistakes(prev) : null} />} />
          <p className="text-xs text-ink-soft sm:self-center">
            数量の訂正（承認後の数量変更・追加FAXの上書き）、納品書の訂正版、請求書の無効化、配送の問題記録を数えます。
            訂正の中には「正しい変更」も含まれるため、増減の傾向で見てください。
          </p>
        </div>
        <WeekTable
          weeks={weeks}
          cols={[
            { label: '数量訂正', get: (w) => String(w.qtyCorrections) },
            { label: '納品書訂正', get: (w) => String(w.noteRevisions) },
            { label: '請求書無効', get: (w) => String(w.invoiceVoids) },
            { label: '配送の問題', get: (w) => String(w.deliveryIssues) },
          ]}
        />
      </Card>

      {/* 3. 事務作業時間 */}
      <Card variant="elevated" className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Clock className="h-5 w-5 text-earth-600" aria-hidden />
          事務作業の時間（アプリ操作時間からの推定）
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={weekInProgress ? '今週（途中）の管理画面の操作時間' : '今週の管理画面の操作時間'} value={fmtMin(cur.officeMin)} sub={<Trend cur={cur.officeMin} prev={prev?.officeMin ?? null} fmt={fmtMin} />} />
          <Stat label={weekInProgress ? '今週（途中）の現場画面の操作時間' : '今週の現場画面の操作時間'} value={fmtMin(cur.fieldMin)} />
        </div>
        <p className="text-xs text-ink-soft">
          画面を開いて実際に操作していた時間だけを数えます（1分以上操作がなければ数えない）。紙・電話にかかった時間は含みません。
        </p>
        <WeekTable
          weeks={weeks}
          cols={[
            { label: '管理画面', get: (w) => fmtMin(w.officeMin) },
            { label: '現場画面', get: (w) => fmtMin(w.fieldMin) },
            { label: '注文数', get: (w) => String(w.orders) },
            { label: '1注文あたり事務', get: (w) => (w.orders ? fmtMin(w.officeMin / w.orders) : '—') },
          ]}
        />
      </Card>

      {/* 4. 紙の卒業 */}
      <Card variant="elevated" className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <FileX className="h-5 w-5 text-harvest-700" aria-hidden />
          紙の卒業（今週）
        </h2>
        <p className="text-xs text-ink-soft">
          今週（<span className="num">{curRangeLabel}</span>）の件数{weekInProgress && '・途中集計'}。下の表は週ごとの受注経路です。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="今週: 電話・LINE・紙の注文をアプリに入力" value={`${paperish(cur)}件`} />
          <Stat label="今週: FAX注文をアプリで承認" value={`${cur.faxApprovedInApp}件`} />
          <Stat label="今週: 納品書をアプリで発行" value={`${cur.appDeliveryNotes}件`} />
          <Stat label="今週: 請求書をアプリで作成" value={`${cur.appInvoices}件`} />
        </div>
        <p className="text-xs text-ink-soft">
          これまで紙で行っていた4つの業務（電話メモ・FAX紙での出荷指示・出荷表/納品書の手書き・請求の手帳管理）が、アプリでどれだけ完結しているかの件数です。
          「不明」は受注経路を選ばずに手入力された注文です（新規注文入力・追加画面で経路を選ぶと減ります）。
        </p>
        <WeekTable
          weeks={weeks}
          cols={CHANNEL_KEYS.map((k) => ({ label: CHANNEL_LABEL[k], get: (w: WeekMetrics) => String(w.channels[k]) }))}
        />
      </Card>

      {/* 5. AI相談窓口の品質（世界の業務AIと同じく、評価と取り消し率で改善する） */}
      <Card variant="elevated" className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Sparkles className="h-5 w-5 text-earth-600" aria-hidden />
          AI相談窓口の品質
        </h2>
        <p className="text-xs text-ink-soft">
          👍・👎の数と、提案を実行した数・あとで取り消した数です。取り消しや👎が多い週は、答え方や提案に改善の余地があります。
        </p>
        <WeekTable
          weeks={weeks}
          cols={[
            { label: '👍', get: (w) => String(w.conciergeUp) },
            { label: '👎', get: (w) => String(w.conciergeDown) },
            { label: '実行', get: (w) => String(w.conciergeExecuted) },
            { label: '取り消し', get: (w) => String(w.conciergeUndone) },
            {
              label: '取り消し率',
              get: (w) => (w.conciergeExecuted ? `${Math.round((w.conciergeUndone / w.conciergeExecuted) * 100)}%` : '—'),
            },
          ]}
        />
      </Card>
    </div>
  )
}
