'use client'

import { forwardRef, useId, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, placeholder, required, className, id: idProp, ...props }, ref) => {
    const autoId = useId()
    const id = idProp ?? autoId
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

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
            defaultValue={placeholder ? '' : undefined}
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
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
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
