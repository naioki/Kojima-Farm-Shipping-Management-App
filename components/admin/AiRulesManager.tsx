'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Filter,
  ShieldCheck,
  Cpu,
  FlaskConical,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/States'
import { GEMINI_HIGH_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS, normalizeModelId } from '@/lib/gemini/models'
import type { AiRule } from '@/types/database'
import { formatJpDateTime } from '@/lib/dates'

const STANDARD_CLIENTS = [
  '共通',
  '農事組合法人 和郷園',
  '農事組合法人 房総食料センター',
  '株式会社勘兵衛',
  '株式会社農業総合研究所（NSK）',
]

const SOURCE_LABEL: Record<string, string> = {
  'seed_v2.3': '標準v2.3シード',
  admin_gui: '管理画面追加',
  hitl_approval: '承認画面から学習',
}

const DRY_RUN_SAMPLES = [
  {
    label: '和郷園（週間マトリクス＋青コン岩槻）',
    text: '農事組合法人 和郷園 納品日:明日 マテハン:青コン 納入先:岩槻 チンゲン菜 300+0 (15-0) ★',
  },
  {
    label: '房総食料センター（約80→要確認）',
    text: '農事組合法人 房総食料センター 出荷割振連絡表 明日 BOX用 チンゲン菜 200g 約 80',
  },
  {
    label: '勘兵衛（イオンタウン向け 5 C/S → 100P）',
    text: '株式会社勘兵衛 イオンタウン向け発注書 明日 チンゲン菜 200gFG×20入 5 C/S',
  },
  {
    label: 'NSK（小島裕美11番・入数24・シールあり）',
    text: '株式会社農業総合研究所 生産者11:小島裕美 明日 チンゲンサイ 50P シール:あり 買値¥130',
  },
  {
    label: '注文外スキップ（JA富里きゅうり割振表）',
    text: 'JA富里 きゅうり・トマト出荷割振表 明日 A品 50ケース',
  },
]

interface DryRunResult {
  is_order: boolean
  used_model?: string
  applied_rules_count?: number
  orders: {
    customer_name: string | null
    destination_name?: string | null
    delivery_date: string | null
    note?: string | null
    items: {
      raw_name: string
      product_name: string | null
      quantity: string
      unit: string | null
      confidence: number
      spec?: string | null
      packs_per_case?: number | null
      cases?: number | null
      remainder_packs?: number | null
      box_count?: number | null
      container_type?: string | null
      needs_review_reason?: string | null
    }[]
  }[]
}

interface AiRulesManagerProps {
  initialRules: AiRule[]
  customers: { id: string; name: string }[]
  initialModel: string
  initialHighModel?: string
}

/**
 * AIルール・ナレッジ管理GUI（/admin/rules）。
 * 1. 取引先別の読取ルールのON/OFFトグル切り替え・新規追加・文面編集・削除
 * 2. AIモデル（GEMINI_MODEL）の自由入力（Combobox / カンマ区切りフォールバック対応）＆ワンクリック保存
 * 3. 🧪 ルール＆モデル動作テスト（ドライラン検証：DBを汚さずにその場で解析結果・箱数検算を確認）
 */
export function AiRulesManager({
  initialRules,
  customers,
  initialModel,
  initialHighModel = 'gemini-3.8-flash',
}: AiRulesManagerProps) {
  const router = useRouter()
  const [rules, setRules] = useState<AiRule[]>(initialRules)
  const [selectedClient, setSelectedClient] = useState<string>('ALL')
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(false)

  // 2段階AIモデル自由入力ステート（メインモデル＆重要箇所モデル）
  const [modelInput, setModelInput] = useState<string>(initialModel)
  const [highModelInput, setHighModelInput] = useState<string>(initialHighModel)
  const [savingModel, setSavingModel] = useState<boolean>(false)

  // 新規作成・編集モーダル状態
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AiRule | null>(null)
  const [clientName, setClientName] = useState('共通')
  const [ruleText, setRuleText] = useState('')
  const [priority, setPriority] = useState('10')
  const [category, setCategory] = useState('parsing')
  const [submitting, setSubmitting] = useState(false)

  // ドライラン（ルール＆モデル動作テスト）モーダル状態
  const [testModalOpen, setTestModalOpen] = useState(false)
  const [testText, setTestText] = useState(DRY_RUN_SAMPLES[0]!.text)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<DryRunResult | null>(null)

  // 削除確認モーダル状態
  const [deletingRule, setDeletingRule] = useState<AiRule | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 進行中のトグルID
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({})

  // 取引先候補リスト
  const clientOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_CLIENTS)
    for (const c of customers) set.add(c.name)
    for (const r of rules) set.add(r.client_name)
    return Array.from(set)
  }, [customers, rules])

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (selectedClient !== 'ALL' && r.client_name !== selectedClient) return false
      if (showActiveOnly && !r.is_active) return false
      return true
    })
  }, [rules, selectedClient, showActiveOnly])

  const activeCount = useMemo(() => rules.filter((r) => r.is_active).length, [rules])

  async function handleSaveModel() {
    setSavingModel(true)
    try {
      const normMain = normalizeModelId(modelInput)
      const normHigh = normalizeModelId(highModelInput)
      setModelInput(normMain)
      setHighModelInput(normHigh)
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { key: 'GEMINI_MODEL', value: normMain },
            { key: 'GEMINI_MODEL_HIGH', value: normHigh },
          ],
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存失敗 (${res.status})`)
      }
      toast.success(
        `AIモデルを保存しました（メイン: ${normMain || '自動'} / 重要箇所: ${normHigh || '自動'}）`,
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AIモデルの保存に失敗しました')
    } finally {
      setSavingModel(false)
    }
  }

  async function runDryRunTest() {
    if (!testText.trim()) {
      toast.error('テスト用の注文テキストを入力してください')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: testText.trim(),
          modelOverride: modelInput.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as DryRunResult & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `テスト解析失敗 (${res.status})`)
      setTestResult(json)
      toast.success(
        `解析完了（使用モデル: ${json.used_model ?? '標準'} / 適用ルール: ${json.applied_rules_count ?? activeCount}件）`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'テスト解析に失敗しました')
    } finally {
      setTesting(false)
    }
  }

  function openCreateModal(defaultClient?: string) {
    setEditingRule(null)
    setClientName(defaultClient && defaultClient !== 'ALL' ? defaultClient : '共通')
    setRuleText('')
    setPriority('10')
    setCategory('parsing')
    setModalOpen(true)
  }

  function openEditModal(rule: AiRule) {
    setEditingRule(rule)
    setClientName(rule.client_name)
    setRuleText(rule.rule_text)
    setPriority(String(rule.priority))
    setCategory(rule.category || 'parsing')
    setModalOpen(true)
  }

  async function toggleRuleActive(rule: AiRule) {
    const nextActive = !rule.is_active
    setTogglingIds((prev) => ({ ...prev, [rule.id]: true }))
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: nextActive } : r)))

    try {
      const res = await fetch(`/api/ai-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      })
      const json = (await res.json().catch(() => ({}))) as { rule?: AiRule; error?: string }
      if (!res.ok || !json.rule) {
        throw new Error(json.error ?? `更新失敗 (${res.status})`)
      }
      setRules((prev) => prev.map((r) => (r.id === rule.id ? json.rule! : r)))
      toast.success(
        nextActive
          ? `「${rule.client_name}」のルールを有効化しました（次回AI解析から即時適用）`
          : `「${rule.client_name}」のルールを無効化しました`,
      )
      router.refresh()
    } catch (e) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: rule.is_active } : r)))
      toast.error(e instanceof Error ? e.message : 'トグルの切り替えに失敗しました')
    } finally {
      setTogglingIds((prev) => ({ ...prev, [rule.id]: false }))
    }
  }

  async function handleSaveRule() {
    const trimmedClient = clientName.trim()
    const trimmedText = ruleText.trim()
    const prioNum = Number(priority) || 10

    if (!trimmedClient) {
      toast.error('取引先名を入力または選択してください')
      return
    }
    if (!trimmedText) {
      toast.error('ルール内容を入力してください')
      return
    }

    setSubmitting(true)
    try {
      if (editingRule) {
        const res = await fetch(`/api/ai-rules/${editingRule.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: trimmedClient,
            rule_text: trimmedText,
            priority: prioNum,
            category,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { rule?: AiRule; error?: string }
        if (!res.ok || !json.rule) throw new Error(json.error ?? `保存失敗 (${res.status})`)
        setRules((prev) =>
          prev
            .map((r) => (r.id === editingRule.id ? json.rule! : r))
            .sort((a, b) => a.priority - b.priority),
        )
        toast.success('AIルールを更新しました')
      } else {
        const res = await fetch('/api/ai-rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: trimmedClient,
            rule_text: trimmedText,
            priority: prioNum,
            category,
            is_active: true,
            source: 'admin_gui',
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { rule?: AiRule; error?: string }
        if (!res.ok || !json.rule) throw new Error(json.error ?? `追加失敗 (${res.status})`)
        setRules((prev) => {
          const filtered = prev.filter((r) => r.id !== json.rule!.id)
          return [...filtered, json.rule!].sort((a, b) => a.priority - b.priority)
        })
        toast.success('新しいAIルールを追加しました（次回解析から即時反映されます）')
      }
      setModalOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deletingRule) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/ai-rules/${deletingRule.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? `削除失敗 (${res.status})`)
      setRules((prev) => prev.filter((r) => r.id !== deletingRule.id))
      toast.success('AIルールを削除しました')
      setDeletingRule(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-4">
      {/* サマリー＆アクションバー */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-earth-100 text-earth-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs text-ink-soft">有効なAI読取ルール（動的注入中）</p>
              <p className="num font-mono text-lg font-bold tabular-nums text-ink">
                {activeCount} <span className="text-xs font-normal text-ink-faint">/ 全 {rules.length} 件</span>
              </p>
            </div>
          </div>
          <div className="hidden h-8 w-px bg-line sm:block" />
          <p className="text-xs text-ink-soft">
            ONにしたルールは、再デプロイ不要で直後のFAX受信（<code className="font-mono">/api/receipts</code>）・クイック注文解析に動的注入されます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => setTestModalOpen(true)}>
            <FlaskConical className="h-4 w-4 text-earth-700" aria-hidden />
            🧪 ルール・モデルの動作テスト
          </Button>
          <Button variant="primary" size="md" onClick={() => openCreateModal(selectedClient)}>
            <Plus className="h-4 w-4" aria-hidden />
            新規ルールを追加
          </Button>
        </div>
      </Card>

      {/* 2段階AIモデル自由入力・ワンクリック切替バー（メインモデル＋重要箇所モデル） */}
      <Card className="space-y-3 bg-bg-soft/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <Cpu className="h-4 w-4 text-earth-700" aria-hidden />
            2段階AIモデル指定（自由入力・ハイフン無し手入力も自動整形・404/503時は自動フォールバック）
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveModel}
            isLoading={savingModel}
            className="shrink-0"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            モデル設定を保存
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* ① メインモデル */}
          <div className="space-y-1.5 rounded-lg border border-line bg-bg-card p-3">
            <label htmlFor="ai-model-free-input" className="block text-xs font-bold text-ink">
              ① メインモデル（通常FAX・高速読取）
            </label>
            <p className="text-[11px] text-ink-soft">
              毎回のFAX・テキスト読取で使う高速・低コストモデル（例: <code className="font-mono">gemini-3.5-flash-lite</code>）
            </p>
            <input
              id="ai-model-free-input"
              list="gemini-model-suggestions"
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="例: gemini-3.5-flash-lite"
              className={cn(inputCls, 'font-mono text-xs')}
            />
            <datalist id="gemini-model-suggestions">
              {GEMINI_MODEL_OPTIONS.filter((o) => o.value !== '').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-ink-faint">候補:</span>
              {GEMINI_MODEL_OPTIONS.map((o) => {
                const active = normalizeModelId(modelInput) === o.value
                return (
                  <button
                    key={o.value || '__auto_main__'}
                    type="button"
                    onClick={() => setModelInput(o.value)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors',
                      active
                        ? 'border-earth-600 bg-earth-600 font-bold text-white'
                        : 'border-line bg-bg-soft text-ink-soft hover:border-earth-400 hover:bg-earth-50 hover:text-ink',
                    )}
                  >
                    {o.value === '' ? '自動' : o.value}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ② 重要箇所モデル */}
          <div className="space-y-1.5 rounded-lg border border-line bg-bg-card p-3">
            <label htmlFor="ai-high-model-free-input" className="block text-xs font-bold text-ink">
              ② 重要箇所モデル（要確認の再検証・手書き修正・ルール学習）
            </label>
            <p className="text-[11px] text-ink-soft">
              低確信・検算不一致の自動再検証や対話修正など大切な場面だけ使うモデル（例: <code className="font-mono">gemini-3.8-flash</code>）
            </p>
            <input
              id="ai-high-model-free-input"
              list="gemini-high-model-suggestions"
              type="text"
              value={highModelInput}
              onChange={(e) => setHighModelInput(e.target.value)}
              placeholder="例: gemini-3.8-flash"
              className={cn(inputCls, 'font-mono text-xs')}
            />
            <datalist id="gemini-high-model-suggestions">
              {GEMINI_HIGH_MODEL_OPTIONS.filter((o) => o.value !== '').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-ink-faint">候補:</span>
              {GEMINI_HIGH_MODEL_OPTIONS.map((o) => {
                const active = normalizeModelId(highModelInput) === o.value
                return (
                  <button
                    key={o.value || '__auto_high__'}
                    type="button"
                    onClick={() => setHighModelInput(o.value)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors',
                      active
                        ? 'border-earth-600 bg-earth-600 font-bold text-white'
                        : 'border-line bg-bg-soft text-ink-soft hover:border-earth-400 hover:bg-earth-50 hover:text-ink',
                    )}
                  >
                    {o.value === '' ? '自動' : o.value}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* 取引先フィルタチップ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="取引先別フィルタ">
          <button
            type="button"
            onClick={() => setSelectedClient('ALL')}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              selectedClient === 'ALL'
                ? 'border-earth-600 bg-earth-600 text-white'
                : 'border-line-strong bg-bg-card text-ink hover:bg-bg-soft',
            )}
          >
            すべて ({rules.length})
          </button>
          {clientOptions.map((c) => {
            const count = rules.filter((r) => r.client_name === c).length
            if (count === 0 && !STANDARD_CLIENTS.includes(c)) return null
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedClient(c)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedClient === c
                    ? 'border-earth-600 bg-earth-600 text-white'
                    : 'border-line-strong bg-bg-card text-ink hover:bg-bg-soft',
                )}
              >
                {c} <span className="num font-mono tabular-nums">({count})</span>
              </button>
            )
          })}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-soft">
          <input
            type="checkbox"
            checked={showActiveOnly}
            onChange={(e) => setShowActiveOnly(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong text-earth-600 focus:ring-earth-500"
          />
          <Filter className="h-3.5 w-3.5" aria-hidden />
          有効（ON）のみ表示
        </label>
      </div>

      {/* ルール一覧リスト */}
      {filteredRules.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" aria-hidden />}
          title="該当するAIルールがありません"
          description="「新規ルールを追加」ボタンから取引先別の読み取り・換算ルールを登録できます。"
          action={
            <Button variant="primary" size="sm" onClick={() => openCreateModal(selectedClient)}>
              <Plus className="h-4 w-4" aria-hidden />
              ルールを追加する
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredRules.map((rule) => {
            const busy = Boolean(togglingIds[rule.id])
            return (
              <Card
                key={rule.id}
                className={cn(
                  'transition-all duration-150',
                  !rule.is_active && 'bg-bg-soft/60 opacity-65',
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold',
                          rule.client_name === '共通'
                            ? 'bg-trust-50 text-trust-700'
                            : 'bg-earth-100 text-earth-800',
                        )}
                      >
                        {rule.client_name}
                      </span>
                      <span className="num rounded border border-line px-2 py-0.5 font-mono text-xs tabular-nums text-ink-soft">
                        優先度: {rule.priority}
                      </span>
                      <span className="rounded bg-bg-soft px-2 py-0.5 text-xs text-ink-faint">
                        {SOURCE_LABEL[rule.source] ?? rule.source}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          rule.is_active
                            ? 'bg-harvest-50 text-harvest-700'
                            : 'bg-bg-soft text-ink-faint',
                        )}
                      >
                        {rule.is_active ? (
                          <>
                            <Check className="h-3 w-3" aria-hidden />
                            有効（AI適用中）
                          </>
                        ) : (
                          <>
                            <X className="h-3 w-3" aria-hidden />
                            無効（スキップ）
                          </>
                        )}
                      </span>
                    </div>

                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {rule.rule_text}
                    </p>

                    <p className="num text-xs text-ink-faint">
                      最終更新: {formatJpDateTime(rule.updated_at)}
                    </p>
                  </div>

                  {/* 右側：ON/OFFトグル＋編集・削除ボタン */}
                  <div className="flex shrink-0 items-center gap-3 self-end sm:self-start">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.is_active}
                      aria-label={`${rule.client_name} のルールを有効/無効切り替え`}
                      disabled={busy}
                      onClick={() => toggleRuleActive(rule)}
                      className={cn(
                        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-earth-500 focus:ring-offset-2 disabled:opacity-50',
                        rule.is_active ? 'bg-harvest-600' : 'bg-line-strong',
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition duration-200',
                          rule.is_active ? 'translate-x-5' : 'translate-x-0',
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditModal(rule)}
                      aria-label="ルールを編集"
                      className="inline-flex h-9 items-center gap-1 rounded border border-line-strong bg-bg-card px-2.5 text-xs font-medium text-ink hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      編集
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingRule(rule)}
                      aria-label="ルールを削除"
                      className="inline-flex h-9 w-9 items-center justify-center rounded border border-line-strong bg-bg-card text-ink-faint hover:border-alert/40 hover:bg-alert-bg/30 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 追加・編集モーダル */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'AI読取ルールを編集' : '新規AI読取ルールを追加'}
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={submitting}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={handleSaveRule} isLoading={submitting}>
              {editingRule ? '変更を保存' : 'ルールを追加'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="ai-rule-client" className="mb-1 block text-xs font-medium text-ink-soft">
              対象取引先（全体適用は「共通」） <span className="text-alert">*</span>
            </label>
            <input
              id="ai-rule-client"
              list="ai-rule-client-list"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="例: 農事組合法人 和郷園 / 株式会社勘兵衛 / 共通"
              className={inputCls}
            />
            <datalist id="ai-rule-client-list">
              {clientOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="ai-rule-text" className="mb-1 block text-xs font-medium text-ink-soft">
              AIへの指示・読取ルール内容 <span className="text-alert">*</span>
            </label>
            <textarea
              id="ai-rule-text"
              rows={5}
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder="例: 【株式会社勘兵衛】イオンタウン向け発注書の盤面数値はケース数（単位: C/S）であり、入数20を掛けた値を総パック数とする。"
              className="w-full rounded border border-line-strong bg-bg-card p-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai-rule-priority" className="mb-1 block text-xs font-medium text-ink-soft">
                優先度（小さいほど先頭で適用）
              </label>
              <input
                id="ai-rule-priority"
                type="number"
                min={1}
                max={999}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={cn(inputCls, 'num font-mono tabular-nums')}
              />
            </div>
            <div>
              <label htmlFor="ai-rule-category" className="mb-1 block text-xs font-medium text-ink-soft">
                カテゴリ
              </label>
              <select
                id="ai-rule-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputCls}
              >
                <option value="parsing">読取・数量換算 (parsing)</option>
                <option value="normalization">文字潰れ・納入先名寄せ (normalization)</option>
                <option value="container">荷姿・コンテナ・入数 (container)</option>
                <option value="skip">注文外スキップ条件 (skip)</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* ドライラン検証モーダル（ルール・モデルのその場テスト） */}
      <Modal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        title="🧪 AIルール＆モデル 動作テスト（ドライラン検証）"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestModalOpen(false)} disabled={testing}>
              閉じる
            </Button>
            <Button variant="primary" onClick={runDryRunTest} isLoading={testing}>
              <FlaskConical className="h-4 w-4" aria-hidden />
              テスト解析を実行（DB保存なし）
            </Button>
          </>
        }
      >
        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-xs text-ink-soft">
            現在ONになっている <strong>{activeCount}件のAIルール</strong> と指定中のAIモデル（<code className="font-mono">{modelInput.trim() || '自動'}</code>）を使って、注文データを保存せずに抽出・換算結果だけをテスト検証できます。
          </p>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-ink-soft">検証用プリセットを選択:</span>
            <div className="flex flex-wrap gap-1.5">
              {DRY_RUN_SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setTestText(s.text)}
                  className="rounded-full border border-line bg-bg-soft px-2.5 py-1 text-xs text-ink hover:border-earth-400 hover:bg-earth-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="dry-run-text" className="mb-1 block text-xs font-medium text-ink-soft">
              テスト入力テキスト
            </label>
            <textarea
              id="dry-run-text"
              rows={3}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="w-full rounded border border-line-strong bg-bg-card p-3 font-mono text-xs text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
            />
          </div>

          {testResult && (
            <div className="space-y-3 rounded-lg border border-line bg-bg-soft p-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <span className="font-bold text-ink">
                  判定結果:{' '}
                  {testResult.is_order ? (
                    <span className="text-harvest-700">✅ チンゲン菜の有効な注文 ({testResult.orders.length}件)</span>
                  ) : (
                    <span className="text-warning">⏭️ 注文外FAXとして自動スキップ（is_order: false）</span>
                  )}
                </span>
                <span className="num font-mono text-ink-soft">
                  モデル: <strong>{testResult.used_model ?? '標準'}</strong> / 適用ルール: {testResult.applied_rules_count ?? activeCount}件
                </span>
              </div>

              {testResult.orders.map((o, idx) => (
                <div key={idx} className="space-y-2 rounded border border-line bg-bg-card p-3">
                  <div className="font-bold text-ink">
                    取引先: {o.customer_name ?? '未特定'} ＞ 納入先: {o.destination_name ?? '指定なし'}（納品日: {o.delivery_date ?? '未定'}）
                  </div>
                  {o.note && <div className="text-ink-soft">特記事項: {o.note}</div>}
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-1">品目 / 規格</th>
                        <th className="py-1 text-right">総パック数</th>
                        <th className="py-1 text-right">入数・箱数検算</th>
                        <th className="py-1 text-right">確信度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((it, i) => (
                        <tr key={i} className="border-b border-line/50 last:border-0">
                          <td className="py-1.5">
                            <span className="font-medium text-ink">{it.product_name}</span>
                            {it.spec && <span className="ml-1 text-ink-soft">({it.spec})</span>}
                            {it.needs_review_reason && (
                              <span className="ml-1.5 rounded bg-alert-bg px-1.5 py-0.5 text-[10px] font-bold text-alert">
                                {it.needs_review_reason}
                              </span>
                            )}
                          </td>
                          <td className="num py-1.5 text-right font-mono font-bold text-ink">
                            {it.quantity} {it.unit}
                          </td>
                          <td className="num py-1.5 text-right font-mono text-ink-soft">
                            {it.box_count ?? '?'}箱 ({it.cases ?? '?'}C+{it.remainder_packs ?? 0}P / 入数{it.packs_per_case ?? 20})
                          </td>
                          <td className="num py-1.5 text-right font-mono">
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 font-bold',
                                it.confidence < 0.7
                                  ? 'bg-alert-bg text-alert'
                                  : 'bg-harvest-50 text-harvest-700',
                              )}
                            >
                              {Math.round(it.confidence * 100)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* 削除確認モーダル */}
      <ConfirmModal
        open={Boolean(deletingRule)}
        onClose={() => setDeletingRule(null)}
        onConfirm={handleConfirmDelete}
        title="AIルールの削除"
        confirmLabel="削除する"
        danger
        isLoading={deleting}
        message={
          deletingRule
            ? `「${deletingRule.client_name}」のルールを削除しますか？（一時的に止めたい場合は削除ではなくトグルをOFFにできます）`
            : ''
        }
      />
    </div>
  )
}
