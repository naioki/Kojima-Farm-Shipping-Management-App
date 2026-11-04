import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { formatYen } from '@/lib/calculations/tax'
import { amountVisibility, type DeliveryAmountMode } from '@/lib/delivery-notes/amount-mode'
import { docTypeMeta, type DeliveryDocType } from '@/lib/delivery-notes/doc-type'
import {
  formatDeliveryNoteItemQty,
  type DeliveryNoteLayout,
} from '@/lib/delivery-notes/driver-note'
import { formatJpDate } from '@/lib/dates'

/** 納品書 / ご注文確認書 PDF（@react-pdf・A4全面 または A4上下2連＝A5×2枚）。 */

export interface DeliveryNotePdfItem {
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  subtotal: number
  tax_rate: number
  spec?: string | null
  packs_per_case?: number | null
}

export interface DeliveryNoteSheetProps {
  customerName: string
  date: string
  mode?: DeliveryAmountMode
  docType?: DeliveryDocType
  layout?: DeliveryNoteLayout
  issuer: { name: string; address: string | null; tel: string | null }
  items: DeliveryNotePdfItem[]
  totals: { subtotal8: number; subtotal10: number; total: number }
}

export interface DeliveryNotePdfProps extends DeliveryNoteSheetProps {
  /** 複数取引先の一括印刷用（指定時は sheets の各要素を1ページずつ出力） */
  sheets?: DeliveryNoteSheetProps[]
}

const C = { ink: '#1a1410', soft: '#5c4f42', faint: '#8c7e6d', line: '#d8cbb8' }

const s = StyleSheet.create({
  pageFull: {
    fontFamily: 'JP',
    fontSize: 10,
    color: C.ink,
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 40,
  },
  page2Up: {
    fontFamily: 'JP',
    fontSize: 9,
    color: C.ink,
    paddingVertical: 22,
    paddingHorizontal: 34,
    justifyContent: 'space-between',
  },
  halfBlock: {
    height: 372,
    justifyContent: 'space-between',
  },
  cutLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  cutDash: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomStyle: 'dashed',
    borderBottomColor: C.faint,
  },
  cutLabel: {
    fontSize: 8,
    color: C.faint,
    paddingHorizontal: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleFull: { fontSize: 22, fontWeight: 'bold' },
  title2Up: { fontSize: 17, fontWeight: 'bold' },
  metaR: { textAlign: 'right', color: C.soft, fontSize: 9.5 },
  partiesRowFull: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 20,
  },
  partiesRow2Up: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  toNameFull: {
    fontSize: 15,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
    paddingBottom: 3,
    minWidth: 220,
  },
  toName2Up: {
    fontSize: 13,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
    paddingBottom: 2,
    minWidth: 200,
  },
  issuer: { textAlign: 'right', color: C.soft, lineHeight: 1.4, fontSize: 8.5 },
  issuerName: { color: C.ink, fontWeight: 'bold', fontSize: 11 },
  leadFull: { marginTop: 12, color: C.soft, fontSize: 9.5 },
  lead2Up: { marginTop: 6, color: C.soft, fontSize: 8.5 },
  tableFull: { marginTop: 10 },
  table2Up: { marginTop: 6 },
  th: {
    flexDirection: 'row',
    borderBottomWidth: 1.2,
    borderBottomColor: C.ink,
    paddingBottom: 4,
    color: C.soft,
    fontWeight: 'bold',
  },
  trFull: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingVertical: 7,
  },
  tr2Up: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingVertical: 5,
  },
  cName: { flex: 1, fontSize: 10.5, fontWeight: 'bold' },
  cBoxes: { width: 95, textAlign: 'right', fontSize: 12, fontWeight: 'bold' },
  cQty: { width: 85, textAlign: 'right', fontSize: 10.5 },
  cPrice: { width: 75, textAlign: 'right' },
  cAmt: { width: 80, textAlign: 'right' },
  cTax: { width: 42, textAlign: 'center' },
  sumWrap: { marginTop: 10, marginLeft: 'auto', width: 220 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  sumTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: C.ink,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 8,
  },
  foot: { color: C.faint, fontSize: 8 },
  signLine: {
    color: C.soft,
    fontSize: 8.5,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingBottom: 2,
    minWidth: 130,
  },
})

function SingleSlipContent({
  sheet,
  isCopy,
  compact,
}: {
  sheet: DeliveryNoteSheetProps
  isCopy: boolean
  compact: boolean
}) {
  const mode = sheet.mode ?? 'full'
  const docType = sheet.docType ?? 'delivery'
  const v = amountVisibility(mode)
  const meta = docTypeMeta(docType)
  const titleText = isCopy ? `${meta.title}（控）` : meta.title

  return (
    <View style={compact ? s.halfBlock : undefined}>
      <View>
        <View style={s.headerRow}>
          <Text style={compact ? s.title2Up : s.titleFull}>{titleText}</Text>
          <View style={s.metaR}>
            <Text>
              {meta.dateLabel}: {formatJpDate(sheet.date)}
            </Text>
          </View>
        </View>

        <View style={compact ? s.partiesRow2Up : s.partiesRowFull}>
          <Text style={compact ? s.toName2Up : s.toNameFull}>{sheet.customerName} 御中</Text>
          <View style={s.issuer}>
            <Text style={s.issuerName}>{sheet.issuer.name || '小島農園'}</Text>
            {sheet.issuer.address ? <Text>{sheet.issuer.address}</Text> : null}
            {sheet.issuer.tel ? <Text>TEL: {sheet.issuer.tel}</Text> : null}
          </View>
        </View>

        <Text style={compact ? s.lead2Up : s.leadFull}>{meta.lead}</Text>

        <View style={compact ? s.table2Up : s.tableFull}>
          <View style={s.th}>
            <Text style={{ flex: 1 }}>品目・規格</Text>
            <Text style={{ width: 95, textAlign: 'right' }}>箱数（ケース）</Text>
            <Text style={{ width: 85, textAlign: 'right' }}>総数量</Text>
            {v.showAmountCols && <Text style={s.cPrice}>単価</Text>}
            {v.showAmountCols && <Text style={s.cAmt}>金額(税抜)</Text>}
            {v.showTaxCol && <Text style={s.cTax}>税率</Text>}
          </View>
          {sheet.items.map((it, i) => {
            const qInfo = formatDeliveryNoteItemQty({
              customerName: sheet.customerName,
              productName: it.product_name,
              quantity: it.quantity,
              unit: it.unit,
              spec: it.spec,
              packsPerCase: it.packs_per_case,
            })
            return (
              <View key={i} style={compact ? s.tr2Up : s.trFull}>
                <Text style={s.cName}>{qInfo.displayName}</Text>
                <Text style={s.cBoxes}>{qInfo.boxCountText}</Text>
                <Text style={s.cQty}>{qInfo.totalQtyText}</Text>
                {v.showAmountCols && (
                  <Text style={s.cPrice}>{v.fillAmounts ? formatYen(it.unit_price) : ''}</Text>
                )}
                {v.showAmountCols && (
                  <Text style={s.cAmt}>{v.fillAmounts ? formatYen(it.subtotal) : ''}</Text>
                )}
                {v.showTaxCol && (
                  <Text style={s.cTax}>
                    {it.tax_rate}%{it.tax_rate === 8 ? '※' : ''}
                  </Text>
                )}
              </View>
            )
          })}
        </View>

        {v.showTotals && (
          <View style={s.sumWrap}>
            <View style={s.sumRow}>
              <Text style={{ color: C.soft }}>8%対象 税抜</Text>
              <Text>{v.fillTotals ? formatYen(sheet.totals.subtotal8) : ''}</Text>
            </View>
            <View style={s.sumRow}>
              <Text style={{ color: C.soft }}>10%対象 税抜</Text>
              <Text>{v.fillTotals ? formatYen(sheet.totals.subtotal10) : ''}</Text>
            </View>
            <View style={s.sumTotal}>
              <Text style={{ fontWeight: 'bold' }}>合計（税込）</Text>
              <Text style={{ fontWeight: 'bold', fontSize: 11 }}>
                {v.fillTotals ? formatYen(sheet.totals.total) : ''}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={s.bottomRow}>
        <View>
          {v.showTaxCol && <Text style={s.foot}>※ は軽減税率（8%）対象品目です。</Text>}
          {mode === 'none' && <Text style={s.foot}>※ 金額は別途、請求書にてご案内いたします。</Text>}
        </View>
        {isCopy && <Text style={s.signLine}>確認・メモ：</Text>}
      </View>
    </View>
  )
}

export function DeliveryNotePdf(props: DeliveryNotePdfProps) {
  const sheets: DeliveryNoteSheetProps[] =
    props.sheets && props.sheets.length > 0 ? props.sheets : [props]

  return (
    <Document>
      {sheets.map((sheet, idx) => {
        const layout = sheet.layout ?? props.layout ?? 'full'
        if (layout === '2up') {
          return (
            <Page key={idx} size="A4" style={s.page2Up}>
              <SingleSlipContent sheet={sheet} isCopy={false} compact={true} />
              <View style={s.cutLineRow}>
                <View style={s.cutDash} />
                <Text style={s.cutLabel}>切り取り線（上：納品書 ／ 下：納品書控）</Text>
                <View style={s.cutDash} />
              </View>
              <SingleSlipContent sheet={sheet} isCopy={true} compact={true} />
            </Page>
          )
        }
        return (
          <Page key={idx} size="A4" style={s.pageFull}>
            <SingleSlipContent sheet={sheet} isCopy={false} compact={false} />
          </Page>
        )
      })}
    </Document>
  )
}
