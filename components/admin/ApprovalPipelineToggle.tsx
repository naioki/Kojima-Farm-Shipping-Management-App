'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/Modal'

export interface ApprovalPipelineToggleProps {
  /** 自動確定がオンなら true */
  initialAutoApprove: boolean
  /** 自動確定の基準（未設定時は "0.80"） */
  initialThreshold: string
}

const THRESHOLD_OPTIONS = [
  { value: '0.80', label: '80%以上を自動確定（推奨）' },
  { value: '0.85', label: '85%以上を自動確定' },
  { value: '0.90', label: '90%以上を自動確定' },
  { value: '0.95', label: '95%以上を自動確定（厳格）' },
  { value: '1.0', label: '100%のみ自動確定' },
]

/**
 * 管理者専用の「自動確定」切替バー（オンにするときは確認ダイアログ）。
 * オンにすると、問題のない通常注文を承認待ちで止めずに確定する（要確認の印・文字潰れ・「約」表記は承認待ちに残る）。
 */
export function ApprovalPipelineToggle({
  initialAutoApprove,
  initialThreshold,
}: ApprovalPipelineToggleProps) {
  const router = useRouter()
  const [autoApprove, setAutoApprove] = useState<boolean>(initialAutoApprove)
  const [threshold, setThreshold] = useState<string>(initialThreshold || '0.80')
  const [saving, setSaving] = useState<boolean>(false)
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false)

  async function savePipelineMode(nextAutoApprove: boolean, nextThreshold: string) {
    setSaving(true)
    const prevAuto = autoApprove
    const prevThr = threshold
    setAutoApprove(nextAutoApprove)
    setThreshold(nextThreshold)

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { key: 'AUTO_APPROVE_ENABLED', value: nextAutoApprove ? 'on' : 'off' },
            { key: 'AUTO_APPROVE_THRESHOLD', value: nextThreshold },
          ],
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `設定変更に失敗しました (${res.status})`)
      }
      toast.success(
        nextAutoApprove
          ? `自動確定をオンにしました（読み取りの確かさ ${Math.round(Number(nextThreshold) * 100)}% 以上の問題ない注文を自動で確定します）`
          : '自動確定をオフにしました（すべての注文を承認待ちで確認します）',
      )
      router.refresh()
    } catch (e) {
      setAutoApprove(prevAuto)
      setThreshold(prevThr)
      toast.error(e instanceof Error ? e.message : '設定の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      className={cn(
        'flex flex-col gap-3 border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between',
        autoApprove
          ? 'border-harvest-400 bg-harvest-50/50'
          : 'border-line-strong bg-bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            autoApprove ? 'bg-harvest-600 text-white' : 'bg-earth-100 text-earth-700',
          )}
        >
          {autoApprove ? <Zap className="h-5 w-5" aria-hidden /> : <ShieldCheck className="h-5 w-5" aria-hidden />}
        </span>
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">
              {autoApprove ? '自動確定：オン（問題のない注文は人の確認なしで進みます）' : '自動確定：オフ（1件ずつ人が確認して承認します）'}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-bold',
                autoApprove
                  ? 'bg-harvest-600 text-white'
                  : 'bg-earth-100 text-earth-800',
              )}
            >
              {autoApprove ? '自動確定 オン' : '手動で確認'}
            </span>
          </div>
          <p className="text-sm text-ink-soft">
            {autoApprove
              ? '取引先と納品日がはっきりしていて「要確認」の印がない注文は、承認待ちに溜めずに自動で確定し、収穫・パックボードに載ります。文字がつぶれた行や「約80」のような曖昧な行だけが承認待ちに残ります。'
              : '運用が安定してきたら、右のスイッチで自動確定をオンにできます（管理者のみ）。'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
        {autoApprove && (
          <div className="flex items-center gap-1.5">
            <label htmlFor="auto-approve-threshold-select" className="whitespace-nowrap text-sm font-medium text-ink-soft">
              自動確定の基準
            </label>
            <select
              id="auto-approve-threshold-select"
              value={threshold}
              disabled={saving}
              onChange={(e) => void savePipelineMode(true, e.target.value)}
              className="h-10 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:border-trust-500 focus:outline-none"
            >
              {THRESHOLD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-ink">{autoApprove ? 'オン' : 'オフ'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoApprove}
            aria-label="注文の自動確定を切り替える"
            disabled={saving}
            onClick={() => {
              // オンにするときだけ確認（人の確認を外す操作のため）。オフは安全側なのでそのまま
              if (autoApprove) void savePipelineMode(false, threshold)
              else setConfirmOpen(true)
            }}
            className={cn(
              // 見た目は小さいスイッチだが、押せる範囲は縦 40px 以上（外側の余白で確保）
              'relative inline-flex h-10 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-earth-500 focus:ring-offset-2 disabled:opacity-50',
              autoApprove ? 'bg-forest-600' : 'bg-line-strong',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-7 w-7 transform rounded-full shadow transition duration-200',
                autoApprove ? 'translate-x-6 bg-bg-card' : 'translate-x-0.5 bg-ink-faint',
              )}
            />
          </button>
        </div>
      </div>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="自動確定をオンにしますか？"
        message="オンにすると、条件を満たすFAX注文は人の確認なしで出荷ボードに載ります。文字がつぶれた行や曖昧な行がある注文は、これまでどおり承認待ちに残ります。"
        confirmLabel="オンにする"
        danger={false}
        isLoading={saving}
        onConfirm={async () => {
          await savePipelineMode(true, threshold)
          setConfirmOpen(false)
        }}
      />
    </Card>
  )
}
