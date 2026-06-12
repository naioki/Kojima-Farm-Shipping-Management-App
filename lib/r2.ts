import 'server-only'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Cloudflare R2（S3互換）クライアント。受信原本の7年保存（tax.md）に使う。
 * 認証情報は Secret Manager 由来の環境変数のみ（security.md・コード埋め込み禁止）。
 */
function r2(): S3Client {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 の認証情報が未設定です（Secret Manager を確認）')
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
}

const BUCKET = process.env.R2_BUCKET || 'kojima-noen'

/** 原本を R2 に保存し、保存キーを返す。 */
export async function putReceiptOriginal(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  await r2().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  )
  return key
}

/** 検証画面で原本を表示するための一時署名URL（既定15分）。 */
export async function getReceiptSignedUrl(key: string, expiresSec = 900): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresSec,
  })
}
