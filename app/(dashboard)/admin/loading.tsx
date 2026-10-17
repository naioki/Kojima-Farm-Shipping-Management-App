import { KpiRowSkeleton, SkeletonBar } from '@/components/skeletons'

/** 経営ダッシュボードの読み込み中スケルトン（見出し + ステータスカード + KPI/チャート）。 */
export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-7 w-40" />
      <KpiRowSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonBar className="h-72 rounded-xl lg:col-span-2" />
        <SkeletonBar className="h-72 rounded-xl lg:col-span-1" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonBar className="h-56 rounded-xl lg:col-span-2" />
        <SkeletonBar className="h-56 rounded-xl lg:col-span-1" />
      </div>
    </div>
  )
}
