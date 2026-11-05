import { redirect } from 'next/navigation'

/**
 * 旧「現場OCR」画面。写真・FAXの AI 読み取りは、収穫・パックボードの「＋ 注文を追加」に一本化した
 * （設定「現場スタッフの写真・FAX自動読取を許可」がオンのスタッフだけ写真読み取りが出る）。
 */
export default function LegacyFieldOcrPage() {
  redirect('/field/shipments')
}
