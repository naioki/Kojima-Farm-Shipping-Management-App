'use client'

import { useState, useEffect } from 'react'
import { MessageSquarePlus, Send, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export interface FeedbackReport {
  id: string
  created_at: string
  created_by_name?: string
  status: 'pending' | 'in_progress' | 'resolved' | 'archived'
  admin_note?: string
  when?: string
  where?: string
  who?: string
  what: string
  why?: string
  how?: string
}

export function FeedbackReportSection({ isAdmin = true }: { isAdmin?: boolean }) {
  const [reports, setReports] = useState<FeedbackReport[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  // フォーム state
  const [what, setWhat] = useState('')
  const [when, setWhen] = useState('')
  const [where, setWhere] = useState('')
  const [who, setWho] = useState('')
  const [why, setWhy] = useState('')
  const [how, setHow] = useState('')
  const [showOptionalFields, setShowOptionalFields] = useState(false)

  // 編集用 state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAdminNote, setEditAdminNote] = useState('')

  useEffect(() => {
    fetchReports()
  }, [])

  async function fetchReports() {
    setLoading(true)
    try {
      const res = await fetch('/api/feedback')
      const json = await res.json()
      if (res.ok && json.reports) {
        setReports(json.reports)
      }
    } catch {
      // 握りつぶし
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!what.trim()) {
      toast.error('「なにが起きたか・改善したいこと」を入力してください')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          what: what.trim(),
          when: when.trim() || undefined,
          where: where.trim() || undefined,
          who: who.trim() || undefined,
          why: why.trim() || undefined,
          how: how.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '送信に失敗しました')

      toast.success('改善要望・バグ報告を送信しました。ご協力ありがとうございます！')
      setWhat('')
      setWhen('')
      setWhere('')
      setWho('')
      setWhy('')
      setHow('')
      setShowOptionalFields(false)
      if (json.report) {
        setReports((prev) => [json.report, ...prev])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(id: string, newStatus: FeedbackReport['status']) {
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      })
      if (!res.ok) throw new Error('ステータス更新に失敗しました')
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)),
      )
      toast.success('ステータスを更新しました')
    } catch {
      toast.error('ステータスの更新に失敗しました')
    }
  }

  async function handleSaveAdminNote(id: string) {
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, admin_note: editAdminNote }),
      })
      if (!res.ok) throw new Error('メモの保存に失敗しました')
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, admin_note: editAdminNote } : r)),
      )
      setEditingId(null)
      toast.success('管理メモを保存しました')
    } catch {
      toast.error('管理メモの保存に失敗しました')
    }
  }

  const filteredReports = reports.filter((r) => {
    if (filterStatus === 'all') return true
    return r.status === filterStatus
  })

  return (
    <div className="rounded-2xl border-2 border-emerald-300 bg-white p-6 shadow-sm space-y-6">
      {/* 見出し */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
              <MessageSquarePlus className="h-5 w-5" />
            </span>
            <h2 className="font-display text-xl font-black text-ink">現場からの改善要望・バグ報告（5W1H）</h2>
          </div>
          <p className="mt-1 text-sm font-medium text-ink-soft">
            現場での気づき、バグ、こうしてほしい要望を気軽にお寄せください。<span className="font-bold text-emerald-700">「全部埋めなくてもOK」</span>です。
          </p>
        </div>
      </div>

      {/* 5W1H 投稿フォーム */}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
        <div>
          <label className="block text-sm font-black text-ink">
            【なにが起きたか・改善したいこと】（What） <span className="text-red-500 font-bold">*必須</span>
          </label>
          <textarea
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            rows={3}
            placeholder="例: 出荷一覧の右下ボタンが押しづらい、この画面で〇〇のボタンを追加してほしい、など"
            className="mt-1.5 w-full rounded-xl border border-ink/20 bg-white p-3 text-sm text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            required
          />
        </div>

        {/* 任意項目の開閉 */}
        <div>
          <button
            type="button"
            onClick={() => setShowOptionalFields(!showOptionalFields)}
            className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            {showOptionalFields ? '▲ 詳しい項目（いつ/どこで/誰が等）を閉じる' : '▼ 詳しい項目（いつ/どこで/誰が/なぜ/どう改善）も入力する（任意・埋めなくてもOK）'}
          </button>
        </div>

        {showOptionalFields && (
          <div className="grid gap-3 pt-2 sm:grid-cols-2 text-xs">
            <div>
              <label className="block font-bold text-ink">【いつ頃】（When・任意）</label>
              <input
                type="text"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                placeholder="例: 今日の15時頃、朝の出荷作業中"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-ink">【どこで・どの画面】（Where・任意）</label>
              <input
                type="text"
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="例: 出荷一覧、新規出荷追加、FAX原本画面"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-ink">【だれが】（Who・任意）</label>
              <input
                type="text"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="例: パートさん、現場リーダー"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-ink">【なぜ・どんな状況で】（Why・任意）</label>
              <input
                type="text"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="例: 電波が悪かった、急いでいて押し間違えた"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-ink">【どう改善してほしいか】（How・任意）</label>
              <input
                type="text"
                value={how}
                onChange={(e) => setHow(e.target.value)}
                placeholder="例: ボタンを大きくして色を変えてほしい、確認画面を出してほしい"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            disabled={submitting || !what.trim()}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            <Send className="h-4 w-4" />
            {submitting ? '送信中...' : '改善・報告を送信する'}
          </Button>
        </div>
      </form>

      {/* 改善・報告の対応状況一覧（管理者・現場共有） */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-black text-ink flex items-center gap-2">
            <span>📋 お寄せいただいた報告・対応ステータス</span>
            <span className="text-xs font-normal text-ink-soft">({reports.length}件)</span>
          </h3>

          {/* フィルター */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-ink-soft" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-ink/20 bg-white px-2 py-1 text-xs text-ink"
            >
              <option value="all">すべて表示</option>
              <option value="pending">未着手のみ</option>
              <option value="in_progress">対応中のみ</option>
              <option value="resolved">対応済のみ</option>
              <option value="archived">アーカイブ</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-center py-6 text-sm text-ink-soft font-bold">読み込み中...</p>
        ) : filteredReports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink-soft">
            該当する報告はありません。
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((r) => {
              const statusColor =
                r.status === 'resolved'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : r.status === 'in_progress'
                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                  : r.status === 'archived'
                  ? 'bg-zinc-100 text-zinc-600 border-zinc-200'
                  : 'bg-amber-100 text-amber-900 border-amber-300'

              const statusLabel =
                r.status === 'resolved'
                  ? '対応済'
                  : r.status === 'in_progress'
                  ? '対応中'
                  : r.status === 'archived'
                  ? 'アーカイブ'
                  : '未着手'

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-ink/10 bg-white p-4 space-y-2.5 shadow-2xs hover:border-emerald-300 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded-md px-2 py-0.5 text-xs font-black border', statusColor)}>
                        {statusLabel}
                      </span>
                      <span className="text-xs font-bold text-ink-soft">
                        {r.created_by_name || 'スタッフ'}・{new Date(r.created_at).toLocaleDateString('ja-JP')}
                      </span>
                    </div>

                    {/* 管理者ステータス変更セレクト */}
                    {isAdmin && (
                      <select
                        value={r.status}
                        onChange={(e) => handleStatusChange(r.id, e.target.value as FeedbackReport['status'])}
                        className="rounded-lg border border-ink/20 bg-white px-2 py-0.5 text-xs font-bold text-ink hover:border-ink/40"
                      >
                        <option value="pending">未着手にする</option>
                        <option value="in_progress">対応中にする</option>
                        <option value="resolved">対応済にする</option>
                        <option value="archived">アーカイブ</option>
                      </select>
                    )}
                  </div>

                  {/* 本文 (What) */}
                  <p className="text-sm font-black text-ink whitespace-pre-wrap">{r.what}</p>

                  {/* 5W1H 補足情報 */}
                  {(r.when || r.where || r.who || r.why || r.how) && (
                    <div className="grid gap-1.5 sm:grid-cols-2 rounded-lg bg-sand-50 p-2.5 text-xs text-ink-soft">
                      {r.when && <div><span className="font-bold text-ink">いつ:</span> {r.when}</div>}
                      {r.where && <div><span className="font-bold text-ink">どこで:</span> {r.where}</div>}
                      {r.who && <div><span className="font-bold text-ink">だれが:</span> {r.who}</div>}
                      {r.why && <div><span className="font-bold text-ink">なぜ:</span> {r.why}</div>}
                      {r.how && <div className="sm:col-span-2"><span className="font-bold text-ink">どうしたい:</span> {r.how}</div>}
                    </div>
                  )}

                  {/* 管理者メモ */}
                  {isAdmin ? (
                    <div className="pt-1 text-xs">
                      {editingId === r.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editAdminNote}
                            onChange={(e) => setEditAdminNote(e.target.value)}
                            placeholder="管理者対応メモ（例: 次回デプロイでボタン配置修正）"
                            className="flex-1 rounded-lg border border-ink/20 p-1.5 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSaveAdminNote(r.id)}
                            className="text-xs py-1 h-7"
                          >
                            保存
                          </Button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-ink-soft hover:underline"
                          >
                            閉じる
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-ink-soft">
                          <span>
                            {r.admin_note ? (
                              <span className="text-emerald-800 font-bold">💬 管理メモ: {r.admin_note}</span>
                            ) : (
                              <span className="text-ink-soft/70">管理メモなし</span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(r.id)
                              setEditAdminNote(r.admin_note || '')
                            }}
                            className="text-emerald-700 hover:underline font-bold text-xs"
                          >
                            {r.admin_note ? 'メモ編集' : '＋メモ追加'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    r.admin_note && (
                      <div className="pt-1 text-xs font-bold text-emerald-800">
                        🛠 農園管理者からの回答: {r.admin_note}
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
