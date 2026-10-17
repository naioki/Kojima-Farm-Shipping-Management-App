import 'server-only'
import { extractGoogleDriveFileId, toGoogleDrivePreviewUrl, toGoogleDriveViewUrl } from '@/lib/pipeline/schemas'

/**
 * Google Drive 原本参照互換モジュール（旧 `@/lib/r2` 互換シム）。
 *
 * 【アーキテクチャ方針】
 * FAX原本のPDF化とGoogle Driveへの保存は農園のLinux FAXサーバー（`Kojima-FAX` の `drive_backup.py`）で完結しているため、
 * Cloud Run側では Cloudflare R2 や Supabase Storage への重複アップロードは行わない。
 * 既存の他画面（`/admin/ocr` 等）からの import 互換性を保ちつつ、Google Drive URL を扱う。
 */

export async function putReceiptOriginal(
  key: string,
  _body: Uint8Array | Buffer,
  _contentType: string,
): Promise<string> {
  // クラウドストレージへの二重保存は行わず、渡されたキーまたはURLをそのまま返す
  return key
}

export async function getReceiptOriginal(key: string): Promise<Buffer> {
  const fileId = extractGoogleDriveFileId(key)
  if (fileId) {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
    const res = await fetch(downloadUrl, { redirect: 'follow' })
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer())
    }
  }
  throw new Error('原本は Google Drive 上で直接管理されています（Google Drive プレビューURLを参照してください）')
}

export async function getReceiptSignedUrl(key: string, _expiresSec = 900): Promise<string> {
  return toGoogleDrivePreviewUrl(key) ?? toGoogleDriveViewUrl(key) ?? key
}
