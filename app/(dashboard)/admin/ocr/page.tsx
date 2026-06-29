import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'
import { getReceiptOriginal } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * 手動OCR（管理者専用）。
 * ?receipt=<id> で受信トレイから遷移した場合、原本画像を自動プリロードする。
 */
export default async function ManualOcrPage({
  searchParams,
}: {
  searchParams: { receipt?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="手動OCRは管理者のみ利用できます。" />
  }

  const [currentPrompt, customersResult, productsResult, destinationsResult] = await Promise.all([
    getSetting('GEMINI_PROMPT_NORMAL').then((v) => v ?? ''),
    createAdminClient().from('customers').select('id, name').eq('is_active', true).order('name'),
    createAdminClient().from('products').select('id, name').eq('is_active', true).order('name'),
    createAdminClient()
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const customers = (customersResult.data ?? []) as { id: string; name: string }[]
  const products = (productsResult.data ?? []) as { id: string; name: string }[]
  const destinations = (destinationsResult.data ?? []) as {
    id: string
    customer_id: string
    code: string | null
    full_name: string
    aliases: string[]
  }[]

  // 受信トレイからの遷移：原本を取得してプリロード
  let preloadedImage: { base64: string; mimeType: string; fileName: string } | null = null
  if (searchParams.receipt) {
    const admin = createAdminClient()
    const { data: receipt } = await admin
      .from('order_receipts')
      .select('r2_key, channel, received_at')
      .eq('id', searchParams.receipt)
      .maybeSingle()

    if (receipt?.r2_key) {
      try {
        const buf = await getReceiptOriginal(receipt.r2_key)
        const ext = receipt.r2_key.split('.').pop()?.toLowerCase() ?? 'jpg'
        const mimeType =
          ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg'
        preloadedImage = {
          base64: buf.toString('base64'),
          mimeType,
          fileName: receipt.r2_key.split('/').pop() ?? 'receipt',
        }
      } catch {
        // 取得失敗は無視（通常フローにフォールバック）
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <ScanLine className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">注文を読む（FAX・メール）</h1>
          <p className="text-sm text-ink-soft">
            FAX画像・スキャン・PDF・メール本文をAIで読み取り、そのまま注文登録できます。管理者専用。
          </p>
        </div>
      </div>

      <Card>
        <ManualOcrForm
          currentPrompt={currentPrompt}
          defaultPrompt={DEFAULT_GEMINI_PROMPT_NORMAL}
          customers={customers}
          products={products}
          destinations={destinations}
          preloadedImage={preloadedImage}
        />
      </Card>
    </div>
  )
}
