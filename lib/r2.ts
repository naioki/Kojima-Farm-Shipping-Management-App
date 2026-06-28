import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'receipts'

/** 原本を Supabase Storage に保存し、保存パスを返す。 */
export async function putReceiptOriginal(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, body, { contentType, upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return key
}

/** Supabase Storage から原本バイト列を取得する。 */
export async function getReceiptOriginal(key: string): Promise<Buffer> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(key)
  if (error) throw new Error(`Storage download failed: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

/** 検証画面で原本を表示するための一時署名URL（既定15分）。 */
export async function getReceiptSignedUrl(key: string, expiresSec = 900): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(key, expiresSec)
  if (error) throw new Error(`Storage signed URL failed: ${error.message}`)
  return data.signedUrl
}
