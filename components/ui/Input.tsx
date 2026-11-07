'use client'

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: ReactNode
  /** 外側のラッパー（ラベル＋入力欄）に付けるクラス。グリッドの列幅などはこちらへ。 */
  wrapperClassName?: string
}

/**
 * className のうち「親のグリッド/フレックスの中での置き方」を表すクラス（col-span-5・flex-1 など）。
 * input はラッパー div の中にあるため、これらは input ではなくラッパーに付けないと効かない
 * （col-span-5 が input に付き、ラッパーは1列幅のまま潰れていた不具合の再発防止）。
 */
const PLACEMENT_CLASS =
  /^(?:[a-z0-9]+:)*(?:col-span-|col-start-|col-end-|row-span-|row-start-|row-end-|order-|basis-|flex-1$|flex-auto$|flex-initial$|grow|shrink|self-|justify-self-)/

export function splitPlacementClasses(className?: string): { placement: string; rest: string } {
  const placement: string[] = []
  const rest: string[] = []
  for (const c of (className ?? '').split(/\s+/).filter(Boolean)) {
    ;(PLACEMENT_CLASS.test(c) ? placement : rest).push(c)
  }
  return { placement: placement.join(' '), rest: rest.join(' ') }
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, required, className, wrapperClassName, id: idProp, ...props }, ref) => {
    const autoId = useId()
    const { placement, rest } = splitPlacementClasses(className)
    const id = idProp ?? autoId
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

    return (
      <div className={cn('min-w-0 space-y-1.5', placement, wrapperClassName)}>
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
              rest,
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
