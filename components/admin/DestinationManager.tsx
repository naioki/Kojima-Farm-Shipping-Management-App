'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

export interface Destination {
  id: string
  code: string | null
  full_name: string
  aliases: string[]
  is_active: boolean
}

interface Props {
  customerId: string
  customerName: string
  initial: Destination[]
}

const fieldCls =
  'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

/**
 * 納入先の登録・編集（取引先の配下）。
 * 表示は常に「取引先 ＞ 納入先(略称)」。略称＝普段の表示、正式名＝伝票、aliases＝OCR名寄せ。
 */
export function DestinationManager({ customerId, customerName, initial }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<Destination[]>(initial)
  const [savingId, setSavingId] = useState<string | null>(null)

  // 新規入力
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [aliases, setAliases] = useState('')
  const [adding, setAdding] = useState(false)

  async function addDestination() {
    if (fullName.trim() === '') { toast.error('正式名を入力してください'); return }
    setAdding(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          code: code.trim() || null,
          full_name: fullName.trim(),
          aliases: aliases.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { destination?: Destination; error?: string }
      if (!res.ok || !json.destination) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      setRows((p) => [...p, json.destination!])
      setCode(''); setFullName(''); setAliases('')
      toast.success('納入先を登録しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  function patchRow(id: string, field: keyof Destination, value: string | string[] | boolean) {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  async function saveRow(row: Destination) {
    if (row.full_name.trim() === '') { toast.error('正式名は必須です'); return }
    setSavingId(row.id)
    try {
      const res = await fetch(`/api/destinations/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: row.code?.trim() || null,
          full_name: row.full_name.trim(),
          aliases: row.aliases,
          is_active: row.is_active,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)
      toast.success('保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRow(id: string) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/destinations/${id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `削除失敗 (${res.status})`)
      setRows((p) => p.filter((r) => r.id !== id))
      toast.success('削除しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setSavingId(null)
      router.refresh()
    }
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-line px-3 py-4 text-center text-sm text-ink-faint">
          納入先は未登録です。複数の届け先がある取引先（例: 仲卸）はここで登録してください。
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={cn(
                'rounded-lg border border-line bg-bg-card p-3',
                !r.is_active && 'opacity-60',
              )}
            >
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-ink-soft">
                <MapPin className="h-3.5 w-3.5 text-earth-500" aria-hidden />
                {customerName} <span className="text-ink-faint">＞</span>{' '}
                <span className="text-ink">{r.code?.trim() || r.full_name}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-ink-faint">略称（表示用）</span>
                  <input value={r.code ?? ''} onChange={(e) => patchRow(r.id, 'code', e.target.value)} className={fieldCls} placeholder="例: マルタ" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-ink-faint">正式名（伝票）</span>
                  <input value={r.full_name} onChange={(e) => patchRow(r.id, 'full_name', e.target.value)} className={fieldCls} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-ink-faint">表記ゆれ（カンマ区切り）</span>
                  <input
                    value={r.aliases.join(', ')}
                    onChange={(e) => patchRow(r.id, 'aliases', e.target.value.split(/[,、]+/).map((s) => s.trim()).filter(Boolean))}
                    className={fieldCls}
                    placeholder="OCRの別表記"
                  />
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <input type="checkbox" checked={r.is_active} onChange={(e) => patchRow(r.id, 'is_active', e.target.checked)} />
                  有効
                </label>
                <div className="flex gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => deleteRow(r.id)} disabled={savingId === r.id}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    削除
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => saveRow(r)} isLoading={savingId === r.id} disabled={savingId === r.id}>
                    <Save className="h-3.5 w-3.5" aria-hidden />
                    保存
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新規追加 */}
      {!adding ? (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          納入先を追加
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-earth-200 bg-earth-50 p-3">
          <p className="text-xs font-semibold text-earth-700">{customerName} ＞ 新しい納入先</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={code} onChange={(e) => setCode(e.target.value)} className={fieldCls} placeholder="略称（例: マルタ）" />
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldCls} placeholder="正式名（必須）" />
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} className={fieldCls} placeholder="表記ゆれ（カンマ区切り・任意）" />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={adding}>取消</Button>
            <Button variant="primary" size="sm" onClick={addDestination} isLoading={adding} disabled={adding}>登録</Button>
          </div>
        </div>
      )}
    </div>
  )
}
