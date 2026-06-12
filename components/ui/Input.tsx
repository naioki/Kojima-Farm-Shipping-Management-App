'use client'

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, required, className, id: idProp, ...props }, ref) => {
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
          {icon && (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-faint">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              'h-10 w-full rounded border bg-bg-card px-3.5 text-sm text-ink',
              'placeholder:text-ink-faint',
              'transition-[border-color,box-shadow] duration-150',
              'border-line-strong hover:border-earth-400',
              'focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100',
              error && 'border-alert focus:border-alert focus:ring-alert/15',
              icon && 'pl-10',
              className,
            )}
            {...props}
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
Input.displayName = 'Input'
