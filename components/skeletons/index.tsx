import { cn } from '@/lib/cn'

/**
 * 全ルート共通の読み込みスケルトン部品。
 *
 * 目的：Cloud Run の min-instances=0 によるコールドスタートで初回遷移に数秒かかっても、
 * 白画面（=「固まった」誤認）を出さず、実画面と同じ形の骨組みを即表示して体感待ち時間を減らす。
 *
 * 設計方針：
 *  - 各部品は自分の root に `animate-pulse motion-reduce:animate-none` を持ち単体で動く。
 *    loading.tsx 側で二重に animate-pulse を掛けない（入れ子の明滅を避ける）。
 *  - 色は必ずトークン（bg-line）。ハードコード色は禁止（design.md）。
 *  - スケルトンは装飾なので aria-hidden。読み込み中の告知は各 loading.tsx の
 *    root（role="status" aria-label="読み込み中"）が担う。
 */

const PULSE = 'animate-pulse motion-reduce:animate-none'

/** スケルトンの最小単位。高さ・幅は className で指定する。 */
export function SkeletonBar({ className }: { className?: string }) {
  return <div className={cn(PULSE, 'rounded-lg bg-line/50', className)} aria-hidden />
}

/** カードを縦に n 件並べたプレースホルダ（一覧・ボックス系の汎用）。 */
export function CardListSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(PULSE, 'space-y-3', className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl border border-line bg-line/25" />
      ))}
    </div>
  )
}

/** テーブル（ヘッダ + 行）のプレースホルダ。 */
export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(PULSE, 'space-y-2', className)} aria-hidden>
      <div className="h-9 w-full rounded-lg bg-line/50" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 w-full rounded-lg bg-line/25" />
      ))}
    </div>
  )
}

/** KPI カードを横に並べたプレースホルダ（経営ダッシュボード上部）。 */
export function KpiRowSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(PULSE, 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-28 rounded-xl border border-line bg-line/25" />
      ))}
    </div>
  )
}

/** フィルタチップ／タブ列のプレースホルダ（受注ボックス・出荷一覧・マトリックス上部）。 */
export function ChipRowSkeleton({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(PULSE, 'flex flex-wrap gap-2', className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-9 w-24 rounded-full bg-line/40" />
      ))}
    </div>
  )
}

/**
 * 汎用ページスケルトン（見出し + カード列）。
 * 個別に形を模さない残りルートの loading.tsx はこれ1つで足りる。
 */
export function GenericPageSkeleton({
  cards = 5,
  className,
}: {
  cards?: number
  className?: string
}) {
  return (
    <div className={cn('mx-auto max-w-3xl space-y-4', className)} role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-48" />
      <CardListSkeleton count={cards} />
    </div>
  )
}
