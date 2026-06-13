'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 商品（品目）の追加（設定から追加）。週間マトリックスの品目タブ・スマート追加に反映される。
 * 税率は 8（農産物・軽減）/10（資材・送料）のみ（tax.md）。
 */
export function AddProductForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [unit, setUnit] = useState('個')
  const [taxRate, setTaxRate] = useState('8')
  const [capacity, setCapacity] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (name.trim() === '') {
      toast.error('品目名を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          name_kana: kana || null,
          unit: unit || '個',
          default_tax_rate: Number(taxRate),
          container_capacity: numOrNull(capacity),
          default_unit_price: numOrNull(price),
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `追加に失敗 (${res.status})`)
      }
      toast.success('品目を追加しました')
      setName('')
      setKana('')
      setUnit('個')
      setTaxRate('8')
      setCapacity('')
      setPrice('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Input label="品目名" placeholder="トマト" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="カナ" placeholder="トマト" value={kana} onChange={(e) => setKana(e.target.value)} />
      <Input label="単位" placeholder="個 / 本 / 束" value={unit} onChange={(e) => setUnit(e.target.value)} />
      <Select
        label="税率"
        value={taxRate}
        onChange={(e) => setTaxRate(e.target.value)}
        options={[
          { value: '8', label: '8%（農産物・軽減）' },
          { value: '10', label: '10%（資材・送料）' },
        ]}
      />
      <Input
        label="コンテナ容量"
        hint="総数→コンテナ分解に使用"
        inputMode="numeric"
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
      />
      <Input
        label="既定単価"
        inputMode="numeric"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <div className="sm:col-span-2 lg:col-span-3">
        <Button onClick={submit} isLoading={submitting} size="lg">
          <Plus className="h-4 w-4" aria-hidden />
          品目を追加
        </Button>
      </div>
    </div>
  )
}
