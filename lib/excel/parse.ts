import * as XLSX from 'xlsx'

export interface ParsedSpreadsheet {
  text: string
  sheetNames: string[]
  isSpreadsheet: boolean
}

/**
 * Excel（.xlsx, .xls）や CSV ファイルのバッファまたは base64 から、
 * Gemini が最も高精度かつ省トークンで解析できる構造化テキスト（CSV形式）を抽出する。
 */
export function parseSpreadsheetToText(
  bufferOrBase64: Buffer | string,
  fileName?: string,
): ParsedSpreadsheet {
  const buf =
    typeof bufferOrBase64 === 'string'
      ? Buffer.from(bufferOrBase64, 'base64')
      : bufferOrBase64

  const lowerName = (fileName ?? '').toLowerCase()
  const isCsv = lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')

  // CSV で Shift-JIS の可能性がある場合のフォールバックデコード
  if (isCsv) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      return {
        text: decoded.trim(),
        sheetNames: ['CSV'],
        isSpreadsheet: true,
      }
    } catch {
      try {
        const decoded = new TextDecoder('shift-jis').decode(buf)
        return {
          text: decoded.trim(),
          sheetNames: ['CSV'],
          isSpreadsheet: true,
        }
      } catch {
        // 通常のXLSXパーサーへフォールスルー
      }
    }
  }

  try {
    const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true })
    const sheetTexts: string[] = []

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName]
      if (!worksheet) continue
      // 空白行を極力除外した CSV 形式に変換
      const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false }).trim()
      if (csv) {
        if (workbook.SheetNames.length > 1) {
          sheetTexts.push(`--- シート: ${sheetName} ---\n${csv}`)
        } else {
          sheetTexts.push(csv)
        }
      }
    }

    return {
      text: sheetTexts.join('\n\n'),
      sheetNames: workbook.SheetNames,
      isSpreadsheet: true,
    }
  } catch {
    return {
      text: '',
      sheetNames: [],
      isSpreadsheet: false,
    }
  }
}
