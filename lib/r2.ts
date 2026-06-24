import 'server-only'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getSetting } from '@/lib/settings'

/**
 * Cloudflare R2（S3互換）クライアント。受信原本の7年保存（tax.md）に使う。
 * 認証情報は設定（DB→env）から解決（設定画面 or Secret Manager で投入・security.md）。
 */
async function r2(): Promise<S3Client> {
  const endpoint = await getSetting('R2_ENDPOINT')
  const accessKeyId = await getSetting('R2_ACCESS_KEY_ID')
  const secretAccessKey = await getSetting('R2_SECRET_ACCESS_KEY')
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 の認証情報が未設定です（設定画面 または Secret Manager で投入）')
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })
}

async function bucket(): Promise<string> {
  return (await getSetting('R2_BUCKET')) || 'kojima-noen'
}

/** 原本を R2 に保存し、保存キーを返す。 */
export async function putReceiptOriginal(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  const [client, Bucket] = await Promise.all([r2(), bucket()])
  await client.send(
    new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
  )
  return key
}

/** R2 から原本バイト列を取得する。処理パイプライン（解析・再処理）で使う。 */
export async function getReceiptOriginal(key: string): Promise<Buffer> {
  const [client, Bucket] = await Promise.all([r2(), bucket()])
  const res = await client.send(new GetObjectCommand({ Bucket, Key: key }))
  if (!res.Body) throw new Error(`R2 オブジェクトが空です: ${key}`)
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** 検証画面で原本を表示するための一時署名URL（既定15分）。 */
export async function getReceiptSignedUrl(key: string, expiresSec = 900): Promise<string> {
  const [client, Bucket] = await Promise.all([r2(), bucket()])
  return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
    expiresIn: expiresSec,
  })
}
