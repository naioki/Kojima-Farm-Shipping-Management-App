'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/** 印刷（ブラウザの印刷ダイアログ→PDF保存も可）。印刷時はサイドバー等を print:hidden で隠す。 */
export function PrintButton({ label = '印刷 / PDF' }: { label?: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  )
}
