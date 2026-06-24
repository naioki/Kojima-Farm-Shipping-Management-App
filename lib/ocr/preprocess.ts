import 'server-only'

/**
 * FAX/スキャン画像の前処理（G3 / design.md §3）。
 * Gemini に渡す前に入力品質を高める。OCR精度はモデルより入力品質に強く依存する。
 *
 * パイプライン:
 *   1. EXIF 回転自動補正（スキャナ・スマホの向き）
 *   2. グレースケール化（カラー情報は不要。トークン削減）
 *   3. コントラスト正規化（normalize = 黒点・白点を両端へ）
 *   4. 長辺 1600px リサイズ（features.md §4 目安・トークン節約）
 *   5. JPEG q80 出力（base64 化）
 *
 * 注意: sharp は Node.js のみ（Cloud Run）。ブラウザ側は lib/image/downscale を使う。
 */

export interface PreprocessResult {
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
}

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 80

/**
 * FAX/スキャン画像を前処理して Gemini 向け base64 に変換する。
 * PDF はページごとに分割してから呼ぶこと（pdf-to-image などで変換済みの Buffer を渡す）。
 */
export async function preprocessFaxImage(input: Buffer): Promise<PreprocessResult> {
  // dynamic import: sharp は Node 専用。ビルド時に client bundle から除外するため遅延 import。
  const sharp = (await import('sharp')).default

  const pipeline = sharp(input, { failOn: 'none' })
    .rotate() // EXIF 回転を自動適用（withMetadata なしで適用だけ行う）
    .grayscale()
    .normalize() // コントラスト正規化（黒点・白点を 0/255 へ引き伸ばし）
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true, // 元画像より大きくしない
    })
    .jpeg({ quality: JPEG_QUALITY })

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return {
    base64: data.toString('base64'),
    mimeType: 'image/jpeg',
    width: info.width,
    height: info.height,
  }
}

/**
 * 上下逆さまと思われる場合（1回目の解析が is_order:false かつ全低 confidence）に
 * 180°回転して再処理する（§9 リトライ）。
 */
export async function preprocessFaxImageRotated180(input: Buffer): Promise<PreprocessResult> {
  const sharp = (await import('sharp')).default

  const pipeline = sharp(input, { failOn: 'none' })
    .rotate(180)
    .grayscale()
    .normalize()
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return {
    base64: data.toString('base64'),
    mimeType: 'image/jpeg',
    width: info.width,
    height: info.height,
  }
}
