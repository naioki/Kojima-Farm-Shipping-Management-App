import { History } from 'lucide-react'
import type { RuleChange } from '@/lib/rules/format'

export interface RuleHistoryEntry {
  at: string
  productName: string
  who: string
  isNew: boolean
  changes: RuleChange[]
}

/**
 * 規格（取引ルール）の変更履歴。旧→新と、いつ・誰が変えたかを残す。
 * 「昔の規格を参照できないと困る」への対応（audit_log を表示・7年保存）。
 */
export function RulesHistory({ entries }: { entries: RuleHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-faint">まだ変更履歴はありません。</p>
  }
  return (
    <ul className="space-y-2">
      {entries.map((e, i) => (
        <li key={i} className="rounded border border-line px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <History className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
            <span className="font-medium text-ink">{e.productName}</span>
            <span className={e.isNew ? 'text-harvest-700' : 'text-trust-700'}>{e.isNew ? '新規登録' : '変更'}</span>
            <span className="num text-xs text-ink-faint">{new Date(e.at).toLocaleString('ja-JP')}</span>
            <span className="text-xs text-ink-faint">／ {e.who}</span>
          </div>
          {e.changes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {e.changes.map((c) => (
                <span key={c.field} className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs">
                  <span className="text-ink-soft">{c.label}</span>
                  <span className="num text-ink-faint">{c.before}</span>
                  <span className="text-ink-faint">→</span>
                  <span className="num font-medium text-ink">{c.after}</span>
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
