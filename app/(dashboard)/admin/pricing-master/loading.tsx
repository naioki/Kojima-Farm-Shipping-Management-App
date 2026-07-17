import { TableSkeleton, SkeletonBar } from '@/components/skeletons'

/** 単価・荷姿マスタの読み込み中スケルトン（見出し + 2つの設定カード）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-48" />
      <div className="space-y-2">
        <SkeletonBar className="h-5 w-32" />
        <TableSkeleton rows={4} />
      </div>
      <div className="space-y-2">
        <SkeletonBar className="h-5 w-32" />
        <TableSkeleton rows={4} />
      </div>
    </div>
  )
}
