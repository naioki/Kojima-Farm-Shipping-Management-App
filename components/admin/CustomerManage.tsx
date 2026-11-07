'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, Building2, FileText, MapPinOff, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ConfirmModal } from '@/components/ui/Modal'
import {
  resolveDefaultIssuerPreset,
  isDriverDeliveryNoteCustomer,
  type IssuerPreset,
} from '@/lib/delivery-notes/driver-note'
import { skipsDestinationGate, paymentScheduleOf, hasPaymentSchedule } from '@/lib/customers/settings'
import {
  CLOSING_CHOICES,
  PAY_DAY_CHOICES,
  PAY_MONTH_CHOICES,
  PAY_MONTH_LABEL,
  dayLabel,
  parsePaymentSchedule,
  paymentScheduleLabel,
  type DayOfMonth,
  type PaymentSchedule,
} from '@/lib/customers/payment-terms'

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
  const [schedule, setSchedule] = useState<PaymentSchedule>(() => paymentScheduleOf(customer.channel_identifiers))
  // 触ったときだけ送る（未設定の取引先で他の項目を保存しても、請求書の表記を勝手に書き換えない）
  const [scheduleDirty, setScheduleDirty] = useState(false)
  const scheduleSaved = hasPaymentSchedule(customer.channel_identifiers)
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

  function updateSchedule(patch: Record<string, string>) {
    setSchedule((cur) => parsePaymentSchedule({ ...cur, ...patch }))
    setScheduleDirty(true)
  }

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
          ...(scheduleDirty ? { payment_schedule: schedule } : {}),
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
      setScheduleDirty(false)
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

      {/* お支払条件（締め日・支払日）。請求書の支払期日と期日超過の判定に使う */}
      <div className="space-y-3 rounded-xl border border-line bg-bg-soft p-3.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <CalendarClock className="h-4 w-4 text-earth-700" aria-hidden />
            お支払条件
          </p>
          <p className="text-xs text-ink-soft">
            請求書を作るとき、この条件で支払期日を決めます。期日を過ぎた未入金の判定にも使います。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="締め日"
            value={dayValue(schedule.closing)}
            onChange={(e) => updateSchedule({ closing: e.target.value })}
            options={dayOptions(CLOSING_CHOICES, schedule.closing, '月末')}
          />
          <Select
            label="支払月"
            value={String(schedule.pay_month_offset)}
            onChange={(e) => updateSchedule({ pay_month_offset: e.target.value })}
            options={PAY_MONTH_CHOICES.map((m) => ({ value: String(m), label: PAY_MONTH_LABEL[m] }))}
          />
          <Select
            label="支払日"
            value={dayValue(schedule.pay_day)}
            onChange={(e) => updateSchedule({ pay_day: e.target.value })}
            options={dayOptions(PAY_DAY_CHOICES, schedule.pay_day, '末日')}
          />
        </div>
        <div className="space-y-0.5 text-sm">
          <p className="text-ink">
            請求書の表記: <strong className="font-bold">{scheduleDirty ? paymentScheduleLabel(schedule) : customer.payment_terms || paymentScheduleLabel(schedule)}</strong>
          </p>
          {scheduleDirty && <p className="text-xs font-bold text-warning">保存すると、この表記と支払期日の判定が変わります。</p>}
          {!scheduleSaved && !scheduleDirty && (
            <p className="text-xs text-ink-soft">まだ選ばれていません。月末締め・翌月末払いとして期日を判定しています。</p>
          )}
        </div>
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

function dayValue(d: DayOfMonth): string {
  return d === 'eom' ? 'eom' : String(d)
}

/** 選択肢。保存値が選択肢に無い日（例: 18日）でも、そのまま表示・保持できるよう足す */
function dayOptions(choices: DayOfMonth[], current: DayOfMonth, eomWord: '月末' | '末日') {
  const list = choices.includes(current) ? choices : [...choices, current]
  return list.map((d) => ({ value: dayValue(d), label: dayLabel(d, eomWord) }))
}
