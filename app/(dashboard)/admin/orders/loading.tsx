import { Card } from '@/components/ui/Card'

/** 受注一覧の読み込み中スケルトン（遷移直後に即表示してワンテンポ遅れを体感させない）。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="h-8 w-40 animate-pulse rounded bg-bg-soft" />
      <Card className="p-3">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-40 animate-pulse rounded bg-bg-soft" />
          ))}
        </div>
      </Card>
      <Card variant="elevated" className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-full animate-pulse rounded bg-bg-soft" />
        ))}
      </Card>
    </div>
  )
}
