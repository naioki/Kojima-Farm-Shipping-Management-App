import { CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/** 請求一覧の読み込み中スケルトン（見出し + 生成カード + 請求書カード列）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-28" />
      <SkeletonBar className="h-28 w-full rounded-xl" />
      <CardListSkeleton count={5} />
    </div>
  )
}
