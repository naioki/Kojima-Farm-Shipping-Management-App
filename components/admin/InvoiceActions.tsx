'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileDown, Table, Trash2, Send, Wallet, Undo2, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import type { InvoiceStatus } from '@/types/database'

const linkCls =
  'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-ink hover:bg-earth-50'
const dangerCls =
  'inline-flex min-h-10 items-center gap-1 whitespace-nowrap rounded border border-alert/30 bg-alert-bg px-3 text-sm font-semibold text-alert hover:opacity-90 disabled:opacity-50 transition'

/**
 * 請求書の操作（PDF・CSV・状態変更・削除）。印刷時は print:hidden で隠す。
 * 主ボタン＝その状態での「次の一手」（下書き→確定、確定→送付済、送付済→入金済）。
 * スマホでは主ボタンを全幅にし、ほかの操作は折り返して並べる。
 * 押したボタンだけスピナーを出す（処理中の操作を共有しない）。
 */
export function InvoiceActions({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const router = useRouter()
  const [pending, setPending] = useState<InvoiceStatus | 'delete' | null>(null)
  const busy = pending !== null

  async function setStatus(next: InvoiceStatus, done: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setPending(next)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `更新に失敗しました (${res.status})`)
      }
      toast.success(done)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setPending(null)
    }
  }

  async function handleDelete() {
    if (!window.confirm('この請求書を削除しますか？\n（削除すると関連する請求明細も削除されます）')) return
    setPending('delete')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗しました (${res.status})`)
      }
      toast.success('請求書を削除しました')
      router.push('/admin/invoices')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      setPending(null)
    }
  }

  // 主ボタン（次の一手）
  let primary: ReactNode = null
  if (status === 'draft') {
    primary = (
      <Button
        onClick={() => setStatus('finalized', '請求書を確定しました', 'この請求書を確定しますか？\n（確定後は削除できず、無効にするだけになります）')}
        isLoading={pending === 'finalized'}
        disabled={busy}
        className="w-full sm:w-auto"
      >
        {pending !== 'finalized' && <CheckCircle2 className="h-4 w-4" aria-hidden />}
        確定する
      </Button>
    )
  } else if (status === 'finalized') {
    primary = (
      <Button
        onClick={() => setStatus('sent', '送付済にしました')}
        isLoading={pending === 'sent'}
        disabled={busy}
        className="w-full sm:w-auto"
      >
        {pending !== 'sent' && <Send className="h-4 w-4" aria-hidden />}
        送付済にする
      </Button>
    )
  } else if (status === 'sent') {
    primary = (
      <Button
        onClick={() => setStatus('paid', '入金済にしました', '入金を確認しましたか？（入金済にします）')}
        isLoading={pending === 'paid'}
        disabled={busy}
        className="w-full sm:w-auto"
      >
        {pending !== 'paid' && <Wallet className="h-4 w-4" aria-hidden />}
        入金済にする
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end print:hidden">
      {primary}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/invoices/${invoiceId}/pdf`}
          target="_blank"
          rel="noopener"
          className={linkCls}
          title="取引先へ送る・印刷するための PDF を開きます"
        >
          <FileDown className="h-4 w-4 shrink-0" aria-hidden />
          PDF（送付・印刷用）
        </a>
        <a href={`/api/invoices/${invoiceId}/csv`} className={linkCls} title="会計ソフト取り込み用の CSV">
          <Table className="h-4 w-4 shrink-0" aria-hidden />
          CSV
        </a>
        {/* 確定済みで送付前でも、入金が先に確認できたときのため */}
        {status === 'finalized' && (
          <Button
            variant="secondary"
            onClick={() => setStatus('paid', '入金済にしました', '入金を確認しましたか？（入金済にします）')}
            isLoading={pending === 'paid'}
            disabled={busy}
            className="whitespace-nowrap"
          >
            {pending !== 'paid' && <Wallet className="h-4 w-4" aria-hidden />}
            入金済にする
          </Button>
        )}
        {status === 'paid' && (
          <Button
            variant="secondary"
            onClick={() => setStatus('sent', '入金済を取り消しました', '入金済を取り消しますか？')}
            isLoading={pending === 'sent'}
            disabled={busy}
            className="whitespace-nowrap"
          >
            {pending !== 'sent' && <Undo2 className="h-4 w-4" aria-hidden />}
            入金を取り消す
          </Button>
        )}
        {/* 下書きは削除できる。確定後は番号と履歴を残すため「無効にする」だけ（tax.md: 欠番禁止） */}
        {status === 'draft' && (
          <button type="button" onClick={handleDelete} disabled={busy} className={dangerCls} title="この下書きを削除">
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
            {pending === 'delete' ? '削除中…' : '削除'}
          </button>
        )}
        {(status === 'finalized' || status === 'sent') && (
          <button
            type="button"
            onClick={() =>
              setStatus(
                'void',
                '請求書を無効にしました',
                'この請求書を無効にしますか？\n（番号と履歴は残ります。元に戻せません。明細は再び請求できる状態に戻ります）',
              )
            }
            disabled={busy}
            className={dangerCls}
            title="この請求書を無効にする（削除はしない）"
          >
            <Ban className="h-4 w-4 shrink-0" aria-hidden />
            {pending === 'void' ? '処理中…' : '無効にする'}
          </button>
        )}
      </div>
    </div>
  )
}
