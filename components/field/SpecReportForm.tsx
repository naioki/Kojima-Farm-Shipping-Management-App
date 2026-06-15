'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, X, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

const MAX_PHOTO_MB = 8

interface Option {
  id: string
  name: string
}

/**
 * 規格の現場報告フォーム（やさしい日本語＋アイコン）。
 * 「どの取引先・どの商品が・どう変わったか」を写真＋メモで送る。直接マスタは変えない。
 */
export function SpecReportForm({ customers, products }: { customers: Option[]; products: Option[] }) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [productId, setProductId] = useState('')
  const [note, setNote] = useState('')
  const [photoBase64, setPhotoBase64] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoMime, setPhotoMime] = useState('image/jpeg')
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handlePhoto(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('しゃしんを えらんでください')
      return
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      toast.error(`しゃしんは ${MAX_PHOTO_MB}MB までです`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPhotoPreview(dataUrl)
      setPhotoBase64(dataUrl.slice(dataUrl.indexOf(',') + 1))
      setPhotoMime(file.type)
    }
    reader.readAsDataURL(file)
  }

  function clearPhoto() {
    setPhotoBase64(null)
    setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (note.trim() === '') {
      toast.error('なにが かわったか かいてください')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/spec-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId || undefined,
          product_id: productId || undefined,
          note,
          photoBase64: photoBase64 ?? undefined,
          photoMimeType: photoBase64 ? photoMime : undefined,
        }),
      })
      const json = (await res.json()) as { id?: string; error?: string; warning?: string }
      if (!res.ok) throw new Error(json.error ?? `そうしん できませんでした (${res.status})`)
      if (json.warning) toast(json.warning, { icon: '⚠️' })
      toast.success('ほうこく しました。ありがとうございます')
      router.push('/field/shipments')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'そうしん できませんでした')
    } finally {
      setSending(false)
    }
  }

  const fieldCls =
    'h-12 w-full rounded-lg border border-line-strong bg-bg-card px-3 text-base text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="sr-customer" className="text-sm font-medium text-ink">
          とりひきさき（わかれば）
        </label>
        <select id="sr-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls}>
          <option value="">えらばない</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="sr-product" className="text-sm font-medium text-ink">
          しょうひん（わかれば）
        </label>
        <select id="sr-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldCls}>
          <option value="">えらばない</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="sr-note" className="text-sm font-medium text-ink">
          なにが かわった？ <span className="text-alert">＊</span>
        </label>
        <textarea
          id="sr-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="れい：はこが 大きく なった／ラベルが かわった"
          className={cn(fieldCls, 'h-auto py-2.5')}
        />
      </div>

      {/* 写真（任意・カメラ起動） */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink">しゃしん（あれば）</span>
        {photoPreview ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="" className="max-h-60 rounded-lg border border-line" />
            <button
              type="button"
              onClick={clearPhoto}
              aria-label="しゃしんを けす"
              className="absolute -right-2 -top-2 rounded-full bg-alert p-1 text-white shadow-md"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line py-8 text-ink-soft hover:border-earth-400 hover:bg-bg-soft"
          >
            <Camera className="h-8 w-8" aria-hidden />
            <span className="text-sm font-medium">しゃしんを とる / えらぶ</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handlePhoto(f)
          }}
        />
      </div>

      <Button variant="primary" size="lg" onClick={submit} isLoading={sending} disabled={note.trim() === ''}>
        <Send className="h-4 w-4" aria-hidden />
        ほうこく する
      </Button>
    </div>
  )
}
