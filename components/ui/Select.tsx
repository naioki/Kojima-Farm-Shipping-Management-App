'use client'

import { forwardRef, useId, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
  /** 指定すると同じ group 名の選択肢を <optgroup> でまとめる（表示グルーピング）。 */
  group?: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

/**
 * group を持つ選択肢は <optgroup> でまとめる。group 無しはそのまま平置き（後方互換）。
 * 出現順を保ちつつ、同一 group を最初の出現位置にまとめる。未分類は末尾の「その他」へ。
 */
function renderOptions(options: SelectOption[]) {
  const hasGroups = options.some((o) => o.group)
  if (!hasGroups) {
    return options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))
  }
  const groupOrder: string[] = []
  const byGroup = new Map<string, SelectOption[]>()
  const UNGROUPED = 'その他'
  for (const o of options) {
    const g = o.group || UNGROUPED
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      if (g !== UNGROUPED) groupOrder.push(g)
    }
    byGroup.get(g)!.push(o)
  }
  if (byGroup.has(UNGROUPED)) groupOrder.push(UNGROUPED) // 未分類は常に最後
  return groupOrder.map((g) => (
    <optgroup key={g} label={g}>
      {byGroup.get(g)!.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </optgroup>
  ))
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, placeholder, required, className, id: idProp, ...props }, ref) => {
    const autoId = useId()
    const id = idProp ?? autoId
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
    // value（制御）と defaultValue（非制御）の同時指定は React 警告になる。
    // 制御時は defaultValue を付けず、非制御＋placeholder のときだけ空選択を既定にする。
    const isControlled = props.value !== undefined
    const defaultValue = !isControlled && placeholder ? '' : undefined

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-ink">
            {label}
            {required && (
              <span className="ml-0.5 text-alert" aria-label="必須">
                *
              </span>
            )}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            defaultValue={defaultValue}
            className={cn(
              'h-10 w-full appearance-none rounded border bg-bg-card pl-3.5 pr-10 text-sm text-ink',
              'transition-[border-color,box-shadow] duration-150',
              'border-line-strong hover:border-earth-400',
              'focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100',
              error && 'border-alert focus:border-alert focus:ring-alert/15',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {renderOptions(options)}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm font-medium text-alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-sm text-ink-soft">
            {hint}
          </p>
        ) : null}
      </div>
    )
  },
)
Select.displayName = 'Select'
