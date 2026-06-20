import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'

export type ActionTone = 'earth' | 'harvest' | 'trust' | 'forest'

export interface QuickAction {
  href: string
  label: string
  icon: LucideIcon
  tone: ActionTone
}

const toneCls: Record<ActionTone, string> = {
  earth: 'bg-earth-100 text-earth-700',
  harvest: 'bg-harvest-100 text-harvest-700',
  trust: 'bg-trust-100 text-trust-600',
  forest: 'bg-forest-100 text-forest-700',
}

/** よく使う操作（アイコンタイルのグリッド）。 */
export function QuickActionsGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <Card variant="elevated" className="h-full">
      <h2 className="mb-3 text-sm font-semibold text-ink">よく使う操作</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {actions.map(({ href, label, icon: Icon, tone }) => (
          <Link
            key={href + label}
            href={href}
            className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <span
              className={`inline-flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:-translate-y-0.5 ${toneCls[tone]}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-xs font-medium leading-tight text-ink-soft">{label}</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}
