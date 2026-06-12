'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
}

const variants: Record<Variant, string> = {
  primary: cn(
    'bg-earth-600 text-white shadow-sm',
    'hover:bg-earth-700 hover:shadow-md hover:-translate-y-px',
    'active:translate-y-0 active:shadow-sm',
    'focus-visible:ring-earth-500',
  ),
  secondary: cn(
    'bg-bg-card text-earth-700 border border-line-strong',
    'hover:bg-earth-50 hover:border-earth-400',
    'focus-visible:ring-earth-400',
  ),
  tertiary: cn('text-earth-700 hover:bg-earth-50', 'focus-visible:ring-earth-400'),
  danger: cn(
    'bg-alert text-white shadow-sm',
    'hover:brightness-110 hover:shadow-md',
    'focus-visible:ring-alert',
  ),
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2', // スマホの親指タップに十分な 48px
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', isLoading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded font-medium select-none',
        'transition-all duration-150 ease-organic',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
