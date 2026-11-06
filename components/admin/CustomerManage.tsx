'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, Building2, FileText, MapPinOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/Modal'
import {
  resolveDefaultIssuerPreset,
  isDriverDeliveryNoteCustomer,
  type IssuerPreset,
} from '@/lib/delivery-notes/driver-note'
import { skipsDestinationGate } from '@/lib/customers/settings'

export interface CustomerManageProps {
  customer: {
    id: string
    name: string
    name_kana: string | null
    payment_terms: string | null
    is_active: boolean
    channel_identifiers?: Record<string, unknown> | null
  }
}

/**
 * 取引先の管理（情報編集・納品書名義設定・有効/無効・削除）。
 * 未使用の取引先は付随ルールごと物理削除し、過去の注文・請求書がある取引先は自動的に非表示（無効化）にする。
 */
export function CustomerManage({ customer }: CustomerManageProps) {
  const router = useRouter()
  const [name, setName] = useState(customer.name)
  const [kana, setKana] = useState(customer.name_kana ?? '')
  const [terms, setTerms] = useState(customer.payment_terms ?? '')
  const [active, setActive] = useState(customer.is_active)
  const [issuerPreset, setIssuerPreset] = useState<IssuerPreset>(() =>
    resolveDefaultIssuerPreset(customer.name, customer.channel_identifiers),
  )
  const [requiresDeliveryNote, setRequiresDeliveryNote] = useState<boolean>(() =>
    isDriverDeliveryNoteCustomer(customer.name, customer.channel_identifiers),
  )
  const [skipDestGate, setSkipDestGate] = useState<boolean>(() =>
    skipsDestinationGate(customer.channel_identifiers),
  )
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save() {
    if (name.trim() === '') {
      toast.error('取引先名は必須です')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          name_kana: kana || null,
          payment_terms: terms || null,
          is_active: active,
          issuer_preset: issuerPreset,
          requires_delivery_note: requiresDeliveryNote,
          skip_destination_gate: skipDestGate,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      toast.success('取引先設定を保存しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? `削除に失敗 (${res.status})`)
      }
      const j = (await res.json().catch(() => ({}))) as { message?: string }
      toast.success(j.message ?? '取引先を削除しました')
      router.push('/admin/customers')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="取引先名" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="ふりがな" value={kana} onChange={(e) => setKana(e.target.value)} />
        <Input label="支払条件" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="月末締め翌月末払い 等" />
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-earth-600"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-sm text-ink">有効（オフで一覧・選択肢から非表示）</span>
        </label>
      </div>

      {/* 📄 納品書の発行元名義 ＆ 運転手渡し対象設定 */}
      <div className="rounded-xl border border-harvest-400 bg-harvest-50/50 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-black text-forest-900">
            <Building2 className="h-4 w-4 text-harvest-700" />
            <span>納品書の発行元名義（デフォルト）</span>
          </div>
          <div className="inline-flex rounded-lg border border-harvest-400 bg-bg-card p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setIssuerPreset('kojima')}
              className={
                issuerPreset === 'kojima'
                  ? 'rounded-md bg-harvest-700 px-3 py-1 text-xs font-black text-white'
                  : 'rounded-md px-3 py-1 text-xs font-bold text-ink-soft hover:bg-bg-soft'
              }
            >
              小島農園
            </button>
            <button
              type="button"
              onClick={() => setIssuerPreset('iplus')}
              className={
                issuerPreset === 'iplus'
                  ? 'rounded-md bg-harvest-700 px-3 py-1 text-xs font-black text-white'
                  : 'rounded-md px-3 py-1 text-xs font-bold text-ink-soft hover:bg-bg-soft'
              }
            >
              株式会社アイプラス
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-harvest-700"
            checked={requiresDeliveryNote}
            onChange={(e) => setRequiresDeliveryNote(e.target.checked)}
          />
          <span className="text-xs font-bold text-ink flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 text-harvest-700" />
            <span>運転手渡し納品書の対象にする（積込リスト・帳票印刷画面に「📄 納品書PDF」ボタンを表示）</span>
          </span>
        </label>
      </div>

      {/* 📍 承認時の納入先チェック */}
      <label className="flex items-start gap-2 rounded-xl border border-line bg-bg-soft p-3.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-earth-600"
          checked={skipDestGate}
          onChange={(e) => setSkipDestGate(e.target.checked)}
        />
        <span className="space-y-0.5">
          <span className="flex items-center gap-1 text-xs font-bold text-ink">
            <MapPinOff className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
            納入先を指定しない取引先にする（承認時の納入先チェックを飛ばす）
          </span>
          <span className="block text-xs text-ink-soft">
            オンにすると、納入先が複数登録されていても、納入先が決まらない注文を「納入先なし（取引先あて）」のまま承認できます。
          </span>
        </span>
      </label>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <Button onClick={save} isLoading={saving} size="sm">
          <Check className="h-4 w-4" aria-hidden />
          保存
        </Button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm font-medium text-ink-faint hover:border-alert hover:bg-alert/5 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          この取引先を削除
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
        title="取引先を削除しますか？"
        message={`「${customer.name}」を削除します。過去の注文・請求書がある取引先は履歴保護のため自動的に非表示（無効化）になります。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
