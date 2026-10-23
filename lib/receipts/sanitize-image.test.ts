import { describe, it, expect } from 'vitest'
import fs from 'fs'
import sharp from 'sharp'
import { sanitizePriceColumnFromImage } from './sanitize-image'

describe('sanitizePriceColumnFromImage (買値列サニタイズ)', () => {
  it('農業総研のFAX画像から買値列を検知・切除し、幅が切り詰まった画像を生成する', async () => {
    const testImgPath = 'C:/Users/kagay/.gemini/antigravity-cli/brain/33bb0895-7aa4-47a7-9de6-4c734ce46aeb/original_nsk.jpg'
    if (!fs.existsSync(testImgPath)) {
      return // skip if file not found in test env
    }

    const originalBuf = fs.readFileSync(testImgPath)
    const metaOrig = await sharp(originalBuf).metadata()

    const { sanitizedBuffer, wasSanitized } = await sanitizePriceColumnFromImage(
      originalBuf,
      '株式会社農業総合研究所',
    )

    expect(wasSanitized).toBe(true)
    const metaSanitized = await sharp(sanitizedBuffer).metadata()
    expect(metaSanitized.width).toBeLessThan(metaOrig.width!)
    expect(metaSanitized.height).toBe(metaOrig.height!)
  })

  it('対象外の画像や壊れたデータはそのまま安全に返却する', async () => {
    const dummy = Buffer.from('not an image')
    const { wasSanitized } = await sanitizePriceColumnFromImage(dummy)
    expect(wasSanitized).toBe(false)
  })
})
