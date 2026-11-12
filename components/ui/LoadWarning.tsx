/**
 * 一部のデータが読めなかったことを知らせる帯（未承認件数の通知バーと同じ見た目）。
 * 画面全体は出したまま、何が読めず何に影響するかを知らせる。技術的な詳細は「詳細を表示」に折りたたむ。
 * 画面全体が成り立たないときは ErrorState を使う。
 */
export function LoadWarning({ message, detail }: { message: string; detail?: string | null }) {
  return (
    <div role="alert" className="rounded-xl border border-warning bg-warning-bg/90 px-3.5 py-2 text-xs font-bold text-ink print:hidden">
      <p>⚠️ {message}</p>
      {detail && (
        <details className="mt-1 font-normal text-ink-faint">
          <summary className="cursor-pointer select-none text-ink-soft hover:text-ink">詳細を表示</summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono">{detail}</p>
        </details>
      )}
    </div>
  )
}
