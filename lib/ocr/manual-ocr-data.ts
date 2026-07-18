import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'

export interface ManualOcrMasterData {
  currentPrompt: string
  customers: { id: string; name: string }[]
  products: { id: string; name: string; category: string | null }[]
  destinations: { id: string; customer_id: string; code: string | null; full_name: string; aliases: string[] }[]
}

/**
 * 手動OCRフォーム（/admin/ocr・/field/ocr 共通）のマスタデータ。
 * customers/products/destinations が空だと ManualOcrForm の保存セクションが出ない
 * （= 読み取るだけで保存できない）ため、両画面とも必ずここ経由で取得する。
 */
export async function getManualOcrMasterData(): Promise<ManualOcrMasterData> {
  const admin = createAdminClient()
  const [currentPrompt, customersRes, productsRes, destinationsRes] = await Promise.all([
    getSetting('GEMINI_PROMPT_NORMAL').then((v) => v ?? ''),
    admin.from('customers').select('id, name').eq('is_active', true).order('name'),
    admin.from('products').select('id, name, category').eq('is_active', true).order('category', { nullsFirst: false }).order('name'),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  return {
    currentPrompt,
    customers: (customersRes.data ?? []) as { id: string; name: string }[],
    products: (productsRes.data ?? []) as { id: string; name: string; category: string | null }[],
    destinations: (destinationsRes.data ?? []) as ManualOcrMasterData['destinations'],
  }
}
