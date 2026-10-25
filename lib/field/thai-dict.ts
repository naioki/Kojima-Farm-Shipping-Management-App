/**
 * 現場（収穫・パックボード ＆ 便別積込リスト）向け タイ語辞書マッピング
 * 日本語の文字を消さずに、ルビ（サブテキスト）や警告文として添えるための対訳表。
 */

export const THAI_CONTAINERS: Record<string, string> = {
  青コン: 'ลังน้ำเงิน',
  茶コン: 'ลังน้ำตาล',
  房総青コン: 'ลังน้ำเงินโบโซ',
  段ボール: 'กล่องกระดาษ',
  農業総研専用折りたたみコンテナ: 'ลังพับNSK',
  NSK専用オリコン: 'ลังพับNSK',
  通常コンテナ: 'ลังธรรมดา',
}

export const THAI_BAGS: Record<string, string> = {
  印刷袋: 'ถุงพิมพ์ลาย',
  無地袋: 'ถุงใสไม่มีลาย',
  防曇袋: 'ถุงกันฝ้า',
  FG袋: 'ถุงFG',
}

export const THAI_TAPES: Record<string, string> = {
  赤テープ: 'เทปแดง',
  緑テープ: 'เทปเขียว',
  青テープ: 'เทปน้ำเงิน',
  黄テープ: 'เทปเหลือง',
  白テープ: 'เทปขาว',
  紫テープ: 'เทปม่วง',
}

export const THAI_PRODUCTS: Record<string, string> = {
  青梗菜: 'กวางตุ้งฮ่องเต้',
  チンゲンサイ: 'กวางตุ้งฮ่องเต้',
  チンゲン菜: 'กวางตุ้งฮ่องเต้',
  ちんげん菜: 'กวางตุ้งฮ่องเต้',
  小松菜: 'กวางตุ้งญี่ปุ่น',
  こまつな: 'กวางตุ้งญี่ปุ่น',
  ほうれん草: 'ปวยเล้ง',
  ホウレンソウ: 'ปวยเล้ง',
  わさび菜: 'ผักวาซาบิ',
  ワサビ菜: 'ผักวาซาบิ',
  水菜: 'ผักมิซึนะ',
  春菊: 'ตั้งโอ๋',
  ターサイ: 'ผักทาไซ',
}

export const THAI_LABELS = {
  // アクションボタン
  packDone: 'เสร็จแล้ว',
  packDoneAction: 'บันทึกว่าแพ็คเสร็จแล้ว',
  loadDone: 'ขึ้นรถเรียบร้อย',
  loadRevert: 'โหลดแล้ว (กดยกเลิก)',
  loadIndividual: 'ขึ้นรถเฉพาะรายการ',
  undo: 'กดยกเลิก',
  partialQty: 'จำนวนที่แพ็คได้',
  partialAdd20: '+20 ถุง',
  clear: 'ล้าง',
  carryoverStock: 'คงเหลือยกไปพรุ่งนี้',
  save: 'บันทึก',
  close: 'ปิด',

  // 資材・カード・シール
  cardYes: 'ใส่ป้ายชื่อ',
  cardNo: 'ไม่มีป้าย',
  sealYes: 'ติดสติ๊กเกอร์',
  sealNo: 'ไม่ติดสติ๊กเกอร์',

  // 警告・注意
  notCompletedWarn: 'ยังแพ็คไม่เสร็จครบ',
  quantityMismatchWarn: 'จำนวนยังไม่ครบตามเป้า',
  confirmRealCheckDone: 'ตรวจสอบแล้ว เสร็จเรียบร้อย',
  confirmLoadCheckDone: 'ตรวจสอบแล้ว ขึ้นรถได้',
  mustPackMore: 'ต้องแพ็คเพิ่มอีก',
  quantityChanged: 'เปลี่ยนจำนวน',

  // 見出し・ステータス・数量
  allDoneStamp: 'เสร็จสิ้น',
  routeDeparture: 'เวลาออก',
  unassignedTime: 'ยังไม่กำหนดเวลา',
  totalPacks: 'รวม',
  casesUnit: 'ลัง',
  fractionUnit: 'เศษ',
  noFraction: 'ไม่มีเศษ',
  totalLoadBoxes: 'รวมทั้งหมด',
  allPackedDone: 'แพ็คครบแล้ว',
  nextDayMorning: 'ส่งพรุ่งนี้เช้า',
  nextUpSpotlight: 'ทำรายการนี้ก่อน',
  inheritedCarryover: 'มีลังยกมาจากเมื่อวาน',
}

/** 品目名（野菜名）のタイ語訳を返す */
export function getThaiProduct(name: string | null | undefined): string | null {
  if (!name) return null
  const norm = name.normalize('NFKC').trim()
  for (const [k, v] of Object.entries(THAI_PRODUCTS)) {
    if (norm.includes(k)) return v
  }
  return null
}

/** 出荷・締切時刻のタイ語ルビを返す */
export function getThaiDepartureTime(time: string | null | undefined): string | null {
  if (!time) return null
  const t = time.trim()
  if (t.startsWith('翌')) {
    const clock = t.replace(/^翌(日)?/, '').trim()
    if (!clock || clock.includes('午前')) return 'ส่งพรุ่งนี้เช้า'
    return `พรุ่งนี้ ${clock}`
  }
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    return `วันนี้ ${t}`
  }
  return null
}

/** コンテナ名のタイ語ルビを返す */
export function getThaiContainer(name: string | null | undefined): string | null {
  if (!name) return null
  for (const [k, v] of Object.entries(THAI_CONTAINERS)) {
    if (name.includes(k)) return v
  }
  return null
}

/** コンテナ名から直感カラー絵文字（🟦青コン・🟫茶コン・🟨段ボール・🟩オリコン）を返す */
export function getContainerColorEmoji(name: string | null | undefined): string {
  if (!name) return '📦'
  if (name.includes('青')) return '🟦'
  if (name.includes('茶')) return '🟫'
  if (name.includes('黄')) return '🟨'
  if (name.includes('段ボール') || name.includes('ダンボール')) return '📦'
  if (name.includes('農業総研') || name.includes('NSK') || name.includes('折りたたみ') || name.includes('オリコン')) return '🟩'
  return '📦'
}

/** 袋種別のタイ語ルビを返す */
export function getThaiBag(name: string | null | undefined): string | null {
  if (!name) return null
  for (const [k, v] of Object.entries(THAI_BAGS)) {
    if (name.includes(k)) return v
  }
  return null
}

/** 袋種別から直感ピクトグラムを返す */
export function getBagEmoji(name: string | null | undefined): string {
  if (!name) return '🛍️'
  if (name.includes('印刷')) return '🖨️'
  if (name.includes('無地')) return '📄'
  return '🛍️'
}

/** テープ色のタイ語ルビを返す */
export function getThaiTape(name: string | null | undefined): string | null {
  if (!name) return null
  for (const [k, v] of Object.entries(THAI_TAPES)) {
    if (name.includes(k)) return v
  }
  return null
}

/** テープ色から実物カラー丸印（🟢緑・🔴赤・🔵青・🟡黄・⚪白・🟣紫）を返す */
export function getTapeColorEmoji(name: string | null | undefined): string {
  if (!name) return '🎗️'
  if (name.includes('赤')) return '🔴'
  if (name.includes('緑')) return '🟢'
  if (name.includes('青')) return '🔵'
  if (name.includes('黄')) return '🟡'
  if (name.includes('白')) return '⚪'
  if (name.includes('紫')) return '🟣'
  return '🎗️'
}

/** 入数（20入など）や株数（2〜3株など）のタイ語表現を生成 */
export function getThaiSpec(spec: string | null | undefined, packsPerCase?: number | null): string | null {
  if (!spec && !packsPerCase) return null
  const parts: string[] = []
  if (packsPerCase && packsPerCase > 0) {
    parts.push(`${packsPerCase} ถุง/ลัง`)
  }
  if (spec) {
    const plantMatch = spec.match(/(\d+)(?:[〜~-](\d+))?\s*株/)
    if (plantMatch) {
      const pText = plantMatch[2] ? `${plantMatch[1]}-${plantMatch[2]}` : plantMatch[1]
      parts.push(`${pText} ต้น/ถุง`)
    }
    const gramMatch = spec.match(/(\d+)\s*g/i)
    if (gramMatch) {
      parts.push(`${gramMatch[1]} กรัม`)
    }
  }
  return parts.length > 0 ? parts.join(' ・ ') : null
}
