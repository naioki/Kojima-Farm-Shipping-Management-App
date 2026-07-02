/** 現場画面のスケルトン（スマホ・電波が弱い環境でも無反応に見せない） */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-label="読み込み中" role="status">
      <div className="h-6 w-36 rounded-lg bg-line/60" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-20 rounded-xl bg-line/40" />
      ))}
    </div>
  )
}
