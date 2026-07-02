/** ページ遷移中のスケルトン（白画面・無反応に見せない） */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4 p-2" aria-label="読み込み中" role="status">
      <div className="h-7 w-48 rounded-lg bg-line/60" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-line/40" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-line/30" />
    </div>
  )
}
