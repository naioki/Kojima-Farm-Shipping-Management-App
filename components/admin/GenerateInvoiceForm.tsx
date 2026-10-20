'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePlus2, CheckCheck, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatYen } from '@/lib/calculations/tax'
import { jstDateStr as iso } from '@/lib/dates'

interface Candidate {
  customerId: string
  customerName: string
  itemCount: number
  estimatedTotal: number
}

const firstOfMonth = (d = new Date()) => {
  return iso(new Date(d.getFullYear(), d.getMonth(), 1))
}

const lastOfMonth = (d = new Date()) => {
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

const prevMonthFirst = () => {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth() - 1, 1))
}

const prevMonthLast = () => {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth(), 0))
}

const ERR: Record<string, string> = {
  no_billable_items: '対象期間に請求できる明細（承認/出荷済み）がありません。',
}

/**
 * 請求書作成フォーム（期間先行選択・実績取引先自動抽出）。
 * 期間をまず設定すると、その期間に出荷実績のある取引先のみが自動抽出される。
 */
export function GenerateInvoiceForm() {
  const router = useRouter()
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(iso(new Date()))
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  // 期間が変わるたびに候補を再取得（250ms デバウンス付き）
  useEffect(() => {
    if (!from || !to) {
      setCandidates([])
      setCandidateError(null)
      return
    }
    if (from > to) {
      setCandidates([])
      setCandidateError('開始日は終了日以前の日付を指定してください。')
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setLoadingCandidates(true)
      setCandidateError(null)

      fetch(`/api/invoices/candidates?from=${from}&to=${to}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('取得失敗'))))
        .then((data: { candidates?: Candidate[] }) => {
          if (!cancelled) {
            const list = data.candidates ?? []
            setCandidates(list)
            const firstCandidate = list[0]
            if (firstCandidate && !list.some((c) => c.customerId === selectedCustomerId)) {
              setSelectedCustomerId(firstCandidate.customerId)
            } else if (list.length === 0) {
              setSelectedCustomerId('')
            }
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCandidates([])
            setCandidateError('取引先候補の取得に失敗しました。通信状況を確認してください。')
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingCandidates(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [from, to, retryCount])

  async function submitSingle(targetId?: string) {
    const custId = targetId || selectedCustomerId
    if (!custId) {
      toast.error('取引先を選択してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_id: custId, period_start: from, period_end: to }),
      })
      const j = (await res.json().catch(() => ({}))) as { invoice_id?: string; error?: string }
      if (!res.ok) throw new Error(ERR[j.error ?? ''] ?? j.error ?? `作成に失敗 (${res.status})`)
      toast.success('請求書を作成しました')
      if (j.invoice_id) router.push(`/admin/invoices/${j.invoice_id}`)
      else router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitBulk() {
    if (candidates.length === 0) {
      toast.error('対象となる取引先がありません')
      return
    }
    if (!window.confirm(`対象の ${candidates.length} 社の請求書を一括作成しますか？`)) {
      return
    }
    setBulkSubmitting(true)
    try {
      const res = await fetch('/api/invoices/generate-bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ period_start: from, period_end: to }),
      })
      const j = (await res.json().catch(() => ({}))) as { created?: unknown[]; skipped?: unknown[]; error?: string }
      if (!res.ok) throw new Error(j.error ?? `一括作成に失敗 (${res.status})`)
      const createdCount = Array.isArray(j.created) ? j.created.length : 0
      toast.success(`${createdCount}件の請求書を作成しました`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括作成に失敗しました')
    } finally {
      setBulkSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 期間選択バー */}
      <div className="rounded-xl border border-line bg-bg-soft/40 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
            ① まず対象期間を選択
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFrom(firstOfMonth())
                setTo(iso(new Date()))
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-bold text-ink hover:bg-bg-soft"
            >
              今月（本日まで）
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom(firstOfMonth())
                setTo(lastOfMonth())
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-bold text-ink hover:bg-bg-soft"
            >
              今月全体
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom(prevMonthFirst())
                setTo(prevMonthLast())
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-bold text-ink hover:bg-bg-soft"
            >
              先月全体
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="開始日" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="終了日" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* エラー表示 */}
      {candidateError && (
        <div className="flex items-center justify-between rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-bold text-red-900 shadow-xs">
          <span>⚠️ {candidateError}</span>
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-900 hover:bg-red-50 transition-colors"
          >
            再試行
          </button>
        </div>
      )}

            {/* 対象取引先の自動抽出結果 */}
      <div className="rounded-xl border border-line bg-bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">
              ② 対象取引先 ({candidates.length}社)
            </span>
            {loadingCandidates && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
          </div>

          {candidates.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={submitBulk}
              isLoading={bulkSubmitting}
              className="text-xs font-bold"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              全{candidates.length}社を一括作成
            </Button>
          )}
        </div>

        {loadingCandidates ? (
          <p className="text-sm text-ink-soft py-2 text-center">出荷実績を集計中...</p>
        ) : candidates.length === 0 ? (
          <div className="rounded-lg bg-bg-soft/60 p-3 text-center text-sm text-ink-muted">
            指定された期間（{from} 〜 {to}）に出荷実績のある取引先はありません。期間を変更してください。
          </div>
        ) : (
          <div className="divide-y divide-line/60 rounded-xl border border-line bg-white overflow-hidden shadow-xs">
            {candidates.map((c) => (
              <div
                key={c.customerId}
                className="flex items-center justify-between gap-3 p-3 hover:bg-bg-soft/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm text-ink truncate">{c.customerName}</p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    出荷明細: <span className="font-semibold text-ink">{c.itemCount}件</span>・概算:{' '}
                    <span className="num font-semibold text-ink">{formatYen(c.estimatedTotal)}</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => submitSingle(c.customerId)}
                  isLoading={submitting && selectedCustomerId === c.customerId}
                  className="shrink-0"
                >
                  <FilePlus2 className="h-3.5 w-3.5 mr-1" />
                  請求書を作成
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
