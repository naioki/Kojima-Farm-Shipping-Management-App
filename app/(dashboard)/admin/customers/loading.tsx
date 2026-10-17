import { CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/** 取引先設定の読み込み中スケルトン（見出し + 追加カード + 取引先カード列）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-40" />
      <SkeletonBar className="h-24 w-full rounded-xl" />
      <CardListSkeleton count={5} />
    </div>
  )
}
