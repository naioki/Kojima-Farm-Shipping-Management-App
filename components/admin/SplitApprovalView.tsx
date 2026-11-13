'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
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
import type { PendingOrder } from '@/lib/orders/pending-types'
import { applyRevisedItems, buildRows, syncRowsWithProps, type EditableRow, type RowsByOrder } from '@/lib/orders/approval-rows'
import { pendingReasons, quantityAnomalyFor, itemsMissingPack } from '@/lib/orders/pending-types'
import { formatJpDateShort } from '@/lib/dates'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { determineContainerType } from '@/lib/pipeline/schemas'
import { showResponseWarnings } from '@/lib/client/show-warnings'


interface SplitApprovalViewProps {
  orders: PendingOrder[]
}

/**
 * 確信度（0〜1）に応じたバッジ・行スタイルを返す（高: 緑 / 中: 黄 / 低・要確認: 赤）。
 */
function confidenceBadgeStyle(confidence: number | null) {
  if (confidence == null || confidence < 0.7) {
    return {
      label: confidence != null ? `AIの読み取り 要確認 ${Math.round(confidence * 100)}%` : 'AIの読み取り 要確認',
      badgeCls: 'bg-alert-bg text-alert border border-alert/40',
      rowCls: 'bg-alert-bg/25',
      inputCls: 'border-alert/60 focus:border-alert',
    }
  }
  if (confidence < 0.85) {
    return {
      label: `AIの読み取り やや不安 ${Math.round(confidence * 100)}%`,
      badgeCls: 'bg-warning-bg text-warning border border-warning/40',
      rowCls: 'bg-warning-bg/20',
      inputCls: 'border-warning/60 focus:border-trust-500',
    }
  }
  return {
    label: `AIの読み取り 自信あり ${Math.round(confidence * 100)}%`,
    badgeCls: 'bg-harvest-50 text-harvest-700 border border-harvest-400',
    rowCls: '',
    inputCls: 'border-line-strong focus:border-trust-500',
  }
}

/**
 * 取引先名・納入先に応じた標準入数（NSKは24、それ以外は20）・ケース数・端数・箱数・コンテナ種別・固定書式を計算。
 * （ARCHITECTURE.md 第3.1章・第4.5章 継承）
 */
function calcBoxBreakdown(
  totalPacks: number,
  customerName: string,
  destinationName?: string | null,
  specOrLabel?: string | null,
) {
  const combined = `${customerName} ${destinationName ?? ''} ${specOrLabel ?? ''}`.normalize('NFKC')
  const specMatch = combined.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
  let packsPerCase = 20
  if (specMatch) {
    const parsedNum = Number(specMatch[1] || specMatch[2])
    if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum <= 200) {
      packsPerCase = parsedNum
    }
  } else if (combined.includes('小コン')) {
    packsPerCase = 30
  } else if (combined.includes('農業総合研究所') || combined.toLowerCase().includes('nsk')) {
    packsPerCase = 24
  }
  const containerType = determineContainerType(customerName, destinationName)
  if (!Number.isFinite(totalPacks) || totalPacks <= 0) {
    return {
      packsPerCase,
      cases: 0,
      remainder: 0,
      boxes: 0,
      containerType,
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
  }
}

/**
 * 原本と並べて見比べる承認UI（/admin/approvals）。
 * - 原本: Kojima-FAX が Google Drive に保存した原本PDF・メール本文（原本が無い注文は枠を出さない）
 * - 明細: 確信度色分け付きの編集カード（数量・荷姿・いつもと違う数量の警告）。スマホは明細を先に出す
 * - AI対話修正バー: 自然言語で修正指示＆恒久ルール自動抽出（ai_rules）
 */
export function SplitApprovalView({ orders }: SplitApprovalViewProps) {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<'split' | 'single'>('split')
  const [optimisticApprovedIds, setOptimisticApprovedIds] = useState<Set<string>>(new Set())

  const visibleOrders = useMemo(
    () => orders.filter((o) => !optimisticApprovedIds.has(o.id)),
    [orders, optimisticApprovedIds],
  )
  const [selectedOrderId, setSelectedOrderId] = useState<string>(orders[0]?.id ?? '')

  const selectedOrder = useMemo(
    () => visibleOrders.find((o) => o.id === selectedOrderId) ?? visibleOrders[0] ?? null,
    [visibleOrders, selectedOrderId],
  )

  const handleQuickApprove = useCallback(
    async (order: PendingOrder) => {
      const r = pendingReasons(order, { kana: false })
      if (r.length > 0) return
      const curIdx = visibleOrders.findIndex((o) => o.id === order.id)
      const nextOrder = visibleOrders[curIdx + 1] ?? visibleOrders[curIdx - 1] ?? null
      setOptimisticApprovedIds((prev) => new Set(prev).add(order.id))
      if (nextOrder) setSelectedOrderId(nextOrder.id)
      toast.success(`${order.customerName} の注文を承認しました`)
      try {
        const res = await fetch(`/api/orders/${order.id}/approve`, { method: 'POST' })
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error ?? '承認に失敗しました')
        }
        showResponseWarnings(await res.json().catch(() => null))
        router.refresh()
      } catch (e) {
        setOptimisticApprovedIds((prev) => {
          const copy = new Set(prev)
          copy.delete(order.id)
          return copy
        })
        setSelectedOrderId(order.id)
        toast.error(`承認できませんでした: ${e instanceof Error ? e.message : '保存に失敗'}（元に戻しました）`)
      }
    },
    [visibleOrders, router],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (!selectedOrder || visibleOrders.length === 0) return
      const idx = visibleOrders.findIndex((o) => o.id === selectedOrder.id)
      if (e.key.toLowerCase() === 'j') {
        e.preventDefault()
        const next = visibleOrders[(idx + 1) % visibleOrders.length]
        if (next) setSelectedOrderId(next.id)
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const prev = visibleOrders[(idx - 1 + visibleOrders.length) % visibleOrders.length]
        if (prev) setSelectedOrderId(prev.id)
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault()
        void handleQuickApprove(selectedOrder)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedOrder, visibleOrders, handleQuickApprove])

  // 注文ごとの編集行ステート
  const [rowsByOrder, setRowsByOrder] = useState<RowsByOrder>(() => buildRows(orders))
  // router.refresh() で新しい props が来たら、編集中でない行を最新の値（version 含む）に同期する。
  // これで 409 のあとや AI 修正のあとも、ページを手で再読込しなくても次の操作が通る。
  useEffect(() => {
    setRowsByOrder((prev) => syncRowsWithProps(prev, orders))
  }, [orders])

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
    () => visibleOrders.filter((o) => pendingReasons(o, { kana: false }).length === 0),
    [visibleOrders],
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
      showResponseWarnings(json)
      setSelectedIdsForBulk(new Set())
      setBulkConfirmModalOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括承認に失敗しました')
    } finally {
      setBulkApproving(false)
    }
  }

  if (visibleOrders.length === 0 || !selectedOrder) {
    return (
      <EmptyState
        title="現在、承認待ちの注文はありません"
        description="FAX・メールで新しい注文が届くと、ここで原本と見比べながら承認できます。"
        action={
          <Link
            href="/admin/orders"
            className="inline-flex h-10 items-center rounded-lg bg-earth-600 px-4 text-sm font-medium text-white hover:bg-earth-700"
          >
            受注台帳へ
          </Link>
        }
      />
    )
  }

  const currentRows = rowsByOrder[selectedOrder.id] ?? []
  const reasons = pendingReasons(selectedOrder, { kana: false })

  function patchRow(orderId: string, itemId: string, patch: Partial<EditableRow>) {
    setRowsByOrder((prev) => ({
      ...prev,
      [orderId]: (prev[orderId] ?? []).map((r) => (r.id === itemId ? { ...r, ...patch } : r)),
    }))
  }

  async function saveQuantity(order: PendingOrder, row: EditableRow) {
    const bd = calcBoxBreakdown(row.quantity, order.customerName, order.destinationName, row.spec)
    const parsedQty = parseQuantity(row.draftQty, { packsPerCase: bd.packsPerCase })
    const n = parsedQty.type === 'ok' ? parsedQty.total.toNumber() : Number(row.draftQty)
    if (row.draftQty.trim() === '' || !Number.isFinite(n) || n < 0) {
      toast.error('数量は0以上の数字または「30c（箱数）」で入力してください')
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
        toast.error('他の人が編集しました。最新の内容に更新します')
        // 編集中扱いを解いておくと、refresh 後の props で行（version 含む）が最新に同期される
        patchRow(order.id, row.id, { saving: false, draftQty: String(row.quantity) })
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
      showResponseWarnings(json)
      toast.success('数量を修正しました')

      const breakdown = calcBoxBreakdown(updatedQty, order.customerName, order.destinationName)
      const destLabel = order.destinationName ? `（納入先: ${order.destinationName}）` : ''
      setLastModification({
        clientName: !order.customerId ? '共通' : order.customerName,
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
        toast.error('他の人が編集しました。最新の内容に更新します')
        // 編集中扱いを解いておくと、refresh 後の props で行（version 含む）が最新に同期される
        patchRow(order.id, row.id, { saving: false, draftQty: String(row.quantity) })
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
          clientName: !order.customerId ? '共通' : order.customerName,
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
      showResponseWarnings(await res.json().catch(() => null))
      setLastModification({
        clientName: !order.customerId ? '共通' : order.customerName,
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
            // 明細を特定する鍵（AI はそのまま返す。サーバーはこの鍵で DB の明細に対応付ける）
            line_key: r.id,
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
          clientName: !selectedOrder.customerId ? '共通' : selectedOrder.customerName,
          // 楽観ロック: 画面が見ていた明細の version（他の人の更新を上書きしない）
          itemVersions: Object.fromEntries(currentRows.map((r) => [r.id, r.version])),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        items?: Array<{ id: string; quantity: number; version: number }>
        aiLearnedRuleCandidate?: string | null
        ruleSaved?: boolean
        revisionSummary?: string
        error?: string
        savedCount?: number
        reason?: string
        deliveryDateSaved?: boolean
      }
      if (res.status === 409) {
        toast.error(
          json.savedCount
            ? `他の人が編集しました。明細は ${json.savedCount} 件だけ保存済みで、納品日は変えていません。最新の内容に更新します`
            : json.reason === 'items_changed'
              ? '他の人が明細を追加・削除しました。何も保存していません。最新の内容に更新します'
              : '他の人が編集しました。何も保存していません。最新の内容に更新します',
        )
        // この注文の行の編集中（打ちかけの数量）を解く。解かないと次の同期の対象外のまま古い version が残り、
        // 次の AI 修正も 409 を繰り返す
        setRowsByOrder((prev) => ({
          ...prev,
          [selectedOrder.id]: (prev[selectedOrder.id] ?? []).map((r) => ({
            ...r,
            saving: false,
            confirmDelete: false,
            draftQty: String(r.quantity),
          })),
        }))
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `AI修正失敗 (${res.status})`)

      // 保存後の各明細の数量・version で行を更新（同じ注文で続けて AI 修正しても 409 にならない）
      const savedItems = json.items ?? []
      if (savedItems.length > 0) {
        setRowsByOrder((prev) => ({
          ...prev,
          [selectedOrder.id]: applyRevisedItems(prev[selectedOrder.id] ?? [], savedItems),
        }))
      }

      if (json.aiLearnedRuleCandidate && json.ruleSaved) {
        toast.success(`AI修正完了＆恒久ルールを自動学習しました：「${json.aiLearnedRuleCandidate}」`)
      } else {
        toast.success(json.revisionSummary || 'AIで修正指示を反映しました')
      }
      showResponseWarnings(json)
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
    const fallbackClient = !selectedOrder.customerId ? '共通' : selectedOrder.customerName
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

  // 原本（FAX画像・メール本文）が無い注文（手入力・ポータル）は原本枠を出さない
  const hasOriginalPane = Boolean(previewSrc || activeReceipt?.emailText)
  const showOriginalPane = viewMode === 'split' && hasOriginalPane

  // 承認ボタンへ渡す: 荷姿の選び忘れ（押す前に止める）と、いつもと違う数量（押したときに確認）
  const missingPack = itemsMissingPack(currentRows)
  const approveAnomalies = currentRows.flatMap((r) => {
    const kind = quantityAnomalyFor(r.quantity, r.usualQuantity)
    return kind && r.usualQuantity != null
      ? [{ productName: r.productName, quantity: r.quantity, unit: r.unit, usualQuantity: r.usualQuantity, kind }]
      : []
  })
  const noteForDisplay = selectedOrder.notes?.replace(/\(OCR\)|（OCR）/g, '（FAXの記載）') ?? null

  return (
    <div className="space-y-4">
      {/* 承認待ち注文の切替（取引先 ＞ 納入先 を2行で。チェックで一括承認の対象に） */}
      <div className="flex flex-wrap items-stretch gap-2">
        {visibleOrders.map((o, idx) => {
          const isSelected = o.id === selectedOrder.id
          const hasWarning = pendingReasons(o, { kana: false }).length > 0
          const isChecked = selectedIdsForBulk.has(o.id)
          return (
            <div
              key={o.id}
              className={cn(
                'flex min-h-12 max-w-full items-stretch rounded-lg border text-left text-xs font-medium transition-all',
                isSelected
                  ? 'border-earth-600 bg-earth-600 text-white shadow-sm'
                  : 'border-line-strong bg-bg-card text-ink hover:bg-bg-soft',
              )}
            >
              <label className="flex min-w-10 cursor-pointer items-center justify-center px-2">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const next = new Set(selectedIdsForBulk)
                    if (e.target.checked) next.add(o.id)
                    else next.delete(o.id)
                    setSelectedIdsForBulk(next)
                  }}
                  className="h-5 w-5 cursor-pointer rounded border-line accent-earth-600 focus:ring-earth-500"
                  aria-label={`${o.customerName}${o.destinationName ? ` ＞ ${o.destinationName}` : ''} を一括承認の対象にする`}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setSelectedOrderId(o.id)
                  setShowParentOriginal(false)
                  setRotation(0)
                }}
                aria-current={isSelected ? 'true' : undefined}
                className="flex min-w-0 items-center gap-2 py-1.5 pr-3 text-left"
              >
                <span className="num whitespace-nowrap rounded bg-black/10 px-1.5 py-0.5 font-mono text-xs tabular-nums">
                  #{idx + 1}
                </span>
                <ColorDot color={o.customerColor} name={o.customerName} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="max-w-[14rem] truncate font-bold" title={o.customerName}>
                    {o.customerName}
                  </span>
                  <span
                    className={cn(
                      'max-w-[14rem] truncate',
                      isSelected ? 'text-white/85' : o.destinationName ? 'text-ink-soft' : 'text-ink-faint',
                    )}
                    title={o.destinationName ?? undefined}
                  >
                    {o.destinationName ? `＞ ${o.destinationName}` : o.needsDestination ? '＞ 納入先 未定' : '＞ 納入先なし'}
                  </span>
                </span>
                <span className={cn('num whitespace-nowrap font-mono', isSelected ? 'text-white/85' : 'text-ink-faint')}>
                  {o.deliveryDate ? formatJpDateShort(o.deliveryDate) : '納品日未定'}
                </span>
                {hasWarning && (
                  <AlertTriangle
                    className={cn('h-4 w-4 shrink-0', isSelected ? 'text-earth-100' : 'text-warning')}
                    aria-label="確認が必要"
                  />
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* 一括操作・表示切替 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg-soft p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {confidentOrders.length > 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => openBulkApproveModal(confidentOrders)}
              className="h-10 gap-1.5 bg-forest-600 text-white hover:bg-forest-700"
            >
              <Zap className="h-3.5 w-3.5 text-earth-100" aria-hidden />
              <span>確認不要の注文をまとめて承認</span>
              <span className="whitespace-nowrap rounded-full bg-white/20 px-2 font-mono text-xs font-bold">
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
                const targets = visibleOrders.filter((o) => selectedIdsForBulk.has(o.id))
                openBulkApproveModal(targets)
              }}
              className="h-10 gap-1.5"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              <span>チェックした注文をまとめて承認（{selectedIdsForBulk.size}件）</span>
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (selectedIdsForBulk.size === visibleOrders.length) {
                setSelectedIdsForBulk(new Set())
              } else {
                setSelectedIdsForBulk(new Set(visibleOrders.map((o) => o.id)))
              }
            }}
            className="h-10"
          >
            {selectedIdsForBulk.size === visibleOrders.length ? 'チェックを全部外す' : '全部チェック'}
          </Button>

          <span className="text-xs text-ink-muted">
            全 {visibleOrders.length} 件・確認不要 {confidentOrders.length} 件
            {visibleOrders.length - confidentOrders.length > 0 && (
              <span className="ml-1 text-alert">（要確認 {visibleOrders.length - confidentOrders.length} 件）</span>
            )}
          </span>
        </div>

        {/* 表示切替（原本と並べる ⇔ 明細だけ）。原本がある注文だけ意味があるので PC のみ出す */}
        <div className="hidden rounded-lg border border-line bg-bg-card p-0.5 text-xs font-bold lg:inline-flex">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            aria-pressed={viewMode === 'split'}
            className={cn(
              'flex min-h-10 items-center gap-1 rounded-md px-3 transition',
              viewMode === 'split' ? 'bg-bg-soft text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
            )}
          >
            <Columns2 className="h-4 w-4" aria-hidden />
            <span>原本と並べる</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('single')}
            aria-pressed={viewMode === 'single'}
            className={cn(
              'flex min-h-10 items-center gap-1 rounded-md px-3 transition',
              viewMode === 'single' ? 'bg-bg-soft text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
            )}
          >
            <LayoutList className="h-4 w-4" aria-hidden />
            <span>明細だけ</span>
          </button>
        </div>
      </div>

      {/* 本体（原本と並べる: PC は 6:6 分割。スマホは明細を先に、原本を後に出す） */}
      <div
        className={cn(
          'grid grid-cols-1 gap-4',
          showOriginalPane ? 'lg:grid-cols-12' : 'mx-auto max-w-4xl',
        )}
      >
        {/* 原本プレビュー */}
        {showOriginalPane ? (
          <Card className="order-2 flex flex-col overflow-hidden p-0 lg:order-1 lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg-soft px-4 py-2">
              <div className="flex items-center gap-2">
                {activeReceipt?.hasOriginal ? (
                  <FileImage className="h-4 w-4 text-earth-700" aria-hidden />
                ) : (
                  <MailOpen className="h-4 w-4 text-earth-700" aria-hidden />
                )}
                <span className="text-sm font-bold text-ink">受信した原本</span>
                {selectedOrder.receipt?.isRevision && (
                  <span className="whitespace-nowrap rounded bg-warning-bg px-2 py-0.5 text-xs font-bold text-warning">
                    再送・追記FAX
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {selectedOrder.receipt?.isRevision && selectedOrder.receipt.parent && (
                  <button
                    type="button"
                    onClick={() => setShowParentOriginal((v) => !v)}
                    className="min-h-10 rounded border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
                  >
                    {showParentOriginal ? '今回の再送原本へ戻す' : '再送前の元FAXを表示'}
                  </button>
                )}
                {previewSrc && (
                  <>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(50, z - 25))}
                      aria-label="縮小"
                      className="inline-flex h-10 w-10 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                    >
                      <ZoomOut className="h-4 w-4" aria-hidden />
                    </button>
                    <span className="num w-11 text-center font-mono text-xs tabular-nums text-ink-soft">{zoom}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(200, z + 25))}
                      aria-label="拡大"
                      className="inline-flex h-10 w-10 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                    >
                      <ZoomIn className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      aria-label="90度回転"
                      className="inline-flex h-10 w-10 items-center justify-center rounded border border-line-strong bg-bg-card text-ink hover:bg-bg-soft"
                    >
                      <RotateCw className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
                {externalViewHref && (
                  <a
                    href={externalViewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-1 rounded border border-line-strong bg-bg-card px-3 text-xs font-medium text-trust-700 hover:bg-trust-50"
                  >
                    別の画面で開く
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </div>

            <div
              className={cn(
                'relative flex flex-1 items-start justify-center overflow-auto bg-bg-soft/50 p-3',
                previewSrc && 'min-h-[320px] lg:min-h-[540px]',
              )}
            >
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
                    title="受信した原本"
                    className="h-[420px] w-full rounded border border-line bg-bg-card shadow-sm lg:h-[640px]"
                  />
                </div>
              ) : (
                <pre className="max-h-[600px] w-full overflow-auto whitespace-pre-wrap rounded border border-line bg-bg-card p-4 font-mono text-xs leading-relaxed text-ink">
                  {activeReceipt?.emailText}
                </pre>
              )}
            </div>
          </Card>
        ) : null}

        {/* 明細の確認・修正・承認 */}
        <Card
          className={cn(
            'order-1 flex min-w-0 flex-col justify-between space-y-4 p-4',
            showOriginalPane ? 'lg:order-2 lg:col-span-6' : 'w-full shadow-sm',
          )}
        >
          <div className="space-y-4">
            {/* 注文ヘッダー（「取引先 ＞ 納入先」） */}
            <div className="space-y-2 border-b border-line pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <ChannelBadge channel={selectedOrder.source} />
                {reasons.map((r) => (
                  <span key={r} className="rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-bold text-warning">
                    {r}
                  </span>
                ))}
              </div>
              <div className="flex items-start gap-2">
                <ColorDot color={selectedOrder.customerColor} name={selectedOrder.customerName} size="md" className="mt-1" />
                <h2 className="min-w-0 break-words font-display text-lg font-bold text-ink">
                  {selectedOrder.customerName}
                  <span className={cn('ml-1.5 font-normal', selectedOrder.destinationName ? 'text-ink-soft' : 'text-alert')}>
                    ＞{' '}
                    {selectedOrder.destinationName ??
                      (selectedOrder.needsDestination ? '納入先 未定（承認の前に選んでください）' : '納入先なし（取引先あて）')}
                  </span>
                </h2>
              </div>
              {!selectedOrder.destinationName && selectedOrder.destinationHint && (
                <p className="text-xs text-ink-soft">
                  FAXの記載: <span className="font-bold text-ink">{selectedOrder.destinationHint}</span>
                  {selectedOrder.needsDestination && '（登録済みの納入先と一致しません）'}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-soft">
                  納品日:{' '}
                  <strong className="num font-mono text-ink">
                    {selectedOrder.deliveryDate ? formatJpDateShort(selectedOrder.deliveryDate) : '未定（下の承認欄で入力）'}
                  </strong>
                </p>
                <button
                  type="button"
                  onClick={() => openLearnModal()}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-earth-300 bg-earth-50 px-3 text-xs font-bold text-earth-800 transition-colors hover:bg-earth-100"
                >
                  <Lightbulb className="h-4 w-4 text-earth-600" aria-hidden />
                  取引先ルールをAIに覚えさせる
                </button>
              </div>
            </div>

            {/* FAX・メモの記載（伝票No・特記事項・数量変更メモ など） */}
            {noteForDisplay && (
              <div className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-xs text-ink-soft">
                <p className="font-bold text-ink">FAX・メモの記載</p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans leading-relaxed">{noteForDisplay}</pre>
              </div>
            )}

            {/* 管理者が明細を修正した直後のワンクリック学習サジェストバナー */}
            {lastModification && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-earth-400 bg-earth-50 px-3.5 py-2.5 text-xs text-ink shadow-sm">
                <div className="flex min-w-0 items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-earth-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-bold text-earth-800">この直し方を、今後もAIに覚えさせますか？</p>
                    <p className="mt-0.5 break-words text-ink-soft">{lastModification.suggestedRuleText}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-10"
                    onClick={() => openLearnModal(lastModification.clientName, lastModification.suggestedRuleText)}
                  >
                    覚えさせる
                  </Button>
                  <button
                    type="button"
                    onClick={() => setLastModification(null)}
                    className="min-h-10 rounded px-3 text-xs text-ink-soft hover:bg-bg-soft"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            )}

            {/* 明細（スマホ・PC とも1品目1枚のカード。数量の警告は数量のすぐ下に全文） */}
            {currentRows.length === 0 ? (
              <p className="rounded border border-line bg-bg-soft p-6 text-center text-sm text-ink-soft">
                明細がありません。受注台帳からこの注文を削除できます。
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {currentRows.map((row) => {
                  const style = confidenceBadgeStyle(row.confidence)
                  const needsPack = row.packConfigOptions.length > 0 && !row.packConfigId
                  const chosenOptLabel = row.packConfigOptions.find((pc) => pc.id === row.packConfigId)?.label
                  const draftNum = Number(row.draftQty)
                  const shownQty = Number.isFinite(draftNum) && row.draftQty.trim() !== '' ? draftNum : row.quantity
                  const breakdown = calcBoxBreakdown(
                    shownQty,
                    selectedOrder.customerName,
                    selectedOrder.destinationName,
                    chosenOptLabel,
                  )
                  const anomaly = quantityAnomalyFor(shownQty, row.usualQuantity)
                  return (
                    <li key={row.id} className={cn('space-y-2 px-3 py-3 transition-colors', style.rowCls)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="break-words text-base font-bold text-ink">{row.productName}</p>
                          <span
                            className={cn(
                              'num inline-block rounded px-2 py-0.5 font-mono text-xs font-bold tabular-nums',
                              style.badgeCls,
                            )}
                          >
                            {style.label}
                          </span>
                        </div>
                        {row.confirmDelete ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => deleteRow(selectedOrder, row)}
                              className="min-h-10 rounded bg-alert px-3 text-xs font-bold text-white"
                            >
                              削除する
                            </button>
                            <button
                              type="button"
                              onClick={() => patchRow(selectedOrder.id, row.id, { confirmDelete: false })}
                              className="min-h-10 rounded px-3 text-xs text-ink-soft hover:bg-bg-soft"
                            >
                              やめる
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => patchRow(selectedOrder.id, row.id, { confirmDelete: true })}
                            disabled={row.saving}
                            aria-label={`${row.productName} の行を削除`}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-alert-bg/40 hover:text-alert"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[10rem] flex-1">
                          <label
                            htmlFor={`pack-${row.id}`}
                            className={cn('mb-1 block text-xs font-bold', needsPack ? 'text-alert' : 'text-ink-soft')}
                          >
                            荷姿{needsPack ? '（選んでください）' : ''}
                          </label>
                          {row.packConfigOptions.length > 0 ? (
                            <select
                              id={`pack-${row.id}`}
                              value={row.packConfigId ?? ''}
                              disabled={row.saving}
                              onChange={(e) => savePackConfig(selectedOrder, row, e.target.value)}
                              className={cn(
                                'h-10 w-full rounded border bg-bg-card px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-trust-100',
                                needsPack ? 'border-alert bg-alert-bg/30 font-bold text-alert' : 'border-line-strong',
                              )}
                            >
                              <option value="">荷姿を選ぶ（必須）</option>
                              {row.packConfigOptions.map((pc) => (
                                <option key={pc.id} value={pc.id}>
                                  {pc.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <p id={`pack-${row.id}`} className="flex h-10 items-center text-sm text-ink-soft">
                              標準（{breakdown.packsPerCase}入）
                            </p>
                          )}
                        </div>
                        <div>
                          <label htmlFor={`qty-${row.id}`} className="mb-1 block text-xs font-bold text-ink-soft">
                            数量
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              id={`qty-${row.id}`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={row.draftQty}
                              disabled={row.saving}
                              onChange={(e) => patchRow(selectedOrder.id, row.id, { draftQty: e.target.value })}
                              onBlur={() => saveQuantity(selectedOrder, row)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                              aria-describedby={anomaly ? `anomaly-${row.id}` : undefined}
                              className={cn(
                                'num h-10 w-24 rounded border bg-bg-card px-2.5 text-right font-mono text-base font-bold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-trust-100',
                                anomaly ? 'border-alert' : style.inputCls,
                              )}
                            />
                            <span className="text-sm text-ink-soft">{row.unit}</span>
                          </div>
                        </div>
                      </div>

                      {anomaly && row.usualQuantity != null && (
                        <p
                          id={`anomaly-${row.id}`}
                          className="flex items-start gap-1.5 rounded-md bg-alert-bg px-2.5 py-1.5 text-sm font-bold text-alert"
                          role="note"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            いつもは{Math.round(row.usualQuantity)}
                            {row.unit}前後です（{anomaly === 'high' ? '多すぎ' : '少なすぎ'}）。原本を確認してください。
                          </span>
                        </p>
                      )}

                      <p className="num text-xs text-ink-soft">
                        <strong className="font-mono text-ink">{breakdown.boxes}箱</strong>
                        <span className="ml-1">
                          （{breakdown.cases}ケース{breakdown.remainder > 0 ? `＋端数${breakdown.remainder}${row.unit}` : ''}・
                          {breakdown.packsPerCase}入）
                        </span>
                        <span className="ml-2 font-medium text-earth-700">{breakdown.containerType}</span>
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* 自然言語でAIに直してもらう（今後の読み方も覚えさせる） */}
            <div className="rounded-lg border border-line bg-bg-soft/70 p-3">
              <label htmlFor="ai-revision-input" className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <MessageSquarePlus className="h-3.5 w-3.5 text-trust-600" aria-hidden />
                AIに言葉で直してもらう
              </label>
              <p className="mt-0.5 text-xs text-ink-soft">
                例:「数量を240Pに直して」「今後は〇〇を△△と読むようにして」。今後も使える直し方は、AI学習ルールに自動で追加されます。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="ai-revision-input"
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAiRevision()}
                  placeholder="直したい内容を入力"
                  disabled={revisingByAi}
                  className="h-10 min-w-0 flex-1 basis-48 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
                />
                <Button variant="secondary" size="sm" className="h-10" onClick={handleAiRevision} isLoading={revisingByAi}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  AIで直す
                </Button>
              </div>
            </div>
          </div>

          {/* 承認（納品日・納入先・荷姿のゲートと、いつもと違う数量の確認はボタン側） */}
          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
            <Link
              href="/admin/rules"
              className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-trust-700 hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI学習ルールを見る
            </Link>

            {currentRows.length > 0 && (
              <ApproveOrderButton
                key={selectedOrder.id}
                orderId={selectedOrder.id}
                needsDeliveryDate={selectedOrder.needsDeliveryDate}
                needsDestination={selectedOrder.needsDestination}
                destinationOptions={selectedOrder.destinationOptions}
                destinationHint={selectedOrder.destinationHint}
                missingPackProducts={missingPack}
                anomalies={approveAnomalies}
                label="承認する"
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
        title="取引先ルールをAIに覚えさせる"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRuleModalOpen(false)} disabled={savingRule}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={handleSaveLearnedRule} isLoading={savingRule}>
              <Check className="h-4 w-4" aria-hidden />
              保存して覚えさせる
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink-soft">
            保存したルールは「AI学習ルール」に登録され、次からのFAX・メールの読み取りに使われます。
          </p>
          <div>
            <label htmlFor="learn-client-name" className="mb-1 block text-xs font-medium text-ink-soft">
              対象の取引先 <span className="text-alert">*</span>
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
              覚えさせるルール <span className="text-alert">*</span>
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
        title="注文をまとめて承認"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkConfirmModalOpen(false)} disabled={bulkApproving}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              onClick={executeBulkApprove}
              isLoading={bulkApproving}
              className="gap-1.5 bg-forest-600 hover:bg-forest-700"
            >
              <Zap className="h-4 w-4 text-earth-100" aria-hidden />
              {bulkTargetOrders.length}件を承認する
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-soft">
            次の <strong className="font-bold text-ink">{bulkTargetOrders.length} 件</strong>{' '}
            を承認して、収穫・パックの予定に入れます。確認が必要な注文は承認されずに残ります。
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-bg-soft p-2.5 text-xs">
            {bulkTargetOrders.map((o) => {
              const warns = pendingReasons(o, { kana: false })
              return (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 pb-1.5 last:border-none"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ColorDot color={o.customerColor} name={o.customerName} size="sm" />
                    <span className="min-w-0 break-words">
                      <span className="font-bold text-ink">{o.customerName}</span>
                      {o.destinationName && <span className="text-ink-soft"> ＞ {o.destinationName}</span>}
                    </span>
                    <span className="whitespace-nowrap font-mono text-ink-faint">
                      ({o.deliveryDate ? formatJpDateShort(o.deliveryDate) : '納品日未定'})
                    </span>
                  </div>
                  {warns.length > 0 ? (
                    <span className="min-w-0 rounded bg-alert-bg px-1.5 py-0.5 text-xs font-bold text-alert">
                      {warns.join('、')}
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded bg-forest-100 px-1.5 py-0.5 text-xs font-bold text-forest-700">
                      確認不要
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
