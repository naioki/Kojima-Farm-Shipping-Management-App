'use client'

import { useEffect, useState } from 'react'

/**
 * このブラウザが PDF をその場（iframe/直接ナビゲーション）で描画できるか判定する。
 * 多くのモバイルブラウザは内蔵PDFビューアを持たず、iframeが「OPEN」ボタンだけの
 * 空白になる（外部アプリに投げるだけで中身が見えない）。
 *
 * navigator.pdfViewerEnabled（Chrome 94+ / Firefox / Safari 16.4+）が使えればそれを直接使う。
 * 無いブラウザは画面幅でフォールバック（狭いデスクトップや広いAndroidタブレットでは
 * 幅だけの判定だとズレるため、あくまで次善策）。
 * SSR/初回描画時は null（未判定）を返す＝判定が付くまでは「見せない」安全側に倒す。
 */
export function usePdfViewableInline(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null)

  useEffect(() => {
    const nav = navigator as Navigator & { pdfViewerEnabled?: boolean }
    if (typeof nav.pdfViewerEnabled === 'boolean') {
      setSupported(nav.pdfViewerEnabled)
    } else {
      setSupported(window.matchMedia('(min-width: 768px)').matches)
    }
  }, [])

  return supported
}
