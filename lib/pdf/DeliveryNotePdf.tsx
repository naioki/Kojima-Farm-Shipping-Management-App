import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { formatYen } from '@/lib/calculations/tax'

/** 納品書 PDF（@react-pdf・A4 固定デザイン）。数量主体＋税率別合計を併記。 */

export interface DeliveryNotePdfProps {
  customerName: string
  date: string
  issuer: { name: string; address: string | null; tel: string | null }
  items: { product_name: string; quantity: number; unit: string; unit_price: number; subtotal: number; tax_rate: number }[]
  totals: { subtotal8: number; subtotal10: number; total: number }
}

const C = { ink: '#1a1410', soft: '#7a6854', faint: '#a8997f', line: '#e4d5c5' }

const s = StyleSheet.create({
  page: { fontFamily: 'JP', fontSize: 9, color: C.ink, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: 'bold' },
  metaR: { textAlign: 'right', color: C.soft },
  partiesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22 },
  toName: { fontSize: 14, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: C.ink, paddingBottom: 3, minWidth: 200 },
  issuer: { textAlign: 'right', color: C.soft, lineHeight: 1.5 },
  issuerName: { color: C.ink, fontWeight: 'bold', fontSize: 11 },
  lead: { marginTop: 14, color: C.soft },
  table: { marginTop: 12 },
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
  foot: { marginTop: 10, color: C.faint, fontSize: 8 },
})

export function DeliveryNotePdf({ customerName, date, issuer, items, totals }: DeliveryNotePdfProps) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <Text style={s.title}>納品書</Text>
          <View style={s.metaR}>
            <Text>納品日: {date}</Text>
          </View>
        </View>

        <View style={s.partiesRow}>
          <Text style={s.toName}>{customerName} 御中</Text>
          <View style={s.issuer}>
            <Text style={s.issuerName}>{issuer.name || '小島農園'}</Text>
            {issuer.address ? <Text>{issuer.address}</Text> : null}
            {issuer.tel ? <Text>TEL: {issuer.tel}</Text> : null}
          </View>
        </View>

        <Text style={s.lead}>下記のとおり納品いたしました。</Text>

        <View style={s.table}>
          <View style={s.th}>
            <Text style={s.cName}>品目</Text>
            <Text style={s.cQty}>数量</Text>
            <Text style={s.cPrice}>単価</Text>
            <Text style={s.cAmt}>金額(税抜)</Text>
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
            <Text>{formatYen(totals.subtotal8)}</Text>
          </View>
          <View style={s.sumRow}>
            <Text style={{ color: C.soft }}>10%対象 税抜</Text>
            <Text>{formatYen(totals.subtotal10)}</Text>
          </View>
          <View style={s.sumTotal}>
            <Text style={{ fontWeight: 'bold' }}>合計（税込）</Text>
            <Text style={{ fontWeight: 'bold', fontSize: 12 }}>{formatYen(totals.total)}</Text>
          </View>
        </View>
        <Text style={s.foot}>※ は軽減税率（8%）対象品目です。</Text>
      </Page>
    </Document>
  )
}
