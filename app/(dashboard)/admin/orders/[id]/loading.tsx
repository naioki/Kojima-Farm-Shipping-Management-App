import { Card } from '@/components/ui/Card'

/** 受注詳細の読み込み中スケルトン。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="h-5 w-32 animate-pulse rounded bg-bg-soft" />
      <Card className="space-y-3">
        <div className="h-6 w-48 animate-pulse rounded bg-bg-soft" />
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-24 animate-pulse rounded bg-bg-soft" />
          ))}
        </div>
      </Card>
      <Card variant="elevated" className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-full animate-pulse rounded bg-bg-soft" />
        ))}
      </Card>
    </div>
  )
}
