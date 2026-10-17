import { TableSkeleton, SkeletonBar } from '@/components/skeletons'

/** 受注一覧の読み込み中スケルトン（見出し + 操作 + フィルタカード + 一覧表）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4" role="status" aria-label="読み込み中">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SkeletonBar className="h-8 w-40" />
        <SkeletonBar className="h-10 w-32" />
      </div>
      <div className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBar key={i} className="h-10 w-40" />
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-line p-4">
        <TableSkeleton rows={6} />
      </div>
    </div>
  )
}
