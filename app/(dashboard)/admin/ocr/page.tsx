import { redirect } from 'next/navigation'

/**
 * 旧「注文を読む（手動OCR）」画面。AI 読み取りの入口は「注文の受付」（/admin/orders/new）に一本化した。
 * 受信ボックスからの ?receipt= は、そのまま原本を引き継いで注文の受付を開く。
 */
export default function LegacyAdminOcrPage({ searchParams }: { searchParams: { receipt?: string } }) {
  redirect(searchParams.receipt ? `/admin/orders/new?receipt=${encodeURIComponent(searchParams.receipt)}` : '/admin/orders/new')
}
