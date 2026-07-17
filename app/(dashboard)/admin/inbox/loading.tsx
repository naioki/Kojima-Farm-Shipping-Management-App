import { ChipRowSkeleton, CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/** 受注ボックスの読み込み中スケルトン（見出し + フィルタチップ列 + 受信/承認待ちカード列）。 */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-40" />
      <ChipRowSkeleton count={5} />
      <CardListSkeleton count={4} />
    </div>
  )
}
