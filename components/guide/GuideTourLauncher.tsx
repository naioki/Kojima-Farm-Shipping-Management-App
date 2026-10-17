'use client'

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { GuideTour } from '@/components/guide/GuideTour'
import type { GuideTour as GuideTourDef } from '@/lib/guide/tours'

/**
 * ヘッダーの「？」ボタン＋ツアー本体をまとめたクライアント部品。
 * サーバーコンポーネントのページからは <GuideTourLauncher tour={SHIPMENTS_TOUR} /> を
 * 置くだけでよい（初回自動開始＋再表示導線の両方をここで持つ）。
 */
export function GuideTourLauncher({ tour }: { tour: GuideTourDef }) {
  const [replay, setReplay] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setReplay(true)}
        aria-label="操作ガイド"
        title="操作ガイド"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
      >
        <HelpCircle className="h-5 w-5" aria-hidden />
      </button>
      <GuideTour tour={tour} forceOpen={replay} onForceOpenHandled={() => setReplay(false)} />
    </>
  )
}
