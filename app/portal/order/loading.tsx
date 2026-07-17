import { CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/** 取引先ポータル発注画面の読み込み中スケルトン（見出し + いつものセットのカード列）。 */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="読み込み中">
      <SkeletonBar className="h-8 w-56" />
      <CardListSkeleton count={4} />
    </div>
  )
}
