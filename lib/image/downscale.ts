/**
 * 画像をブラウザ側で縮小・JPEG圧縮してから送る（features.md §4 の前処理をクライアントへ）。
 * 目的: アップロード量・サーバー(Cloud Run)のCPU・Gemini のトークン課金を実質的に削減する。
 * ブラウザ専用（Canvas 依存）。サーバーからは呼ばない。
 */

export interface DownscaledImage {
  /** "data:image/jpeg;base64,XXXX" 形式 */
  dataUrl: string
  /** base64 本体（"," 以降だけ） */
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
}

export interface DownscaleOptions {
  /** 長辺の最大px（既定 1600・features.md §4 準拠） */
  maxDim?: number
  /** JPEG 品質 0..1（既定 0.8） */
  quality?: number
}

const DEFAULT_MAX_DIM = 1600
const DEFAULT_QUALITY = 0.8

/**
 * File（画像）を長辺 maxDim 以内へ縮小し、JPEG に再エンコードして返す。
 * 既に小さい画像は拡大しない（scale は 1 が上限）。PDF など非画像には使わない。
 */
export function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<DownscaledImage> {
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM
  const quality = opts.quality ?? DEFAULT_QUALITY
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('画像を開けませんでした'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas を初期化できませんでした'))
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve({
          dataUrl,
          base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
          mimeType: 'image/jpeg',
          width: w,
          height: h,
        })
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
