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
 * ?receipt=<id> で受信トレイから遷移した場合、raw_payload.file_base64 または Google Drive 原本からプリロードする。
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
      .select('r2_key, raw_payload, channel, received_at')
      .eq('id', searchParams.receipt)
      .maybeSingle()
    if (receiptErr) console.error('[admin/ocr] 原本プリロード用の受信取得に失敗:', receiptErr.message)

    const payload = (receipt?.raw_payload ?? {}) as Record<string, unknown>
    const fileBase64 = typeof payload['file_base64'] === 'string' ? payload['file_base64'] : null
    const fileName =
      (typeof payload['filename'] === 'string' && payload['filename']) ||
      receipt?.r2_key?.split('/').pop() ||
      'receipt.pdf'
    const mimeType =
      (typeof payload['content_type'] === 'string' && payload['content_type']) ||
      (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')

    if (fileBase64) {
      preloadedImage = {
        base64: fileBase64,
        mimeType,
        fileName,
      }
    } else if (receipt?.r2_key) {
      try {
        const buf = await getReceiptOriginal(receipt.r2_key)
        preloadedImage = {
          base64: buf.toString('base64'),
          mimeType,
          fileName,
        }
      } catch (e) {
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
