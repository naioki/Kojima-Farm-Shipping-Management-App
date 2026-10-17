/** AI 確信度のバー表示（0..1）。<0.7 は要確認色（赤）、それ以上は緑。色だけに頼らず数値併記。 */
export function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs text-ink-faint">確信度 —</span>
  }
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  const low = value < 0.7
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-soft">
        <div
          className={`h-full rounded-full ${low ? 'bg-alert' : 'bg-harvest-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`num text-xs font-medium ${low ? 'text-alert' : 'text-harvest-600'}`}>
        確信度 {pct}%{low ? '（要確認）' : ''}
      </span>
    </div>
  )
}
