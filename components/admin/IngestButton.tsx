'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'

/**
 * 「FAXを取り込む」手動ボタン。専用メールボックスを1回スキャンして取込む（pollEmailOnce）。
 * Cloud Scheduler 未有効でも当面これで運用できる。何度押しても重複取込みしない
 * （Message-ID / exact_hash 判定）。
 */
export function IngestButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ingest-email', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ? `取込失敗: ${j.error}` : '取込に失敗しました')
        return
      }
      if (j.processed === 0) {
        toast('新しいFAX（メール）はありませんでした')
      } else {
        toast.success(`${j.processed}件を取り込み（解析${j.analyzed}件）`)
      }
      router.refresh()
    } catch {
      toast.error('取込に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="secondary" onClick={run} isLoading={loading} disabled={loading}>
      <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
      FAXを取り込む
    </Button>
  )
}
