import { describe, it, expect } from 'vitest'
import { parseSpreadsheetToText } from '@/lib/excel/parse'
import * as XLSX from 'xlsx'

describe('parseSpreadsheetToText', () => {
  it('CSVテキストを正常に解析できること', () => {
    const csvContent = '品名,数量,出荷先\nチンゲン菜,15,イオン幕張\n小松菜,20,イオン津田沼'
    const res = parseSpreadsheetToText(Buffer.from(csvContent, 'utf-8'), 'order.csv')

    expect(res.isSpreadsheet).toBe(true)
    expect(res.text).toContain('チンゲン菜,15,イオン幕張')
    expect(res.text).toContain('小松菜,20,イオン津田沼')
    expect(res.sheetNames).toEqual(['CSV'])
  })

  it('Excel (.xlsx) バイナリを正常に解析してテキスト化できること', () => {
    // XLSXワークブックをインメモリで生成
    const wb = XLSX.utils.book_new()
    const wsData = [
      ['取引先', '納品日', '品目', 'ケース数'],
      ['勘兵衛', '2026-10-25', 'チンゲン菜', 5],
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    XLSX.utils.book_append_sheet(wb, ws, '発注一覧')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const res = parseSpreadsheetToText(buf, 'kanbe_order.xlsx')
    expect(res.isSpreadsheet).toBe(true)
    expect(res.text).toContain('勘兵衛,2026-10-25,チンゲン菜,5')
    expect(res.sheetNames).toContain('発注一覧')
  })

  it('複数シートがある場合にシート名見出しが付与されること', () => {
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet([['品名', '数量'], ['チンゲン菜', 10]])
    const ws2 = XLSX.utils.aoa_to_sheet([['品名', '数量'], ['トマト', 5]])
    XLSX.utils.book_append_sheet(wb, ws1, '第1便')
    XLSX.utils.book_append_sheet(wb, ws2, '第2便')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const res = parseSpreadsheetToText(buf, 'multi_sheet.xlsx')
    expect(res.isSpreadsheet).toBe(true)
    expect(res.sheetNames).toEqual(['第1便', '第2便'])
    expect(res.text).toContain('--- シート: 第1便 ---')
    expect(res.text).toContain('--- シート: 第2便 ---')
  })
})
