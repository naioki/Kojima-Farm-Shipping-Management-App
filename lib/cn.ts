import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind クラスの衝突を解決しつつ条件付き結合する（提供済みユーティリティ） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
