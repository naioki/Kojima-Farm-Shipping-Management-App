import { CardListSkeleton, SkeletonBar } from '@/components/skeletons'

/**
 * 出荷一覧の読み込み中スケルトン。現場が毎日使うメイン画面。
 * 見出し + 日付ナビ / のこり件数バー / ステータスサマリー / スマート追加 / 品目カード列。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4" role="status" aria-label="読み込み中">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonBar className="h-8 w-36" />
        <SkeletonBar className="h-10 w-32" />
      </div>
      <SkeletonBar className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBar key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <SkeletonBar className="h-12 w-full rounded-xl" />
      <CardListSkeleton count={3} />
    </div>
  )
}
