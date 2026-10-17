import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <SearchX className="h-10 w-10 text-ink-faint" aria-hidden />
        <h2 className="font-display text-xl font-bold text-ink">ページが見つかりません</h2>
        <p className="text-sm text-ink-soft">
          URLが間違っているか、ページが移動した可能性があります。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-earth-500 px-4 py-2 text-sm font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2"
        >
          ホームへ戻る
        </Link>
      </div>
    </div>
  )
}
