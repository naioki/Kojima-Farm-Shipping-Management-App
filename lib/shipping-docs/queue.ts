import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderShippingDocPdf, type ShippingDocType } from '@/lib/shipping-docs/render'

/**
 * 印刷キュー投入の中核（統合2D）。出荷帳票PDFを生成 → Storage(print-jobs) へ保存 →
 * 署名付きURLを発行 → print_jobs テーブルへ登録、までを1本化する。
 *
 * POST /api/print-jobs（現場・利用者セッション文脈）とチャット自動化（無セッション・
 * service_role 文脈）の両方が使う。PDF生成と Storage はどちらも service_role で行い、
 * print_jobs への INSERT だけは呼び出し側が渡す `db` クライアントで実行する:
 *   - ルート : 利用者クライアント（RLS staff_insert を効かせ、requested_by=利用者）
 *   - チャット: admin クライアント（RLSバイパス。requested_by は実行者 or null）
 * これで既存ルートの外部挙動（RLS・requested_by）を変えずに再利用できる。
 */

export interface EnqueuePrintJobParams {
  date: string
  docType: ShippingDocType
  productId?: string | null
  /** 複数取引先での絞り込み（印刷画面のチェックボックス）。 */
  customerIds?: string[] | null
  /** ラベルのみ: 供給先順を逆にする（積み込み順）。 */
  reverse?: boolean
  /** print_jobs.requested_by。無セッションの自動投入は null 可。 */
  requestedBy: string | null
}

export type EnqueuePrintJobResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string }

export async function enqueuePrintJob(
  db: SupabaseClient<Database>,
  params: EnqueuePrintJobParams,
): Promise<EnqueuePrintJobResult> {
  const { date, docType, productId = null, customerIds = null, reverse, requestedBy } = params

  const rendered = await renderShippingDocPdf({ docType, date, productId, customerIds, reverse })
  if (!rendered.ok) return { ok: false, status: rendered.status, error: rendered.error }

  // Storage へ保存（非公開バケット）→ エージェント用の署名付きURL（1年）。常に service_role。
  const admin = createAdminClient()
  const ts = Date.now()
  const path = `${date}/${docType}${productId ? `_${productId.slice(0, 8)}` : ''}_${ts}.pdf`
  const { error: uploadErr } = await admin.storage
    .from('print-jobs')
    .upload(path, rendered.buffer, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) return { ok: false, status: 500, error: `PDF保存失敗: ${uploadErr.message}` }

  const { data: signed, error: signErr } = await admin.storage
    .from('print-jobs')
    .createSignedUrl(path, 365 * 24 * 3600)
  if (signErr || !signed?.signedUrl) {
    return { ok: false, status: 500, error: `署名URL発行失敗: ${signErr?.message ?? 'unknown'}` }
  }

  // キュー登録は呼び出し側の文脈で（ルートは利用者=RLS、チャットは admin）。
  const { data: job, error: insertErr } = await db
    .from('print_jobs')
    .insert({
      doc_type: docType,
      target_date: date,
      product_id: productId,
      pdf_url: signed.signedUrl,
      requested_by: requestedBy,
    })
    .select('id')
    .maybeSingle()
  if (insertErr || !job) {
    return { ok: false, status: 500, error: `キュー登録失敗: ${insertErr?.message ?? 'unknown'}` }
  }

  return { ok: true, id: job.id }
}
