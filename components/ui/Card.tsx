import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'glass' | 'elevated'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  interactive?: boolean
}

const variants: Record<Variant, string> = {
  default: 'bg-bg-card border border-line shadow-sm',
  glass: 'bg-bg-card/70 backdrop-blur-md border border-line/60 shadow-sm',
  elevated: 'bg-bg-card border border-line shadow-md',
}

/** Server Component 互換（'use client' なし）。interactive 時のみ hover モーション */
export function Card({ variant = 'default', interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg p-6 transition-all duration-300 ease-organic',
        variants[variant],
        interactive && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg',
        className,
      )}
      {...props}
    />
  )
}

/** ローディング骨格。layout shift 防止のため実コンテンツと同寸で使う */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-breathe rounded bg-line', className)}
      {...props}
    />
  )
}
