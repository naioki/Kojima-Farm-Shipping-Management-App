'use client'

import { useState, useRef, useId } from 'react'
import { AlertTriangle, RotateCcw, Save, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

const CONFIRM_PHRASE = '変更を理解しました'
const RESET_PHRASE = 'デフォルトに戻すことを理解しました'

interface PromptEditorProps {
  settingKey: string
  label: string
  hint?: string
  /** DB から取得した現在値（空文字＝未設定＝デフォルト使用中）。 */
  currentValue: string
  /** コード埋め込みのデフォルト値。「デフォルトに戻す」の戻し先。 */
  defaultPrompt: string
  onSaved?: () => void
}

type ModalMode = 'save' | 'reset' | null

/**
 * 危険設定エディタ — AI 解析プロンプト用。
 * 誤ったプロンプトが業務停止を引き起こすため、以下の「健全な摩擦」を設ける:
 *   1. 警告バナー（常時表示）
 *   2. 保存・リセット時に確認フレーズ（"変更を理解しました"）の入力を要求
 *   3. デフォルトとの差分を保存前に提示
 */
export function PromptEditor({
  settingKey,
  label,
  hint,
  currentValue,
  defaultPrompt,
  onSaved,
}: PromptEditorProps) {
  const id = useId()
  const [draft, setDraft] = useState(currentValue || defaultPrompt)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDefault, setShowDefault] = useState(false)
  const confirmRef = useRef<HTMLInputElement>(null)

  const isUsingDefault = !currentValue
  const isDirty = draft !== (currentValue || defaultPrompt)

  const expectedPhrase = modalMode === 'reset' ? RESET_PHRASE : CONFIRM_PHRASE
  const phraseMatches = confirmInput.trim() === expectedPhrase

  function openModal(mode: ModalMode) {
    setModalMode(mode)
    setConfirmInput('')
    // 次フレームでフォーカス
    setTimeout(() => confirmRef.current?.focus(), 50)
  }

  function closeModal() {
    setModalMode(null)
    setConfirmInput('')
  }

  async function handleConfirm() {
    if (!phraseMatches) return
    setSaving(true)
    try {
      const newValue = modalMode === 'reset' ? '' : draft
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: [{ key: settingKey, value: newValue }] }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      if (modalMode === 'reset') {
        setDraft(defaultPrompt)
        toast.success('デフォルトのプロンプトに戻しました')
      } else {
        toast.success('プロンプトを保存しました')
      }
      closeModal()
      onSaved?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* ラベル */}
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      </div>

      {/* ⚠️ 警告バナー */}
      <div className="flex gap-2 rounded border border-warning/50 bg-warning-bg px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="text-xs text-ink-soft">
          <strong className="text-ink">AIの解析ロジックが変わります。</strong>
          誤ったプロンプトは受注の誤読・業務停止の原因になります。
          変更後は必ずテスト解析で動作を確認してください。
          {isUsingDefault && (
            <span className="ml-1 font-medium text-harvest-700">現在はデフォルト値を使用中。</span>
          )}
        </div>
      </div>

      {/* テキストエリア */}
      <div className="relative">
        <textarea
          id={`prompt-${id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          spellCheck={false}
          className={cn(
            'w-full rounded border bg-bg-card px-3 py-2.5 font-mono text-xs text-ink',
            'transition-[border-color,box-shadow] duration-150',
            'border-line-strong hover:border-earth-400',
            'focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100',
            'resize-y',
          )}
        />
        {isDirty && (
          <span className="absolute right-2 top-2 rounded-full bg-earth-100 px-1.5 py-0.5 text-[10px] font-medium text-earth-700">
            未保存
          </span>
        )}
      </div>

      {/* デフォルト値の確認トグル */}
      <button
        type="button"
        onClick={() => setShowDefault((v) => !v)}
        className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink-soft"
      >
        {showDefault ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        デフォルト値を{showDefault ? '隠す' : '確認'}
      </button>
      {showDefault && (
        <pre className="overflow-auto rounded border border-line bg-bg-soft px-3 py-2 font-mono text-xs text-ink-faint whitespace-pre-wrap">
          {defaultPrompt}
        </pre>
      )}

      {/* アクションボタン */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!isDirty}
          onClick={() => openModal('save')}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          この変更を保存
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={isUsingDefault && draft === defaultPrompt}
          onClick={() => openModal('reset')}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          デフォルトに戻す
        </Button>
      </div>

      {/* 確認モーダル */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`modal-title-${id}`}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card shadow-xl border border-line">
            {/* モーダルヘッダー */}
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-alert" aria-hidden />
              <div>
                <h2 id={`modal-title-${id}`} className="font-display text-base font-bold text-ink">
                  {modalMode === 'reset' ? 'デフォルトに戻す確認' : 'プロンプト変更の確認'}
                </h2>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {modalMode === 'reset'
                    ? 'カスタムプロンプトを削除し、コード埋め込みのデフォルトに戻します。'
                    : 'AI解析の動作が変わります。誤った設定は業務停止の原因になります。'}
                </p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* 変更内容のプレビュー（save モードのみ） */}
              {modalMode === 'save' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-ink-soft">変更後のプロンプト（先頭 120 文字）：</p>
                  <pre className="overflow-hidden rounded bg-bg-soft px-3 py-2 font-mono text-xs text-ink line-clamp-3 whitespace-pre-wrap">
                    {draft.slice(0, 120)}{draft.length > 120 ? '…' : ''}
                  </pre>
                </div>
              )}

              {/* 確認フレーズ入力 */}
              <div className="space-y-1.5">
                <label htmlFor={`confirm-${id}`} className="text-xs font-medium text-ink">
                  続けるには{' '}
                  <code className="rounded bg-bg-soft px-1 py-0.5 font-mono text-xs text-alert">
                    {expectedPhrase}
                  </code>{' '}
                  と入力してください
                </label>
                <input
                  ref={confirmRef}
                  id={`confirm-${id}`}
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && phraseMatches && handleConfirm()}
                  placeholder={expectedPhrase}
                  className={cn(
                    'h-10 w-full rounded border px-3 text-sm',
                    'transition-[border-color,box-shadow] duration-150',
                    'focus:outline-none focus:ring-2',
                    phraseMatches
                      ? 'border-harvest-400 bg-harvest-50 text-harvest-900 focus:border-harvest-500 focus:ring-harvest-100'
                      : 'border-line-strong bg-bg-card text-ink focus:border-trust-500 focus:ring-trust-100',
                  )}
                  autoComplete="off"
                />
                {confirmInput.length > 0 && !phraseMatches && (
                  <p className="text-xs text-alert">フレーズが一致しません</p>
                )}
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <Button variant="secondary" size="sm" onClick={closeModal}>
                キャンセル
              </Button>
              <Button
                variant={modalMode === 'reset' ? 'danger' : 'primary'}
                size="sm"
                disabled={!phraseMatches}
                isLoading={saving}
                onClick={handleConfirm}
              >
                {modalMode === 'reset' ? 'デフォルトに戻す' : '変更を保存する'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
