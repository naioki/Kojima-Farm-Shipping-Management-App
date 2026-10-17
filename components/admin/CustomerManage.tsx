'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/Modal'

export interface CustomerManageProps {
  customer: {
    id: string
    name: string
    name_kana: string | null
    payment_terms: string | null
    is_active: boolean
  }
}

/**
 * 取引先の管理（情報編集・有効/無効・削除）。
 * 削除は未使用の取引先のみ。使用中（注文・請求書・取引ルール・納品書）は履歴保護のため不可で、
 * 「有効」オフ（非表示化）に誘導する。
 */
export function CustomerManage({ customer }: CustomerManageProps) {
  const router = useRouter()
  const [name, setName] = useState(customer.name)
  const [kana, setKana] = useState(customer.name_kana ?? '')
  const [terms, setTerms] = useState(customer.payment_terms ?? '')
  const [active, setActive] = useState(customer.is_active)
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
        body: JSON.stringify({ name, name_kana: kana || null, payment_terms: terms || null, is_active: active }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      toast.success('保存しました')
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
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        toast.error(j.message ?? '使用中のため削除できません。「有効」をオフにしてください。', { duration: 6000 })
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗 (${res.status})`)
      }
      toast.success('取引先を削除しました')
      router.push('/admin/customers')
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
        message={`「${customer.name}」を削除します。注文・請求書・取引ルール・納品書で使われている取引先は削除できません（その場合は「有効」をオフにして非表示にしてください）。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
