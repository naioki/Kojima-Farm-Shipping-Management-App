import Link from 'next/link'
import { ScanLine, ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'
import { getReceiptOriginal } from '@/lib/r2'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getManualOcrMasterData } from '@/lib/ocr/manual-ocr-data'

export const dynamic = 'force-dynamic'

/**
 * 手動OCR（管理者専用）。/field/ocr と同じフォーム・同じマスタ取得を共有する（lib/ocr/manual-ocr-data）。
 * ?receipt=<id> で受信トレイから遷移した場合、原本画像を自動プリロードする。
 */
export default async function ManualOcrPage({
  searchParams,
}: {
  searchParams: { receipt?: string }
}) {
  const guard = await requireAdmin('手動OCRは管理者のみ利用できます。')
  if (guard) return guard

  const { currentPrompt, customers, products, destinations } = await getManualOcrMasterData()

  // 受信トレイからの遷移：原本を取得してプリロード
  let preloadedImage: { base64: string; mimeType: string; fileName: string } | null = null
  if (searchParams.receipt) {
    const admin = createAdminClient()
    const { data: receipt, error: receiptErr } = await admin
      .from('order_receipts')
      .select('r2_key, channel, received_at')
      .eq('id', searchParams.receipt)
      .maybeSingle()
    // 原本プリロードは補助（失敗しても手動アップロードで続行可）。無言で握りつぶさない。
    if (receiptErr) console.error('[admin/ocr] 原本プリロード用の受信取得に失敗:', receiptErr.message)

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
      } catch (e) {
        // 原本取得失敗は通常フロー（手動アップロード）にフォールバック。無言にはしない。
        console.error('[admin/ocr] 原本画像のプリロードに失敗:', e instanceof Error ? e.message : e)
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/admin/inbox"
        className="inline-flex items-center gap-1 text-sm font-medium text-trust-600 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        受注ボックスへ戻る
      </Link>

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
