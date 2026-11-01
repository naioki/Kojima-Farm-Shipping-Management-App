import 'server-only'

/**
 * FAX/スキャン画像の前処理（v6.0 Multi-Angle & Adaptive Contrast Overhaul / G3 / design.md §3）。
 * Gemini に渡す前に入力品質を極限まで高める。
 *
 * パイプライン:
 *   1. EXIF 回転自動補正（スキャナ・スマホの向き）
 *   2. グレースケール化（カラー情報は不要。トークン削減）
 *   3. 適応的シャープネス＆コントラスト正規化（かすれたFAX印字・感熱紙ノイズの強調）
 *   4. 90° / 180° / 270° 回転リトライ対応
 *   5. 長辺 1600px リサイズ（features.md §4 目安・トークン節約）
 *   6. JPEG q82 出力（base64 化）
 */

export interface PreprocessResult {
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  rotationApplied?: number
}

const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 82

/**
 * 任意の角度（0, 90, 180, 270）および適応的シャープネスを適用して FAX 画像を正規化する。
 */
export async function preprocessFaxImageWithAngle(
  input: Buffer,
  angle: 0 | 90 | 180 | 270 = 0,
): Promise<PreprocessResult> {
  const sharp = (await import('sharp')).default

  let pipeline = sharp(input, { failOn: 'none' })
  if (angle === 0) {
    pipeline = pipeline.rotate() // EXIF 自動補正
  } else {
    pipeline = pipeline.rotate(angle)
  }

  pipeline = pipeline
    .grayscale()
    .normalize() // 黒点・白点を 0/255 へ引き伸ばし
    .linear(1.15, -12) // かすれたFAX文字のコントラスト強調・背景の地汚れ抑制
    .sharpen({ sigma: 1.0 }) // 数字エッジ（3と8、1と7の判別）を先鋭化
    .resize(MAX_LONG_EDGE, MAX_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return {
    base64: data.toString('base64'),
    mimeType: 'image/jpeg',
    width: info.width,
    height: info.height,
    rotationApplied: angle,
  }
}

/**
 * FAX/スキャン画像を前処理して Gemini 向け base64 に変換する（標準 0° / EXIF 自動補正）。
 */
export async function preprocessFaxImage(input: Buffer): Promise<PreprocessResult> {
  return preprocessFaxImageWithAngle(input, 0)
}

/**
 * 上下逆さまと思われる場合（1回目の解析が is_order:false かつ全低 confidence）に
 * 180°回転して再処理する（§9 リトライ）。
 */
export async function preprocessFaxImageRotated180(input: Buffer): Promise<PreprocessResult> {
  return preprocessFaxImageWithAngle(input, 180)
}

/**
 * 横向きスキャンされた FAX（90° / 270°）のリトライ用ヘルパー（v6.0 追加）。
 */
export async function preprocessFaxImageRotated90(
  input: Buffer,
  clockwise: boolean = true,
): Promise<PreprocessResult> {
  return preprocessFaxImageWithAngle(input, clockwise ? 90 : 270)
}
