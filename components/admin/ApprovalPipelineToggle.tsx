'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'

export interface ApprovalPipelineToggleProps {
  /** AUTO_APPROVE_ENABLED === "on" なら true（＝自動確定モードON / 手動承認パイプラインOFF） */
  initialAutoApprove: boolean
  /** AUTO_APPROVE_THRESHOLD（未設定時は "0.80"） */
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
 * 管理者専用の「承認パイプライン ON/OFF（手動確認モード ⇔ 自動確定モード）」ワンクリック切替バー。
 * 運用が軌道に乗った際は「自動確定モード」にすることで、問題のない通常注文を承認待ちで止めずに
 * 即時確定（harvest_tasks 自動生成）させることができる（要確認フラグ・文字潰れ・「約」表記は安全のため承認待ちに止まる）。
 */
export function ApprovalPipelineToggle({
  initialAutoApprove,
  initialThreshold,
}: ApprovalPipelineToggleProps) {
  const router = useRouter()
  const [autoApprove, setAutoApprove] = useState<boolean>(initialAutoApprove)
  const [threshold, setThreshold] = useState<string>(initialThreshold || '0.80')
  const [saving, setSaving] = useState<boolean>(false)

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
          ? `⚡ 自動確定モード（承認パイプライン省略）をONにしました（確信度 ${Math.round(Number(nextThreshold) * 100)}% 以上の正常注文を自動確定）`
          : '🛡️ 手動承認パイプラインをONにしました（すべての注文を承認画面で確認します）',
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
            <span className="text-xs font-bold text-ink">
              {autoApprove
                ? '⚡ 自動確定モード稼働中（承認パイプライン：自動パス）'
                : '🛡️ 手動承認パイプライン稼働中（1件ずつ人間が確認して承認）'}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-bold',
                autoApprove
                  ? 'bg-harvest-600 text-white'
                  : 'bg-earth-100 text-earth-800',
              )}
            >
              {autoApprove ? '自動承認 ON' : '手動確認 ON'}
            </span>
          </div>
          <p className="text-xs text-ink-soft">
            {autoApprove
              ? '取引先・納品日が確定し要確認フラグのない通常注文は、承認待ちをスキップして自動で確定（収穫タスク生成）されます。文字潰れや「約80」等の要確認行のみここに残ります。'
              : '運用が安定しているときは右のスイッチで「自動確定モード」に切り替えると、問題のない注文を自動で確定できます（管理者専用）。'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
        {autoApprove && (
          <div className="flex items-center gap-1.5">
            <label htmlFor="auto-approve-threshold-select" className="text-xs font-medium text-ink-soft">
              自動確定の基準:
            </label>
            <select
              id="auto-approve-threshold-select"
              value={threshold}
              disabled={saving}
              onChange={(e) => void savePipelineMode(true, e.target.value)}
              className="h-8 rounded border border-line-strong bg-bg-card px-2 font-mono text-xs text-ink focus:border-trust-500 focus:outline-none"
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
          <span className="text-xs font-medium text-ink-soft">
            {autoApprove ? '自動確定 ON' : '自動確定 OFF'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoApprove}
            aria-label="承認パイプラインの自動確定モードを切り替え"
            disabled={saving}
            onClick={() => void savePipelineMode(!autoApprove, threshold)}
            className={cn(
              'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-earth-500 focus:ring-offset-2 disabled:opacity-50',
              autoApprove ? 'bg-harvest-600' : 'bg-line-strong',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition duration-200',
                autoApprove ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>
    </Card>
  )
}
