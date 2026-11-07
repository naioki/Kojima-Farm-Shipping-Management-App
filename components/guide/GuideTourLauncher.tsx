'use client'

import { useCallback, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { GuideTour } from '@/components/guide/GuideTour'
import { useFieldLang } from '@/lib/field/lang-context'
import { GUIDE_UI_LABELS, type GuideTour as GuideTourDef } from '@/lib/guide/tours'

/**
 * ヘッダーの「使い方」ボタン＋ツアー本体をまとめたクライアント部品。
 * サーバーコンポーネントのページからは <GuideTourLauncher tour={SHIPMENTS_TOUR} /> を
 * 置くだけでよい（初回自動開始＋再表示導線の両方をここで持つ）。
 * 共用タブレットでは自動表示が新しい人に届かないため、文字付きの目立つボタンにしている。
 */
export function GuideTourLauncher({ tour }: { tour: GuideTourDef }) {
  const [replay, setReplay] = useState(false)
  const { langMode } = useFieldLang()
  const label = GUIDE_UI_LABELS[langMode].open
  const handled = useCallback(() => setReplay(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setReplay(true)}
        title={label}
        className="inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border-2 border-trust-400 bg-trust-50 px-2.5 text-sm font-black text-trust-700 shadow-2xs hover:bg-trust-100 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400"
      >
        <HelpCircle className="h-5 w-5 shrink-0" aria-hidden />
        <span>{label}</span>
      </button>
      <GuideTour tour={tour} forceOpen={replay} onForceOpenHandled={handled} />
    </>
  )
}
