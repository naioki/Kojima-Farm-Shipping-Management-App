import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { formatYen } from '@/lib/calculations/tax'
import { formatJpDate, formatJpMonth } from '@/lib/dates'

/**
 * 請求書 PDF（@react-pdf・A4 固定デザイン）。インボイス制度対応。
 * 発行者情報・振込先は設定（FARM_*）から差し込む。色は PDF レンダラ専用のため literal hex。
 */

export interface InvoicePdfProps {
  invoice: {
    invoice_number: string
    issue_date: string | null
    period_start: string | null
    period_end: string | null
    billing_month: string
    subtotal_8: number
    tax_8: number
    subtotal_10: number
    tax_10: number
    total_amount: number
  }
  customerName: string
  issuer: { name: string; reg: string | null; address: string | null; tel: string | null; payment: string | null }
  items: { product_name: string; quantity: number; unit: string; unit_price: number; subtotal: number; tax_rate: number }[]
}

const C = { ink: '#1a1410', soft: '#7a6854', faint: '#a8997f', line: '#e4d5c5', earth: '#8a6d3b', bg: '#faf9f7' }

const s = StyleSheet.create({
  page: { fontFamily: 'JP', fontSize: 9, color: C.ink, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: 'bold' },
  metaR: { textAlign: 'right', color: C.soft, fontSize: 9 },
  num: { fontWeight: 'bold', color: C.ink, fontSize: 11 },
  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22 },
  toName: { fontSize: 14, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 3, minWidth: 200 },
  issuer: { textAlign: 'right', color: C.soft, fontSize: 9, lineHeight: 1.5 },
  issuerName: { color: C.ink, fontWeight: 'bold', fontSize: 11 },
  totalBox: { marginTop: 18, backgroundColor: C.bg, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 14 },
  totalLabel: { color: C.soft, fontSize: 9 },
  totalAmount: { color: C.earth, fontSize: 22, fontWeight: 'bold' },
  table: { marginTop: 16 },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 4, color: C.soft },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 4 },
  cName: { flex: 1 },
  cQty: { width: 70, textAlign: 'right' },
  cPrice: { width: 80, textAlign: 'right' },
  cAmt: { width: 80, textAlign: 'right' },
  cTax: { width: 44, textAlign: 'center' },
  sumWrap: { marginTop: 12, marginLeft: 'auto', width: 230 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  sumTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.ink },
  pay: { marginTop: 18, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, color: C.soft },
  foot: { marginTop: 10, color: C.faint, fontSize: 8 },
})

export function InvoicePdf({ invoice, customerName, issuer, items }: InvoicePdfProps) {
  const period =
    invoice.period_start && invoice.period_end
      ? `対象期間: ${formatJpDate(invoice.period_start)} 〜 ${formatJpDate(invoice.period_end)}`
      : `対象月: ${formatJpMonth(invoice.billing_month)}`
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <Text style={s.title}>請求書</Text>
          <View style={s.metaR}>
            <Text style={s.num}>{invoice.invoice_number}</Text>
            {invoice.issue_date ? <Text>発行日: {formatJpDate(invoice.issue_date)}</Text> : null}
            <Text>{period}</Text>
          </View>
        </View>

        <View style={s.partiesRow}>
          <Text style={s.toName}>{customerName} 御中</Text>
          <View style={s.issuer}>
            <Text style={s.issuerName}>{issuer.name || '小島農園'}</Text>
            {issuer.reg ? <Text>登録番号: {issuer.reg}</Text> : null}
            {issuer.address ? <Text>{issuer.address}</Text> : null}
            {issuer.tel ? <Text>TEL: {issuer.tel}</Text> : null}
          </View>
        </View>

        <View style={s.totalBox}>
          <Text style={s.totalLabel}>ご請求金額（税込）</Text>
          <Text style={s.totalAmount}>{formatYen(invoice.total_amount)}</Text>
        </View>

        <View style={s.table}>
          <View style={s.th}>
            <Text style={s.cName}>品目</Text>
            <Text style={s.cQty}>数量</Text>
            <Text style={s.cPrice}>単価</Text>
            <Text style={s.cAmt}>税抜金額</Text>
            <Text style={s.cTax}>税率</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.cName}>{it.product_name}</Text>
              <Text style={s.cQty}>
                {it.quantity}
                {it.unit}
              </Text>
              <Text style={s.cPrice}>{formatYen(it.unit_price)}</Text>
              <Text style={s.cAmt}>{formatYen(it.subtotal)}</Text>
              <Text style={s.cTax}>
                {it.tax_rate}%{it.tax_rate === 8 ? '※' : ''}
              </Text>
            </View>
          ))}
        </View>

        <View style={s.sumWrap}>
          <View style={s.sumRow}>
            <Text style={{ color: C.soft }}>8%対象 税抜</Text>
            <Text>{formatYen(invoice.subtotal_8)}</Text>
          </View>
          <View style={s.sumRow}>
            <Text style={{ color: C.soft }}>消費税 8%</Text>
            <Text>{formatYen(invoice.tax_8)}</Text>
          </View>
          <View style={s.sumRow}>
            <Text style={{ color: C.soft }}>10%対象 税抜</Text>
            <Text>{formatYen(invoice.subtotal_10)}</Text>
          </View>
          <View style={s.sumRow}>
            <Text style={{ color: C.soft }}>消費税 10%</Text>
            <Text>{formatYen(invoice.tax_10)}</Text>
          </View>
          <View style={s.sumTotal}>
            <Text style={{ fontWeight: 'bold' }}>合計（税込）</Text>
            <Text style={{ fontWeight: 'bold', fontSize: 12 }}>{formatYen(invoice.total_amount)}</Text>
          </View>
        </View>

        <View style={s.pay}>
          <Text style={{ color: C.ink, fontWeight: 'bold' }}>お振込先</Text>
          <Text>{issuer.payment || '（設定 → 発行者情報 で振込先を登録してください）'}</Text>
        </View>
        <Text style={s.foot}>※ は軽減税率（8%）対象品目です。</Text>
      </Page>
    </Document>
  )
}
