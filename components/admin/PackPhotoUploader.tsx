'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { downscaleImage } from '@/lib/image/downscale'
import type { PackPhotoKind } from '@/types/database'

interface PhotoRow { id: string; kind: PackPhotoKind }

const MAX_PHOTOS = 4

/** downscale の dataUrl(JPEG) を multipart 送信用の File にする。 */
function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

/**
 * 荷姿の作業写真アップローダ（管理者）。最大4枚。完成見本/注意点を選んで追加する。
 * アップロード前にクライアント側で縮小・圧縮（長辺1280px・JPEG0.75）— 無料枠運用のため必須。
 */
export function PackPhotoUploader({ packConfigId }: { packConfigId: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<PackPhotoKind>('finish')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/pack-configs/${packConfigId}/photos`)
        if (!res.ok) throw new Error()
        const j = (await res.json()) as { photos: PhotoRow[] }
        if (alive) setPhotos(j.photos ?? [])
      } catch {
        if (alive) toast.error('写真の読み込みに失敗しました')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [packConfigId])

  async function onPick(file: File) {
    if (photos.length >= MAX_PHOTOS) {
      toast.error(`写真は最大${MAX_PHOTOS}枚までです`)
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.error('画像を選んでください')
      return
    }
    setUploading(true)
    try {
      const down = await downscaleImage(file, { maxDim: 1280, quality: 0.75 })
      const form = new FormData()
      form.append('file', dataUrlToFile(down.dataUrl, 'pack.jpg'))
      form.append('kind', kind)
      const res = await fetch(`/api/pack-configs/${packConfigId}/photos`, { method: 'POST', body: form })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `アップロード失敗 (${res.status})`)
      }
      const j = (await res.json()) as { photo: PhotoRow }
      setPhotos((ps) => [...ps, j.photo])
      toast.success('写真を追加しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(id: string) {
    if (!confirm('この写真を削除しますか？')) return
    const res = await fetch(`/api/pack-photos/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setPhotos((ps) => ps.filter((p) => p.id !== id))
      toast.success('削除しました')
    } else {
      toast.error('削除に失敗しました')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-soft">作業写真（最大{MAX_PHOTOS}枚）</span>
        <span className="num text-xs text-ink-faint tabular-nums">{photos.length}/{MAX_PHOTOS}</span>
      </div>

      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          読み込み中…
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div
              key={p.id}
              className={cn('relative h-20 w-20 overflow-hidden rounded border', p.kind === 'caution' ? 'border-alert/50' : 'border-line')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/pack-photos/${p.id}`} alt={p.kind === 'caution' ? '注意点' : '完成見本'} className="h-full w-full object-cover" loading="lazy" />
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 text-center text-[9px] font-medium leading-tight text-white',
                  p.kind === 'caution' ? 'bg-alert/80' : 'bg-harvest-600/80',
                )}
              >
                {p.kind === 'caution' ? '注意' : '見本'}
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label="写真を削除"
                className="absolute right-0.5 top-0.5 rounded bg-black/50 p-0.5 text-white hover:bg-black/70"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {photos.length < MAX_PHOTOS && (
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PackPhotoKind)}
            aria-label="写真の種別"
            className="h-11 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
          >
            <option value="finish">完成見本</option>
            <option value="caution">注意点</option>
          </select>
          <label
            className={cn(
              'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-line text-sm text-ink-soft hover:border-earth-400 hover:text-ink',
              uploading && 'pointer-events-none opacity-60',
            )}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            {uploading ? '処理中…' : '写真を追加'}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onPick(f)
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
