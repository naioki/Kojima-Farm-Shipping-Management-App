import { ChipRowSkeleton, TableSkeleton, SkeletonBar } from '@/components/skeletons'

/** 週間マトリックスの読み込み中スケルトン（見出し + 週送り + 品目タブ + マトリックス表）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" role="status" aria-label="読み込み中">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonBar className="h-8 w-44" />
        <SkeletonBar className="h-10 w-56" />
      </div>
      <ChipRowSkeleton count={6} />
      <div className="rounded-lg border border-line p-4">
        <TableSkeleton rows={6} />
      </div>
    </div>
  )
}
