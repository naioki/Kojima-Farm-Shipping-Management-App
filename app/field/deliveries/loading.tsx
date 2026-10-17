import { CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/** 配送（出発前ダブルチェック）の読み込み中スケルトン（見出し + 日付 + 配送カード列）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4" role="status" aria-label="読み込み中">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonBar className="h-8 w-36" />
        <SkeletonBar className="h-10 w-32" />
      </div>
      <CardListSkeleton count={4} />
    </div>
  )
}
