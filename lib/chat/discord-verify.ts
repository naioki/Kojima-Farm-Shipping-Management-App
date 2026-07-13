import crypto from 'node:crypto'

/**
 * Discord Interactions の Ed25519 署名検証（node:crypto の標準APIのみ。tweetnacl 等の外部依存なし）。
 *
 * Discord は `X-Signature-Ed25519`（署名 hex）と `X-Signature-Timestamp` を送る。検証対象は
 * `timestamp + rawBody` の生バイト列。**JSON.parse 前の生の本文で検証すること**（整形すると不一致）。
 *
 * node:crypto の crypto.verify は Ed25519 生公開鍵を直接受け取れないため、32byte の生鍵を
 * SPKI DER でラップして createPublicKey に渡す（OID 1.3.101.112 = Ed25519）。
 */

// SPKI DER の固定ヘッダ（12 byte）。この後ろに 32 byte の生公開鍵を連結すると Ed25519 SPKI になる。
//   30 2a                SEQUENCE(42)
//     30 05              SEQUENCE(5)
//       06 03 2b 65 70   OID 1.3.101.112 (Ed25519)
//     03 21 00           BIT STRING(33): 未使用ビット0 + 32byte鍵
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** 32byte の生 Ed25519 公開鍵(hex) を SPKI DER の KeyObject に変換する。 */
export function ed25519PublicKeyFromHex(publicKeyHex: string): crypto.KeyObject {
  const raw = Buffer.from(publicKeyHex, 'hex')
  if (raw.length !== 32) {
    throw new Error(`Ed25519 公開鍵は32byteである必要があります（実際: ${raw.length}byte）`)
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
}

export interface VerifyInput {
  /** DISCORD_PUBLIC_KEY（32byte hex）。 */
  publicKeyHex: string
  /** X-Signature-Ed25519（署名 hex）。 */
  signatureHex: string
  /** X-Signature-Timestamp。 */
  timestamp: string
  /** JSON.parse 前の生の本文（req.text()）。 */
  rawBody: string
}

/**
 * 署名検証。true=正当。鍵・署名・タイムスタンプが欠けている、または形式が不正な場合は false
 * （例外は内部で握って false に落とす。呼び出し側は false→401 を返すだけでよい）。
 */
export function verifyDiscordSignature(input: VerifyInput): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = input
  if (!publicKeyHex || !signatureHex || !timestamp) return false
  try {
    const key = ed25519PublicKeyFromHex(publicKeyHex)
    const signature = Buffer.from(signatureHex, 'hex')
    // Ed25519 は algorithm=null。検証対象は timestamp + body の生バイト。
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')])
    return crypto.verify(null, message, key, signature)
  } catch {
    // 鍵/署名の hex が不正・長さ不一致などはすべて検証失敗として扱う（詳細はログに出さない＝秘匿）。
    return false
  }
}
