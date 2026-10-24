import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import type { ParsedOrder } from '@/lib/gemini/analyze'

export interface ClarificationOption {
  id: string
  label: string
  value: string
  field: 'delivery_date' | 'customer_id' | 'destination_id' | 'quantity' | 'product_id' | 'note'
  orderIndex: number
  itemIndex?: number
  isNewMaster?: boolean
  newMasterPayload?: {
    type: 'destination' | 'product' | 'customer'
    name: string
    customerId?: string
  }
}

export interface ClarificationQuestion {
  id: string
  orderIndex: number
  itemIndex?: number
  category: 'date' | 'destination' | 'quantity' | 'product' | 'general'
  categoryLabel: string
  title: string
  reason: string
  options: ClarificationOption[]
  allowCustomInput: boolean
  customInputPlaceholder?: string
  targetField: 'delivery_date' | 'customer_id' | 'destination_id' | 'quantity' | 'product_id' | 'note'
}

interface DestinationItem {
  id: string
  customer_id?: string
  code: string | null
  full_name: string
  aliases?: string[]
}

interface CustomerItem {
  id: string
  name: string
}

interface ProductItem {
  id: string
  name: string
}

/**
 * AIが抽出した注文結果（ParsedOrder[]）と、DBマスタ（取引先・納入先・品目）を突合し、
 * 疑義がある項目（かすれ、未登録店舗、単位曖昧、約表記など）を「AI質問カード」として決定論的に生成する。
 */
export function buildClarificationQuestions(
  orders: ParsedOrder[],
  customers: CustomerItem[],
  destinations: DestinationItem[],
  _products?: ProductItem[],
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = []
  const today = jstTodayStr()
  const tomorrow = shiftDateStr(today, 1)
  const dayAfterTomorrow = shiftDateStr(today, 2)

  orders.forEach((order, oIdx) => {
    // ① 出荷日 (When) の検証
    const deliveryDate = order.delivery_date
    const isDateMissingOrPast = !deliveryDate || deliveryDate < today
    if (isDateMissingOrPast) {
      questions.push({
        id: `q-date-${oIdx}`,
        orderIndex: oIdx,
        category: 'date',
        categoryLabel: 'いつ (When)',
        title: '出荷日の確認',
        reason: deliveryDate
          ? `抽出された日付（${deliveryDate}）が過去日です`
          : '出荷日が明瞭に読み取れませんでした',
        targetField: 'delivery_date',
        allowCustomInput: true,
        customInputPlaceholder: 'YYYY-MM-DD で入力',
        options: [
          {
            id: `opt-date-tomorrow-${oIdx}`,
            label: `明日 ${tomorrow} 出荷（本日作業）`,
            value: tomorrow,
            field: 'delivery_date',
            orderIndex: oIdx,
          },
          {
            id: `opt-date-dayafter-${oIdx}`,
            label: `明後日 ${dayAfterTomorrow} 出荷`,
            value: dayAfterTomorrow,
            field: 'delivery_date',
            orderIndex: oIdx,
          },
          {
            id: `opt-date-today-${oIdx}`,
            label: `本日 ${today} 出荷（当日便）`,
            value: today,
            field: 'delivery_date',
            orderIndex: oIdx,
          },
        ],
      })
    }

    // ② 取引先 (Who) の検証
    let matchedCustomer: CustomerItem | undefined
    if (order.customer_name) {
      const cNorm = order.customer_name.replace(/[\s　株式会社農事組合法人有限会社]/g, '').toLowerCase()
      matchedCustomer = customers.find((c) => {
        const dbNorm = c.name.replace(/[\s　株式会社農事組合法人有限会社]/g, '').toLowerCase()
        return dbNorm.includes(cNorm) || cNorm.includes(dbNorm)
      })
    }
    if (!matchedCustomer && customers.length > 0) {
      questions.push({
        id: `q-cust-${oIdx}`,
        orderIndex: oIdx,
        category: 'general',
        categoryLabel: 'だれが (Who)',
        title: '取引先の確認',
        reason: order.customer_name
          ? `「${order.customer_name}」に完全一致する取引先がマスタに見つかりません`
          : '取引先が記載されていません',
        targetField: 'customer_id',
        allowCustomInput: true,
        customInputPlaceholder: '新しい取引先名を入力して登録',
        options: customers.slice(0, 4).map((c) => ({
          id: `opt-cust-${c.id}-${oIdx}`,
          label: c.name,
          value: c.id,
          field: 'customer_id',
          orderIndex: oIdx,
        })),
      })
    }

    // ③ 納入先 (Where) の検証
    if (order.destination_name) {
      const destText = order.destination_name.trim().toLowerCase()
      const custDests = matchedCustomer
        ? destinations.filter((d) => d.customer_id === matchedCustomer!.id)
        : destinations

      const matchedDest = custDests.find((d) => {
        const cands = [d.code, d.full_name, ...(d.aliases ?? [])].filter(Boolean).map((s) => s!.toLowerCase())
        return cands.some((c) => c === destText || c.includes(destText) || destText.includes(c))
      })

      if (!matchedDest) {
        // 未登録店舗の検出
        const options: ClarificationOption[] = []
        if (custDests.length > 0) {
          options.push({
            id: `opt-dest-existing-${custDests[0]!.id}-${oIdx}`,
            label: `既存の「${custDests[0]!.full_name}」を選択`,
            value: custDests[0]!.id,
            field: 'destination_id',
            orderIndex: oIdx,
          })
        }
        options.push({
          id: `opt-dest-new-${oIdx}`,
          label: `＋「${order.destination_name}」を新規納入先として登録`,
          value: order.destination_name,
          field: 'destination_id',
          orderIndex: oIdx,
          isNewMaster: true,
          newMasterPayload: {
            type: 'destination',
            name: order.destination_name,
            customerId: matchedCustomer?.id,
          },
        })

        questions.push({
          id: `q-dest-${oIdx}`,
          orderIndex: oIdx,
          category: 'destination',
          categoryLabel: 'どこへ (Where)',
          title: '未登録の納入先',
          reason: `納入先「${order.destination_name}」はマスタに登録されていません`,
          targetField: 'destination_id',
          allowCustomInput: true,
          customInputPlaceholder: '納入先名を自由入力',
          options,
        })
      }
    }

    // ④ 明細ごとの数量・単位・かすれ (Quantity & What) の検証
    order.items.forEach((item, iIdx) => {
      const hasReviewReason = Boolean(item.needs_review_reason)
      const isApprox = Boolean(item.is_approximate)
      const isLowConfidence = item.confidence < 0.75

      if (hasReviewReason || isApprox || isLowConfidence) {
        const qtyNum = parseInt(item.quantity, 10) || 0
        const perCase = item.packs_per_case || 20
        const asCases = item.cases ?? Math.floor(qtyNum / perCase)
        const casesAsPacks = (item.cases ?? qtyNum) * perCase

        const options: ClarificationOption[] = []
        if (asCases > 0) {
          options.push({
            id: `opt-qty-case-${oIdx}-${iIdx}`,
            label: `${asCases}ケース（${casesAsPacks}パック）`,
            value: String(casesAsPacks),
            field: 'quantity',
            orderIndex: oIdx,
            itemIndex: iIdx,
          })
        }
        options.push({
          id: `opt-qty-packs-${oIdx}-${iIdx}`,
          label: `${qtyNum}パック（そのまま）`,
          value: String(qtyNum),
          field: 'quantity',
          orderIndex: oIdx,
          itemIndex: iIdx,
        })

        questions.push({
          id: `q-qty-${oIdx}-${iIdx}`,
          orderIndex: oIdx,
          itemIndex: iIdx,
          category: 'quantity',
          categoryLabel: 'いくつ (How many)',
          title: `数量・単位の確認（${item.raw_name || item.product_name || '品目'}）`,
          reason: item.needs_review_reason
            ? item.needs_review_reason
            : isApprox
            ? '「約」表記のため数量の確定が必要です'
            : isLowConfidence
            ? '文字のかすれ等により確信度が低いため確認が必要です'
            : '数量単位の解釈を確認してください',
          targetField: 'quantity',
          allowCustomInput: true,
          customInputPlaceholder: '数量を直接入力',
          options,
        })
      }

      // 質問・特記事項の検出
      if (item.has_reply_required || (item.note && item.note.includes('【要返答】'))) {
        questions.push({
          id: `q-reply-${oIdx}-${iIdx}`,
          orderIndex: oIdx,
          itemIndex: iIdx,
          category: 'general',
          categoryLabel: '特記事項 (Notes)',
          title: 'FAX内の連絡・手書き質問事項',
          reason: item.note || 'FAX内に先方からの連絡事項または手書き質問が記載されています',
          targetField: 'note',
          allowCustomInput: true,
          customInputPlaceholder: '備考・返答内容',
          options: [
            {
              id: `opt-reply-ack-${oIdx}-${iIdx}`,
              label: '確認済み（備考に残す）',
              value: item.note || '先方質問あり確認済',
              field: 'note',
              orderIndex: oIdx,
              itemIndex: iIdx,
            },
            {
              id: `opt-reply-clear-${oIdx}-${iIdx}`,
              label: '問題なし（備考をクリア）',
              value: '',
              field: 'note',
              orderIndex: oIdx,
              itemIndex: iIdx,
            },
          ],
        })
      }
    })
  })

  return questions
}
