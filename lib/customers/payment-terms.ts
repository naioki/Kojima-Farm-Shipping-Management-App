/**
 * 取引先ごとの支払条件（締め日・支払日）。純関数・DB非依存。
 *
 * 保存先は customers.channel_identifiers.payment_schedule（JSON・マイグレーション不要）。
 * 未設定・不正値は「月末締め・翌月末払い」（従来の期日判定と同じ）。
 */
export type DayOfMonth = 'eom' | number

export interface PaymentSchedule {
  /** 締め日。'eom' = 月末、1..28 = その日 */
  closing: DayOfMonth
  /** 支払月。0 = 当月、1 = 翌月、2 = 翌々月 */
  pay_month_offset: 0 | 1 | 2
  /** 支払日。'eom' = 末日、1..28 = その日 */
  pay_day: DayOfMonth
}

export const DEFAULT_PAYMENT_SCHEDULE: PaymentSchedule = Object.freeze({
  closing: 'eom',
  pay_month_offset: 1,
  pay_day: 'eom',
}) as PaymentSchedule

/** 画面の選択肢（締め日・支払月・支払日） */
export const CLOSING_CHOICES: DayOfMonth[] = ['eom', 10, 15, 20, 25]
export const PAY_MONTH_CHOICES: PaymentSchedule['pay_month_offset'][] = [0, 1, 2]
export const PAY_DAY_CHOICES: DayOfMonth[] = ['eom', 5, 10, 15, 20, 25]

function parseDay(v: unknown, fallback: DayOfMonth): DayOfMonth {
  if (v === 'eom') return 'eom'
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 28) return n
  return fallback
}

function parseOffset(v: unknown): PaymentSchedule['pay_month_offset'] {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return n === 0 || n === 1 || n === 2 ? n : DEFAULT_PAYMENT_SCHEDULE.pay_month_offset
}

/** 保存値（または送信値）を支払条件に。項目ごとに不正値は既定に戻す。 */
export function parsePaymentSchedule(raw: unknown): PaymentSchedule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PAYMENT_SCHEDULE }
  const r = raw as Record<string, unknown>
  return {
    closing: parseDay(r.closing, DEFAULT_PAYMENT_SCHEDULE.closing),
    pay_month_offset: parseOffset(r.pay_month_offset),
    pay_day: parseDay(r.pay_day, DEFAULT_PAYMENT_SCHEDULE.pay_day),
  }
}

export function dayLabel(d: DayOfMonth, eomWord: '月末' | '末日'): string {
  return d === 'eom' ? eomWord : `${d}日`
}

export const PAY_MONTH_LABEL: Record<PaymentSchedule['pay_month_offset'], string> = {
  0: '当月',
  1: '翌月',
  2: '翌々月',
}

/** 請求書に印字する文（例「月末締め・翌月末払い」「20日締め・翌月10日払い」） */
export function paymentScheduleLabel(s: PaymentSchedule): string {
  const closing = s.closing === 'eom' ? '月末締め' : `${s.closing}日締め`
  const pay = s.pay_day === 'eom' ? '末払い' : `${s.pay_day}日払い`
  return `${closing}・${PAY_MONTH_LABEL[s.pay_month_offset]}${pay}`
}

/**
 * 支払期日 'YYYY-MM-DD'。締め日（periodEnd）を含む月の pay_month_offset か月後の pay_day。
 * その月に無い日は月末に丸める。periodEnd が不正なら null。
 */
export function dueDateFor(periodEnd: string, terms: PaymentSchedule = DEFAULT_PAYMENT_SCHEDULE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(periodEnd)
  if (!m) return null
  const y = Number(m[1])
  const mo0 = Number(m[2]) - 1 + terms.pay_month_offset // 0始まりの月（12以上は Date.UTC が年を繰り上げる）
  const lastDay = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate()
  const day = terms.pay_day === 'eom' ? lastDay : Math.min(terms.pay_day, lastDay)
  return new Date(Date.UTC(y, mo0, day)).toISOString().slice(0, 10)
}

/** 'YYYY-MM' → その月の末日 'YYYY-MM-DD'（不正なら null） */
export function monthEndOf(billingMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(billingMonth)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10)
}
