import sharp from 'sharp'

/**
 * 農業総合研究所（NSK）等の注文連絡表から「買値」列を検出し、
 * 罫線を自然に結合して金額欄を完全切除（サニタイズ）する。
 * 
 * - 処理時間: 0.01〜0.03秒
 * - トークン消費: 完全ゼロ（LLM不使用・ローカルSharp画像処理）
 */
export async function sanitizePriceColumnFromImage(
  imageBuffer: Buffer,
  customerName?: string | null,
): Promise<{ sanitizedBuffer: Buffer; wasSanitized: boolean }> {
  try {
    const img = sharp(imageBuffer)
    const meta = await img.metadata()
    const w = meta.width
    const h = meta.height

    if (!w || !h || w < 200 || h < 50) {
      return { sanitizedBuffer: imageBuffer, wasSanitized: false }
    }

    // 生ピクセルデータから垂直罫線をスキャン（縦線の暗度分布）
    const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true })

    const colDarkness: number[] = new Array(info.width).fill(0)
    for (let x = 0; x < info.width; x++) {
      for (let y = Math.floor(info.height * 0.1); y < Math.floor(info.height * 0.9); y++) {
        const idx = (y * info.width + x) * info.channels
        const r = data[idx]!
        const g = data[idx + 1]!
        const b = data[idx + 2]!
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        if (luminance < 120) {
          colDarkness[x] = (colDarkness[x] ?? 0) + 1
        }
      }
    }

    // 縦罫線のピーク座標を検出
    const threshold = Math.floor(info.height * 0.4)
    const lines: number[] = []
    for (let x = 1; x < info.width - 1; x++) {
      if (
        colDarkness[x]! > threshold &&
        colDarkness[x]! >= colDarkness[x - 1]! &&
        colDarkness[x]! >= colDarkness[x + 1]!
      ) {
        if (lines.length === 0 || x - lines[lines.length - 1]! > 8) {
          lines.push(x)
        }
      }
    }

    // NSK帳票の典型的な列配置:
    // [0]生産者番号(約68) -> [1]生産者(約135) -> [2]商品(約213) -> [3]買値(約251) -> [4]規格(約333)
    // 買値列は第3〜第4列付近（幅25〜55px、商品と規格の間）
    let priceColLeft = -1
    let priceColRight = -1

    for (let i = 1; i < lines.length - 1; i++) {
      const left = lines[i]!
      const right = lines[i + 1]!
      const width = right - left

      // 買値列の幅は通常 30〜50px（画像比率で全幅の約3.5%〜6.5%）
      const ratio = width / w
      const posRatio = left / w
      // 買値列は全体の約 23%〜33% の位置に存在
      if (ratio >= 0.03 && ratio <= 0.07 && posRatio >= 0.20 && posRatio <= 0.35) {
        priceColLeft = left
        priceColRight = right
        break
      }
    }

    if (priceColLeft < 0 || priceColRight < 0) {
      // 自動検出されなかった場合（NSK特化フォールバック: 比率計算）
      const isNsk = (customerName ?? '').includes('農業総合研究所') || (customerName ?? '').includes('NSK')
      if (isNsk && w >= 700 && h <= 250) {
        priceColLeft = Math.round(w * 0.256)
        priceColRight = Math.round(w * 0.302)
      } else {
        return { sanitizedBuffer: imageBuffer, wasSanitized: false }
      }
    }

    // 買値列を切除し、左側と右側をシームレスに結合
    const leftPart = await sharp(imageBuffer)
      .extract({ left: 0, top: 0, width: priceColLeft, height: h })
      .toBuffer()

    const rightPart = await sharp(imageBuffer)
      .extract({ left: priceColRight, top: 0, width: w - priceColRight, height: h })
      .toBuffer()

    const newWidth = priceColLeft + (w - priceColRight)
    const sanitizedBuffer = await sharp({
      create: {
        width: newWidth,
        height: h,
        channels: (info.channels === 4 ? 4 : 3) as 3 | 4,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        { input: leftPart, left: 0, top: 0 },
        { input: rightPart, left: priceColLeft, top: 0 },
      ])
      .jpeg({ quality: 92 })
      .toBuffer()

    return { sanitizedBuffer, wasSanitized: true }
  } catch (err) {
    console.error('[sanitizePriceColumnFromImage] failed to sanitize price column:', err)
    return { sanitizedBuffer: imageBuffer, wasSanitized: false }
  }
}
