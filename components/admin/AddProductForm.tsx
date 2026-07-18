'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

/**
 * 品目の追加（新モデル）。品目＝WHAT（基準単位）。
 * 荷姿（多形態）と価格は「価格・荷姿」マスタ（pack_configs / price_rules）で管理する。
 * 税率は 8（農産物・軽減）/10（資材・送料）のみ（tax.md）。
 */
export function AddProductForm({ categories = [] }: { categories?: string[] }) {
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [baseUnit, setBaseUnit] = useState('個')
  const [category, setCategory] = useState('')
  const [taxRate, setTaxRate] = useState('8')
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
          base_unit: baseUnit || '個',
          category: category.trim() || null,
          default_tax_rate: Number(taxRate),
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `追加に失敗 (${res.status})`)
      }
      toast.success('品目を追加しました')
      setName('')
      setKana('')
      setBaseUnit('個')
      setCategory('')
      setTaxRate('8')
      // ページ側で一覧を再取得
      window.location.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="品目名" placeholder="トマトバラ" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="カナ" placeholder="トマトバラ" value={kana} onChange={(e) => setKana(e.target.value)} />
        <Input
          label="品目グループ"
          hint="選択メニューでまとめる分類（例: トマト）。空欄可＝「その他」"
          placeholder="トマト"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="product-category-list"
        />
        <datalist id="product-category-list">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Input
          label="基準単位"
          hint="個 / 本 / 束 / kg。在庫・集計の基準"
          placeholder="個"
          value={baseUnit}
          onChange={(e) => setBaseUnit(e.target.value)}
        />
        <Select
          label="税率"
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value)}
          options={[
            { value: '8', label: '8%（農産物・軽減）' },
            { value: '10', label: '10%（資材・送料）' },
          ]}
        />
      </div>
      <p className="rounded border border-line bg-bg-soft px-3 py-2 text-xs text-ink-soft">
        荷姿（ケース・箱・スタンドパック等）と単価は
        <Link href="/admin/pricing-master" className="mx-1 font-medium text-trust-600 hover:underline">
          価格・荷姿
        </Link>
        で管理します。「トマト（箱）」のように荷姿違いを別品目にせず、1品目＋複数荷姿で登録してください。
      </p>
      <Button onClick={submit} isLoading={submitting} size="lg">
        <Plus className="h-4 w-4" aria-hidden />
        品目を追加
      </Button>
    </div>
  )
}
