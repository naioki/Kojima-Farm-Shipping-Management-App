import 'server-only'
import { Font } from '@react-pdf/renderer'

/**
 * @react-pdf 用の日本語フォント登録（CJK は既定 Helvetica では描画できないため必須）。
 * 既定は Google 提供の Noto Sans JP（otf）。設定 PDF_FONT_URL（regular）で差し替え可能。
 * 一度だけ登録する（多重登録回避）。サーバー専用。
 */

// jsDelivr 上の @expo-google-fonts/noto-sans-jp（ttf・Regular/Bold とも実在を確認済み）
const DEFAULT_REGULAR = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-jp/NotoSansJP_400Regular.ttf'
const DEFAULT_BOLD = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-jp/NotoSansJP_700Bold.ttf'

let registered = false

export function registerPdfFonts(regularUrl?: string | null): void {
  if (registered) return
  Font.register({
    family: 'JP',
    fonts: [
      { src: regularUrl || DEFAULT_REGULAR, fontWeight: 'normal' },
      { src: DEFAULT_BOLD, fontWeight: 'bold' },
    ],
  })
  registered = true
}
