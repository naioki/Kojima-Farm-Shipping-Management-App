'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

/** 取引先の新規追加（Laravel版 画面5）。名前＋カナを入れて1件追加。 */
export function AddCustomerForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (name.trim() === '') {
      toast.error('取引先名を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, name_kana: kana || null }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `追加に失敗 (${res.status})`)
      }
      toast.success('取引先を追加しました')
      setName('')
      setKana('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Input label="取引先名" placeholder="マルショク青果" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="カナ" placeholder="マルショクセイカ" value={kana} onChange={(e) => setKana(e.target.value)} />
      <Button onClick={submit} isLoading={submitting} size="lg">
        <Plus className="h-4 w-4" aria-hidden />
        追加
      </Button>
    </div>
  )
}
