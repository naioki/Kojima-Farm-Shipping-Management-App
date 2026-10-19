'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileImage,
  Lightbulb,
  MailOpen,
  MessageSquarePlus,
  RotateCw,
  Sparkles,
  Trash2,
  Zap,
  CheckCheck,
  ZoomIn,
  ZoomOut,
  LayoutList,
  Columns2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/States'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { ChannelBadge } from '@/components/admin/InboxBadges'
import type { PendingOrder, PendingOrderItem } from '@/lib/orders/pending-types'
import { pendingReasons } from '@/lib/orders/pending-types'
import { formatJpDateShort } from '@/lib/dates'
import {
  determineContainerType,
  formatQuantityCaseText,
  generateOrderKey,
} from '@/lib/pipeline/schemas'

interface EditableRow extends PendingOrderItem {
  draftQty: string
  saving: boolean
  confirmDelete: boolean
}

interface SplitApprovalViewProps {
  orders: PendingOrder[]
}

/**
 * 確信度（0〜1）に応じたバッジ・行スタイルを返す（高: 緑 / 中: 黄 / 低・要確認: 赤）。
 */
function confidenceBadgeStyle(confidence: number | null) {
  if (confidence == null || confidence < 0.7) {
    return {
      label: confidence != null ? `要確認 ${Math.round(confidence * 100)}%` : '要確認 (未採点)',
      badgeCls: 'bg-alert-bg text-alert border border-alert/40',
      rowCls: 'bg-alert-bg/25',
      inputCls: 'border-alert/60 focus:border-alert',
    }
  }
  if (confidence < 0.85) {
    return {
      label: `中確信 ${Math.round(confidence * 100)}%`,
      badgeCls: 'bg-warning-bg text-warning border border-warning/40',
      rowCls: 'bg-warning-bg/20',
      inputCls: 'border-warning/60 focus:border-trust-500',
    }
  }
  return {
    label: `高確信 ${Math.round(confidence * 100)}%`,
    badgeCls: 'bg-harvest-50 text-harvest-700 border border-harvest-300',
    rowCls: '',
    inputCls: 'border-line-strong focus:border-trust-500',
  }
}

/**
 * 取引先名・納入先に応じた標準入数（NSKは24、それ以外は20）・ケース数・端数・箱数・コンテナ種別・固定書式を計算。
 * （ARCHITECTURE.md 第3.1章・第4.5章 継承）
 */
function calcBoxBreakdown(totalPacks: number, customerName: string, destinationName?: string | null) {
  const isNsk = customerName.includes('農業総合研究所') || customerName.toLowerCase().includes('nsk')
  const packsPerCase = isNsk ? 24 : 20
  const containerType = determineContainerType(customerName, destinationName)
  if (!Number.isFinite(totalPacks) || totalPacks <= 0) {
    return {
      packsPerCase,
      cases: 0,
      remainder: 0,
      boxes: 0,
      containerType,
      quantityCaseText: formatQuantityCaseText(0, 0, 0),
    }
  }
  const cases = Math.floor(totalPacks / packsPerCase)
  const remainder = totalPacks % packsPerCase
  const boxes = cases + (remainder > 0 ? 1 : 0)
  return {
    packsPerCase,
    cases,
    remainder,
    boxes,
    containerType,
    quantityCaseText: formatQuantityCaseText(totalPacks, cases, remainder),
  }
}

/**
 * LayerX「バクラク」/ Sansan「Bill One」流のスプリットビュー人間承認UI（/admin/approvals）。
 * `kojima-farm-order-pipeline` (ARCHITECTURE.md Ver 4.1) の思想を完全統合：
 * - 左ペイン: Kojima-FAX (`drive_backup.py`) が Google Drive に保存した原本PDFを直接埋め込み表示（R2・Storage二重保存不要）
 * - 右ペイン: 確信度色分け付きインライン編集テーブル ＋ 注文キー・固定書式・コンテナ種別集計
 * - AI対話修正バー: 旧Discordリプライ修正をWeb画面に継承。自然言語で修正指示＆恒久ルール自動抽出・`ai_rules` 自己更新
 */
export function SplitApprovalView({ orders }: SplitApprovalViewProps) {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<'split' | 'single'>('split')
  const [selectedOrderId, setSelectedOrderId] = useState<string>(orders[0]?.id ?? '')

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? orders[0] ?? null,
    [orders, selectedOrderId],
  )

  // 注文ごとの編集行ステート
  const [rowsByOrder, setRowsByOrder] = useState<Record<string, EditableRow[]>>(() => {
    const map: Record<string, EditableRow[]> = {}
    for (const o of orders) {
      map[o.id] = o.items.map((it) => ({
        ...it,
        draftQty: String(it.quantity),
        saving: false,
        confirmDelete: false,
      }))
    }
    return map
  })

  // 左ペイン原本ビューアのズーム・回転・再送比較ステート
  const [zoom, setZoom] = useState<number>(100)
  const [rotation, setRotation] = useState<number>(0)
  const [showParentOriginal, setShowParentOriginal] = useState<boolean>(false)

  // 自然言語AI対話修正（旧Discordリプライ修正のWeb統合）ステート
  const [aiInstruction, setAiInstruction] = useState('')
  const [revisingByAi, setRevisingByAi] = useState(false)

  // 修正履歴（ワンクリックAIルール学習用サジェスト）
  const [lastModification, setLastModification] = useState<{
    clientName: string
    suggestedRuleText: string
  } | null>(null)
  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [learningClient, setLearningClient] = useState('')
  const [learningRuleText, setLearningRuleText] = useState('')
  const [savingRule, setSavingRule] = useState(false)

  // 一括承認ステート
  const [selectedIdsForBulk, setSelectedIdsForBulk] = useState<Set<string>>(new Set())
  const [bulkConfirmModalOpen, setBulkConfirmModalOpen] = useState(false)
  const [bulkTargetOrders, setBulkTargetOrders] = useState<PendingOrder[]>([])
  const [bulkApproving, setBulkApproving] = useState(false)

  // 高確信度注文（警告理由が0件・日付・納入先確定済み）
  const confidentOrders = useMemo(
    () => orders.filter((o) => pendingReasons(o).length === 0),
    [orders],
  )

  function openBulkApproveModal(targets: PendingOrder[]) {
    if (targets.length === 0) return
    setBulkTargetOrders(targets)
    setBulkConfirmModalOpen(true)
  }

  async function executeBulkApprove() {
    if (bulkTargetOrders.length === 0) return
    setBulkApproving(true)
    try {
      const res = await fetch('/api/orders/bulk-approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds: bulkTargetOrders.map((o) => o.id) }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        successCount?: number
        failedCount?: number
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `一括承認失敗 (${res.status})`)

      toast.success(`${json.successCount ?? bulkTargetOrders.length}件の注文を一括承認しました！`)
      setSelectedIdsForBulk(new Set())
      setBulkConfirmModalOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括承認に失敗しました')
    } finally {
      setBulkApproving(false)
    }
  }

  if (orders.length === 0 || !selectedOrder) {
    return (
      <EmptyState
        title="現在、承認待ちの注文はありません"
        description="Kojima-FAX からの自動投入（/orders/ingest）やクイック注文から新しい注文が届くと、ここで Google Drive 原本と見比べながら承認できます。"
        action={
          <Link
            href="/admin/orders"
            className="inline-flex h-9 items-center rounded-lg bg-earth-600 px-4 text-xs font-medium text-white hover:bg-earth-700"
          >
            受注一覧へ移動
          </Link>
        }
      />
    )
  }

  const currentRows = rowsByOrder[selectedOrder.id] ?? []
  const reasons = pendingReasons(selectedOrder)

  function patchRow(orderId: string, itemId: string, patch: Partial<EditableRow>) {
    setRowsByOrder((prev) => ({
      ...prev,
      [orderId]: (prev[orderId] ?? []).map((r) => (r.id === itemId ? { ...r, ...patch } : r)),
    }))
  }

  async function saveQuantity(order: PendingOrder, row: EditableRow) {
    const n = Number(row.draftQty)
    if (row.draftQty.trim() === '' || !Number.isFinite(n) || n < 0) {
      toast.error('数量は0以上の数字で入力してください')
      patchRow(order.id, row.id, { draftQty: String(row.quantity) })
      return
    }
    if (n === row.quantity) return

    const oldQty = row.quantity
    patchRow(order.id, row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: n, version: row.version }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        item?: { quantity: number; version: number }
        error?: string
      }
      if (res.status === 409) {
        toast.error('他の人が編集しました。画面を更新します')
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)

      const updatedQty = json.item ? Number(json.item.quantity) : n
      patchRow(order.id, row.id, {
        quantity: updatedQty,
        draftQty: String(updatedQty),
        version: json.item?.version ?? row.version + 1,
        saving: false,
      })
      toast.success('数量を修正しました')

      const breakdown = calcBoxBreakdown(updatedQty, order.customerName, order.destinationName)
      const destLabel = order.destinationName ? `（納入先: ${order.destinationName}）` : ''
      setLastModification({
        clientName: order.customerName.includes('未紐付け') ? '共通' : order.customerName,
        suggestedRuleText: `【${order.customerName}】${destLabel}${row.productName}の数量読取で「${oldQty}」と誤読された場合は総パック数「${updatedQty}P」（${breakdown.cases}ケース＋端数${breakdown.remainder}P、入数${breakdown.packsPerCase}）として解釈する。`,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '数量の保存に失敗しました')
      patchRow(order.id, row.id, { saving: false, draftQty: String(row.quantity) })
    }
  }

  async function savePackConfig(order: PendingOrder, row: EditableRow, packConfigId: string) {
    patchRow(order.id, row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_config_id: packConfigId || null, version: row.version }),
      })
      const json = (await res.json().catch(() => ({}))) as { item?: { version: number }; error?: string }
      if (res.status === 409) {
        toast.error('他の人が編集しました。画面を更新します')
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)

      patchRow(order.id, row.id, {
        packConfigId: packConfigId || null,
        version: json.item?.version ?? row.version + 1,
        saving: false,
      })
      toast.success('荷姿を確定しました')

      const chosenLabel = row.packConfigOptions.find((pc) => pc.id === packConfigId)?.label
      if (chosenLabel) {
        const destLabel = order.destinationName ? `（納入先: ${order.destinationName}）` : ''
        setLastModification({
          clientName: order.customerName.includes('未紐付け') ? '共通' : order.customerName,
          suggestedRuleText: `【${order.customerName}】${destLabel}${row.productName}の荷姿・規格は「${chosenLabel}」を標準として適用する。`,
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '荷姿の保存に失敗しました')
      patchRow(order.id, row.id, { saving: false })
    }
  }

  async function deleteRow(order: PendingOrder, row: EditableRow) {
    patchRow(order.id, row.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除失敗 (${res.status})`)
      }
      setRowsByOrder((prev) => ({
        ...prev,
        [order.id]: (prev[order.id] ?? []).filter((r) => r.id !== row.id),
      }))
      toast.success('明細行を削除しました')
      setLastModification({
        clientName: order.customerName.includes('未紐付け') ? '共通' : order.customerName,
        suggestedRuleText: `【${order.customerName}】「${row.productName}」の行は小島農園のチンゲン菜受注対象外のため抽出から除外（スキップ）する。`,
      })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      patchRow(order.id, row.id, { saving: false, confirmDelete: false })
    }
  }

  /**
   * 自然言語によるAI対話修正＆恒久ルール自動抽出（ARCHITECTURE.md §1.3 & §5.3 継承）
   */
  async function handleAiRevision() {
    if (!selectedOrder) return
    if (!aiInstruction.trim()) {
      toast.error('修正指示を入力してください（例: 200Pに直して / 今後は〇〇を△△にする）')
      return
    }
    setRevisingByAi(true)
    try {
      const currentOrderPayload = [
        {
          customer_name: selectedOrder.customerName,
          destination_name: selectedOrder.destinationName,
          delivery_date: selectedOrder.deliveryDate,
          items: currentRows.map((r) => ({
            raw_name: r.productName,
            product_name: r.productName,
            quantity: r.draftQty,
            unit: r.unit,
            confidence: r.confidence ?? 0.9,
          })),
        },
      ]
      const res = await fetch('/api/orders/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          currentOrders: currentOrderPayload,
          instruction: aiInstruction.trim(),
          clientName: selectedOrder.customerName.includes('未紐付け') ? '共通' : selectedOrder.customerName,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        orders?: Array<{ items: Array<{ quantity: string }> }>
        aiLearnedRuleCandidate?: string | null
        ruleSaved?: boolean
        revisionSummary?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `AI修正失敗 (${res.status})`)

      const revisedItems = json.orders?.[0]?.items ?? []
      if (revisedItems.length > 0) {
        setRowsByOrder((prev) => ({
          ...prev,
          [selectedOrder.id]: (prev[selectedOrder.id] ?? []).map((row, idx) => {
            const rev = revisedItems[idx]
            const newQ = rev ? Number(rev.quantity) : row.quantity
            if (Number.isFinite(newQ) && newQ > 0) {
              return { ...row, quantity: newQ, draftQty: String(newQ), confidence: 1.0 }
            }
            return row
          }),
        }))
      }

      if (json.aiLearnedRuleCandidate && json.ruleSaved) {
        toast.success(`AI修正完了＆恒久ルールを自動学習しました：「${json.aiLearnedRuleCandidate}」`)
      } else {
        toast.success(json.revisionSummary || 'AIで修正指示を反映しました')
      }
      setAiInstruction('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI対話修正に失敗しました')
    } finally {
      setRevisingByAi(false)
    }
  }

  function openLearnModal(customClient?: string, customRule?: string) {
    if (!selectedOrder) return
    const fallbackClient = selectedOrder.customerName.includes('未紐付け')
      ? '共通'
      : selectedOrder.customerName
    const fallbackRule =
      lastModification?.suggestedRuleText ||
      `【${fallbackClient}】${selectedOrder.destinationName ? `納品先『${selectedOrder.destinationName}』の` : ''}チンゲン菜は入数20（総パック数＝ケース×20）で換算する。`
    setLearningClient(customClient ?? lastModification?.clientName ?? fallbackClient)
    setLearningRuleText(customRule ?? fallbackRule)
    setRuleModalOpen(true)
  }

  async function handleSaveLearnedRule() {
    if (!learningClient.trim() || !learningRuleText.trim()) {
      toast.error('取引先名とルール内容を入力してください')
      return
    }
    setSavingRule(true)
    try {
      const res = await fetch('/api/ai-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: learningClient.trim(),
          rule_text: learningRuleText.trim(),
          priority: 5,
          category: 'parsing',
          is_active: true,
          source: 'hitl_approval',
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `ルール保存失敗 (${res.status})`)
      toast.success('取引先ルールとしてAIに学習させました！（次回解析から自動適用されます）')
      setRuleModalOpen(false)
      setLastModification(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ルールの学習保存に失敗しました')
    } finally {
      setSavingRule(false)
    }
  }

  const activeReceipt =
    showParentOriginal && selectedOrder.receipt?.parent
      ? selectedOrder.receipt.parent
      : selectedOrder.receipt

  const previewSrc =
    activeReceipt?.previewUrl ||
    (activeReceipt?.hasOriginal ? `/api/receipts/${activeReceipt.id}/original?mode=preview` : null)

  const externalViewHref =
    activeReceipt?.originalUrl ||
    (activeReceipt?.hasOriginal ? `/api/receipts/${activeReceipt.id}/original` : null)

  return (
    <div className="space-y-4">
      {/* 一括操作バー */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-gradient-to-r from-bg-card to-bg-soft p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-ink">一括操作:</span>
          {confidentOrders.length > 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => openBulkApproveModal(confidentOrders)}
              className="gap-1.5 bg-forest-600 text-white hover:bg-forest-700"
            >
              <Zap className="h-3.5 w-3.5 text-warning-bg" aria-hidden />
              <span>安心・高確信な注文を一括承認</span>
              <span className="rounded-full bg-white/20 px-2 py-0.2 font-mono text-[11px] font-bold">
                {confidentOrders.length}件
              </span>
            </Button>
          )}

          {selectedIdsForBulk.size > 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                const targets = orders.filter((o) => selectedIdsForBulk.has(o.id))
                openBulkApproveModal(targets)
              }}
              className="gap-1.5"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              <span>選択した注文を一括承認 ({selectedIdsForBulk.size}件)</span>
            </Button>
          )}

          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => {
              if (selectedIdsForBulk.size === orders.length) {
                setSelectedIdsForBulk(new Set())
              } else {
                setSelectedIdsForBulk(new Set(orders.map((o) => o.id)))
              }
            }}
            className="text-xs text-ink-muted hover:text-ink"
          >
            {selectedIdsForBulk.size === orders.length ? '全選択解除' : '全選択'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 表示モード切替トグル（スプリット ⇔ 1カラム） */}
          <div className="inline-flex rounded-lg border border-line bg-bg-soft p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 transition',
                viewMode === 'split' ? 'bg-white text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
              )}
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span>原本スプリット</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 transition',
                viewMode === 'single' ? 'bg-white text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span>1カラム詳細</span>
            </button>
          </div>

          <div className="text-xs text-ink-muted">
            <span>全 {orders.length} 件中 </span>
            <span className="font-bold text-forest-700">{confidentOrders.length} 件が高確信</span>
            {orders.length - confidentOrders.length > 0 && (
              <span className="ml-1 text-alert">
                （要確認 {orders.length - confidentOrders.length} 件）
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 承認待ち注文セレクターバー（複数件あるときにワンクリック切替） */}
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
        {orders.map((o, idx) => {
          const isSelected = o.id === selectedOrder.id
          const hasWarning = pendingReasons(o).length > 0
          const isChecked = selectedIdsForBulk.has(o.id)
          return (
            <div
              key={o.id}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-all',
                isSelected
                  ? 'border-earth-600 bg-earth-600 text-white shadow-sm'
                  : 'border-line-strong bg-bg-card text-ink hover:bg-bg-soft',
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => {
                  e.stopPropagation()
                  const next = new Set(selectedIdsForBulk)
                  if (e.target.checked) next.add(o.id)
                  else next.delete(o.id)
                  setSelectedIdsForBulk(next)
                }}
                className="h-3.5 w-3.5 cursor-pointer rounded border-line text-earth-600 focus:ring-earth-500"
                aria-label={`注文 #${idx + 1} を一括承認対象に選択`}
              />
              <button
                type="button"
                onClick={() => {
                  setSelectedOrderId(o.id)
                  setShowParentOriginal(false)
                  setRotation(0)
                }}
                className="flex items-center gap-2 text-left"
              >
                <span className="num rounded bg-black/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                  #{idx + 1}
                </span>
                <ColorDot color={o.customerColor} name={o.customerName} />
                <span className="max-w-[160px] truncate">
                  {o.customerName}
                  {o.destinationName ? ` ＞ ${o.destinationName}` : ''}
                </span>
                <span className={cn('num font-mono', isSelected ? 'text-white/80' : 'text-ink-faint')}>
                  {o.deliveryDate ? formatJpDateShort(o.deliveryDate) : '納品日未定'}
                </span>
                {hasWarning && (
                  <AlertTriangle
                    className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-warning-bg' : 'text-warning')}
                    aria-hidden
                  />
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* 左右スプリットビュー本体（スプリットモード: 12カラム 6:6 分割 / 1カラムモード: 中央配置） */}
      <div className={cn('grid grid-cols-1 gap-4', viewMode === 'split' ? 'lg:grid-cols-12' : 'max-w-4xl mx-auto')}>
        {/* 左ペイン：Kojima-FAX 原本プレビュー */}
        {viewMode === 'split' ? (
          <Card className="flex flex-col overflow-hidden p-0 lg:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg-soft px-4 py-2.5">
            <div className="flex items-center gap-2">
              {selectedOrder.receipt?.hasOriginal ? (
                <FileImage className="h-4 w-4 text-earth-700" aria-hidden />
              ) : (
                <MailOpen className="h-4 w-4 text-earth-700" aria-hidden />
              )}
              <span className="text-xs font-bold text-ink">
                受信原本プレビュー（Kojima-FAX Google Drive 連携）
              </span>
              {selectedOrder.receipt?.isRevision && (
                <span className="rounded bg-warning-bg px-2 py-0.5 text-[11px] font-bold text-warning">
                  再送・追記FAX
                </span>
              )}
            </div>

            {selectedOrder.receipt && (
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedOrder.receipt.isRevision && selectedOrder.receipt.parent && (
                  <button
                    type="button"
                    onClick={() => setShowParentOriginal((v) => !v)}
                    className="rounded border border-line-strong bg-bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-bg-soft"
                  >
                    {showParentOriginal ? '今回の再送原本へ戻す' : '再送前の元FAXを表示'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(50, z - 25))}
                  title="縮小"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                >
                  <ZoomOut className="h-3.5 w-3.5" aria-hidden />
                </button>
                <span className="num w-11 text-center font-mono text-xs tabular-nums text-ink-soft">
                  {zoom}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(200, z + 25))}
                  title="拡大"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                >
                  <ZoomIn className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  title="90度回転"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                </button>
                {externalViewHref && (
                  <a
                    href={externalViewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-bg-card px-2 text-xs font-medium text-trust-700 hover:bg-trust-50"
                  >
                    Google Driveで開く
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="relative flex min-h-[540px] flex-1 items-center justify-center overflow-auto bg-bg-soft/50 p-3">
            {previewSrc ? (
              <div
                className="h-full w-full transition-transform duration-150"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'top center',
                }}
              >
                <iframe
                  key={activeReceipt?.id ?? previewSrc}
                  src={previewSrc}
                  title="FAX原本プレビュー（Google Drive）"
                  className="h-[640px] w-full rounded border border-line bg-white shadow-sm"
                />
              </div>
            ) : activeReceipt?.emailText ? (
              <pre className="h-[600px] w-full overflow-auto whitespace-pre-wrap rounded border border-line bg-bg-card p-4 font-mono text-xs leading-relaxed text-ink">
                {activeReceipt.emailText}
              </pre>
            ) : (
              <div className="space-y-2 text-center text-sm text-ink-faint">
                <p>この注文にはFAX原本URLが紐付いていません（手動・テキスト注文またはポータル注文）。</p>
              </div>
            )}
          </div>
          </Card>
        ) : null}

        {/* 右ペイン：AI抽出明細の編集・検算・承認・対話修正・ワンクリックルール学習 */}
        <Card className={cn('flex flex-col justify-between space-y-4 p-4', viewMode === 'split' ? 'lg:col-span-6' : 'w-full shadow-sm')}>
          <div className="space-y-4">
            {/* 注文ヘッダー（「取引先 ＞ 納入先」原則を厳守） */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <ChannelBadge channel={selectedOrder.source} />
                  {reasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-bold text-warning"
                    >
                      {r}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <ColorDot color={selectedOrder.customerColor} name={selectedOrder.customerName} size="md" />
                  <h2 className="font-display text-lg font-bold text-ink">
                    {selectedOrder.customerName}
                    {selectedOrder.destinationName && (
                      <span className="ml-1.5 font-normal text-ink-soft">
                        ＞ {selectedOrder.destinationName}
                      </span>
                    )}
                  </h2>
                </div>
                <p className="text-xs text-ink-soft">
                  納品予定日:{' '}
                  <strong className="num font-mono text-ink">
                    {selectedOrder.deliveryDate
                      ? formatJpDateShort(selectedOrder.deliveryDate)
                      : '未確定（下の承認欄で入力）'}
                  </strong>
                </p>
              </div>

              <button
                type="button"
                onClick={() => openLearnModal()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-earth-300 bg-earth-50 px-3 py-1.5 text-xs font-bold text-earth-800 transition-colors hover:bg-earth-100"
              >
                <Lightbulb className="h-4 w-4 text-earth-600" aria-hidden />
                💡 取引先ルールを学習させる
              </button>
            </div>

            {/* 伝票No・特記事項・数量変更メモ・要返答アラート表示（ARCHITECTURE.md §3.1・§4.2） */}
            {selectedOrder.notes && (
              <div className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-xs text-ink-soft">
                <p className="font-bold text-ink">📄 解析メタデータ・特記事項</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans leading-relaxed">{selectedOrder.notes}</pre>
              </div>
            )}

            {/* 管理者が明細を修正した直後のワンクリック学習サジェストバナー */}
            {lastModification && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-earth-400 bg-earth-50 px-3.5 py-2.5 text-xs text-ink shadow-sm">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-earth-700" aria-hidden />
                  <div>
                    <p className="font-bold text-earth-800">
                      💡 この修正を今後の取引先ルールとしてAIに学習させますか？
                    </p>
                    <p className="mt-0.5 text-ink-soft">{lastModification.suggestedRuleText}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      openLearnModal(lastModification.clientName, lastModification.suggestedRuleText)
                    }
                  >
                    ワンクリックで学習保存
                  </Button>
                  <button
                    type="button"
                    onClick={() => setLastModification(null)}
                    className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-bg-soft"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            )}

            {/* 確信度カラー凡例 */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
              <span>AI確信度:</span>
              <span className="inline-flex items-center gap-1 rounded bg-harvest-50 px-2 py-0.5 font-medium text-harvest-700">
                ● 高 (85%〜)
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-2 py-0.5 font-medium text-warning">
                ▲ 中 (70〜84%)
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-alert-bg px-2 py-0.5 font-medium text-alert">
                ⚠️ 低・要確認 (〜69%)
              </span>
            </div>

            {/* 明細テーブル */}
            {currentRows.length === 0 ? (
              <p className="rounded border border-line bg-bg-soft p-6 text-center text-sm text-ink-soft">
                明細がありません。受注一覧からこの注文を削除できます。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-b border-line bg-bg-soft text-left text-xs text-ink-soft">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">品目 / 注文キー / 確信度</th>
                      <th className="px-3 py-2.5 font-medium">荷姿 / コンテナ</th>
                      <th className="px-3 py-2.5 text-right font-medium">総パック数</th>
                      <th className="px-3 py-2.5 text-right font-medium">数量/ケース (Ver 4.1)</th>
                      <th className="w-12 px-2 py-2.5" aria-hidden />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {currentRows.map((row) => {
                      const style = confidenceBadgeStyle(row.confidence)
                      const needsPack = row.packConfigOptions.length > 0 && !row.packConfigId
                      const breakdown = calcBoxBreakdown(
                        Number(row.draftQty) || 0,
                        selectedOrder.customerName,
                        selectedOrder.destinationName,
                      )
                      const chosenPackLabel =
                        row.packConfigOptions.find((pc) => pc.id === row.packConfigId)?.label ??
                        `入数${breakdown.packsPerCase}`
                      const orderKeyPreview = generateOrderKey({
                        clientName: selectedOrder.customerName,
                        deliveryDate: selectedOrder.deliveryDate ?? '',
                        destination: selectedOrder.destinationName ?? '',
                        itemName: row.productName,
                        spec: chosenPackLabel,
                      })
                      return (
                        <tr key={row.id} className={cn('transition-colors', style.rowCls)}>
                          <td className="px-3 py-3">
                            <div className="font-medium text-ink">{row.productName}</div>
                            <div className="mt-0.5 font-mono text-[10px] text-ink-faint" title="正規化注文キー (ARCHITECTURE.md §3.2)">
                              {orderKeyPreview}
                            </div>
                            <span
                              className={cn(
                                'num mt-1 inline-block rounded px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums',
                                style.badgeCls,
                              )}
                            >
                              {style.label}
                            </span>
                          </td>

                          <td className="px-3 py-3">
                            {row.packConfigOptions.length > 0 ? (
                              <select
                                value={row.packConfigId ?? ''}
                                disabled={row.saving}
                                onChange={(e) => savePackConfig(selectedOrder, row, e.target.value)}
                                aria-label={`${row.productName} の荷姿`}
                                className={cn(
                                  'h-9 w-full min-w-[140px] rounded border bg-bg-card px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-trust-100',
                                  needsPack
                                    ? 'border-alert bg-alert-bg/30 font-bold text-alert'
                                    : 'border-line-strong',
                                )}
                              >
                                <option value="">荷姿を選択（必須）</option>
                                {row.packConfigOptions.map((pc) => (
                                  <option key={pc.id} value={pc.id}>
                                    {pc.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-ink-faint">
                                標準（{breakdown.packsPerCase}入）
                              </span>
                            )}
                            <div className="mt-1 text-[11px] font-medium text-earth-700">
                              📦 {breakdown.containerType}
                            </div>
                          </td>

                          <td className="px-3 py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={row.draftQty}
                                disabled={row.saving}
                                onChange={(e) =>
                                  patchRow(selectedOrder.id, row.id, { draftQty: e.target.value })
                                }
                                onBlur={() => saveQuantity(selectedOrder, row)}
                                onKeyDown={(e) =>
                                  e.key === 'Enter' && (e.target as HTMLInputElement).blur()
                                }
                                aria-label={`${row.productName} の数量`}
                                className={cn(
                                  'num h-10 w-24 rounded border bg-bg-card px-2.5 text-right font-mono text-base font-bold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-trust-100',
                                  style.inputCls,
                                )}
                              />
                              <span className="text-xs text-ink-soft">{row.unit}</span>
                            </div>
                          </td>

                          <td className="num whitespace-nowrap px-3 py-3 text-right font-mono text-xs tabular-nums text-ink-soft">
                            <div>
                              <strong className="text-ink">{breakdown.boxes}箱</strong>
                              <span className="ml-1 text-ink-faint">
                                ({breakdown.cases}C+{breakdown.remainder}P)
                              </span>
                            </div>
                            <div className="text-[10px] text-ink-faint">
                              {breakdown.quantityCaseText}
                            </div>
                          </td>

                          <td className="px-2 py-3 text-right">
                            {row.confirmDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => deleteRow(selectedOrder, row)}
                                  className="rounded bg-alert px-2 py-1 text-xs font-bold text-white"
                                >
                                  削除
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchRow(selectedOrder.id, row.id, { confirmDelete: false })
                                  }
                                  className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-bg-soft"
                                >
                                  戻す
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  patchRow(selectedOrder.id, row.id, { confirmDelete: true })
                                }
                                disabled={row.saving}
                                aria-label={`${row.productName} を削除`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-faint hover:bg-alert-bg/40 hover:text-alert"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 自然言語によるAI対話修正＆指示書自己更新バー（ARCHITECTURE.md §1.3 & §5.3 継承） */}
            <div className="rounded-lg border border-line bg-bg-soft/70 p-3">
              <label
                htmlFor="ai-revision-input"
                className="flex items-center gap-1.5 text-xs font-bold text-ink"
              >
                <MessageSquarePlus className="h-3.5 w-3.5 text-trust-600" aria-hidden />
                💬 AIに対話で修正指示・ルール自動学習（旧Discordリプライ継承）
              </label>
              <p className="mt-0.5 text-[11px] text-ink-soft">
                例: 「数量を240Pに直して」「今後は〇〇を△△と読むようにして」と入力すると、AIが入数換算を再計算し、恒久ルールがあれば自動的に{' '}
                <code className="font-mono">ai_rules</code> に追加学習します。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="ai-revision-input"
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAiRevision()}
                  placeholder="修正指示または今後のルールを自然言語で入力..."
                  disabled={revisingByAi}
                  className="h-9 flex-1 rounded border border-line-strong bg-bg-card px-3 text-xs text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAiRevision}
                  isLoading={revisingByAi}
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  AIで再計算・ルール学習
                </Button>
              </div>
            </div>
          </div>

          {/* 下部：承認実行バー（納品日・納入先ゲート統合済み） */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Link
              href="/admin/rules"
              className="inline-flex items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI学習ルール一覧を開く（/admin/rules）
            </Link>

            {currentRows.length > 0 && (
              <ApproveOrderButton
                orderId={selectedOrder.id}
                needsDeliveryDate={selectedOrder.needsDeliveryDate}
                needsDestination={selectedOrder.needsDestination}
                destinationOptions={selectedOrder.destinationOptions}
                label="内容を確認して承認する（収穫タスク生成）"
                size="md"
              />
            )}
          </div>
        </Card>
      </div>

      {/* ワンクリックAIルール学習モーダル */}
      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title="💡 この修正を取引先ルールとしてAIに学習させる"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRuleModalOpen(false)} disabled={savingRule}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={handleSaveLearnedRule} isLoading={savingRule}>
              <Check className="h-4 w-4" aria-hidden />
              ai_rules に保存して即時反映
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink-soft">
            保存したルールは Supabase の <code className="font-mono">ai_rules</code> テーブルに即時登録され、次回以降のFAX・テキスト解析プロンプトへ自動的に注入されます。
          </p>
          <div>
            <label htmlFor="learn-client-name" className="mb-1 block text-xs font-medium text-ink-soft">
              対象取引先名 <span className="text-alert">*</span>
            </label>
            <input
              id="learn-client-name"
              type="text"
              value={learningClient}
              onChange={(e) => setLearningClient(e.target.value)}
              className="h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
            />
          </div>
          <div>
            <label htmlFor="learn-rule-text" className="mb-1 block text-xs font-medium text-ink-soft">
              学習させるルール文面 <span className="text-alert">*</span>
            </label>
            <textarea
              id="learn-rule-text"
              rows={4}
              value={learningRuleText}
              onChange={(e) => setLearningRuleText(e.target.value)}
              className="w-full rounded border border-line-strong bg-bg-card p-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
            />
          </div>
        </div>
      </Modal>

      {/* 一括承認確認モーダル */}
      <Modal
        open={bulkConfirmModalOpen}
        onClose={() => !bulkApproving && setBulkConfirmModalOpen(false)}
        title="⚡ 注文の一括承認"
        className="max-w-lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setBulkConfirmModalOpen(false)}
              disabled={bulkApproving}
            >
              キャンセル
            </Button>
            <Button
              variant="primary"
              onClick={executeBulkApprove}
              isLoading={bulkApproving}
              className="gap-1.5 bg-forest-600 hover:bg-forest-700"
            >
              <Zap className="h-4 w-4 text-warning-bg" aria-hidden />
              {bulkTargetOrders.length}件を一括承認する
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-soft">
            以下の <strong className="text-ink font-bold">{bulkTargetOrders.length} 件</strong> の注文を一括承認して出荷マトリクス（収穫タスク）へ反映します。
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-bg-soft p-2.5 text-xs">
            {bulkTargetOrders.map((o) => {
              const warns = pendingReasons(o)
              return (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-2 border-b border-line/40 pb-1.5 last:border-none"
                >
                  <div className="flex items-center gap-2 truncate">
                    <ColorDot color={o.customerColor} name={o.customerName} size="sm" />
                    <span className="font-bold text-ink">{o.customerName}</span>
                    {o.destinationName && (
                      <span className="text-ink-soft">＞ {o.destinationName}</span>
                    )}
                    <span className="font-mono text-ink-faint">
                      ({o.deliveryDate ? formatJpDateShort(o.deliveryDate) : '納品日未定'})
                    </span>
                  </div>
                  {warns.length > 0 ? (
                    <span className="rounded bg-alert-bg px-1.5 py-0.5 text-[10px] font-bold text-alert">
                      {warns.join(', ')}
                    </span>
                  ) : (
                    <span className="rounded bg-forest-100 px-1.5 py-0.5 text-[10px] font-bold text-forest-700">
                      高確信
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
