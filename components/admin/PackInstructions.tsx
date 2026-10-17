'use client'

import { useState } from 'react'
import {
  IdCard,
  Sticker,
  Tag,
  Ticket,
  RefreshCw,
  Snowflake,
  Pin,
  StickyNote,
  Ruler,
  ImageOff,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import type { PackPhotoKind } from '@/types/database'

export interface PackInstructionValues {
  spec_note?: string | null
  has_card?: boolean | null
  has_seal?: boolean | null
  tape_color?: string | null
  label_spec?: string | null
  price_tag_required?: boolean | null
  returnable_container?: boolean | null
  quality_note?: string | null
  standing_notes?: string | null
  field_memo?: string | null
}

export interface PackInstructionPhoto {
  id: string
  kind: PackPhotoKind
}

/** true/false/未設定（null）を「あり／なし／表示しない」に振り分ける。NULL=未設定は行を出さない。 */
function boolBadge(
  value: boolean | null | undefined,
  onLabel: string,
  offLabel: string,
): { text: string; on: boolean } | null {
  if (value == null) return null
  return value ? { text: onLabel, on: true } : { text: offLabel, on: false }
}

/**
 * 荷姿の作業指示（値駆動表示）。値が入っている項目だけをバッジ/行として出す。
 * - variant='field'    … 現場画面（field_memo を表示、standing_notes も表示）
 * - variant='document' … 帳票・admin（standing_notes を表示、field_memo は出さない）
 * 写真は横スクロールのサムネイル帯＋タップで拡大モーダル（複数枚でも縦に伸びない）。
 */
export function PackInstructions({
  values,
  photos = [],
  variant = 'field',
  className,
}: {
  values: PackInstructionValues
  photos?: PackInstructionPhoto[]
  variant?: 'field' | 'document'
  className?: string
}) {
  const [zoom, setZoom] = useState<string | null>(null)

  const card = boolBadge(values.has_card, 'カードあり', 'カードなし')
  const seal = boolBadge(values.has_seal, 'シールあり', 'シールなし')
  const priceTag = boolBadge(values.price_tag_required, '値札あり', '値札なし')
  const returnable = boolBadge(values.returnable_container, '通い箱（返却）', '返却なし')

  const chips: { key: string; icon: typeof Tag; text: string; alert?: boolean }[] = []
  if (values.label_spec) chips.push({ key: 'label', icon: Tag, text: `ラベル: ${values.label_spec}` })
  if (values.tape_color) chips.push({ key: 'tape', icon: Pin, text: `テープ: ${values.tape_color}` })
  if (values.spec_note) chips.push({ key: 'spec', icon: Ruler, text: values.spec_note })
  if (card) chips.push({ key: 'card', icon: IdCard, text: card.text, alert: !card.on })
  if (seal) chips.push({ key: 'seal', icon: Sticker, text: seal.text, alert: !seal.on })
  if (priceTag) chips.push({ key: 'ptag', icon: Ticket, text: priceTag.text })
  if (returnable) chips.push({ key: 'ret', icon: RefreshCw, text: returnable.text })

  const showStanding = Boolean(values.standing_notes)
  const showQuality = Boolean(values.quality_note)
  const showFieldMemo = variant === 'field' && Boolean(values.field_memo)

  const hasAnything = chips.length > 0 || showStanding || showQuality || showFieldMemo || photos.length > 0
  if (!hasAnything) return null

  return (
    <div className={cn('space-y-2', className)}>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const Icon = c.icon
            return (
              <span
                key={c.key}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                  c.alert ? 'bg-alert/10 text-alert' : 'bg-bg-soft text-ink-soft',
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
                {c.text}
              </span>
            )
          })}
        </div>
      )}

      {showQuality && (
        <p className="flex items-start gap-1.5 rounded bg-warning-bg/40 px-2 py-1 text-xs font-medium text-warning">
          <Snowflake className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{values.quality_note}</span>
        </p>
      )}

      {showStanding && (
        <p className="flex items-start gap-1.5 rounded border border-line bg-bg-card/60 px-2 py-1 text-xs text-ink-soft">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-earth-500" aria-hidden />
          <span>{values.standing_notes}</span>
        </p>
      )}

      {showFieldMemo && (
        <p className="flex items-start gap-1.5 rounded border border-line bg-bg-soft px-2 py-1 text-xs text-ink-soft">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
          <span>{values.field_memo}</span>
        </p>
      )}

      {photos.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setZoom(p.id)}
              aria-label={p.kind === 'caution' ? '注意点の写真を拡大' : '完成見本の写真を拡大'}
              className={cn(
                'relative h-16 w-16 shrink-0 overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
                p.kind === 'caution' ? 'border-alert/50' : 'border-line',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/pack-photos/${p.id}`}
                alt={p.kind === 'caution' ? '注意点' : '完成見本'}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 text-center text-[9px] font-medium leading-tight text-white',
                  p.kind === 'caution' ? 'bg-alert/80' : 'bg-harvest-600/80',
                )}
              >
                {p.kind === 'caution' ? '注意' : '見本'}
              </span>
            </button>
          ))}
        </div>
      )}

      <Modal open={zoom != null} onClose={() => setZoom(null)} title="作業写真" className="max-w-lg">
        {zoom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/pack-photos/${zoom}`} alt="作業写真" className="mx-auto max-h-[70vh] w-auto rounded" />
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <ImageOff className="h-4 w-4" aria-hidden />
            表示できません
          </p>
        )}
      </Modal>
    </div>
  )
}
