import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { fitFontSize, type ShippingDocEntry } from '@/lib/calculations/shipping-docs'

/**
 * 出荷表カード PDF（@react-pdf・A4縦・1明細=1ページ）。コンテナに貼る紙様式。
 * v4 の generate_shipping_form_pdf と同一レイアウト:
 *   供給先／品目／量目／数量（ケース・端数 ＋ 点線 ＋ 合計）／出荷日／生産者名（空欄=手書き）
 * 供給先は「取引先＞納入先」を解決済みの表示名（例: ヨーク 東道野辺）。
 * パック作業時に離れた場所から読めるよう、値は収まる範囲で最大サイズにする。
 */

export interface ShippingSheetPdfProps {
  entries: ShippingDocEntry[]
  /** 出荷日（表示用。例: 7 月　5 日） */
  dateDisplay: string
}

const INK = '#1a1410'
// A4=595.28pt。左右余白56pt → 表幅483pt、ラベル列112pt、値列371pt
const VALUE_W = 371

const s = StyleSheet.create({
  page: { fontFamily: 'JP', color: INK, paddingTop: 48, paddingHorizontal: 56 },
  title: { fontSize: 30, textAlign: 'center', marginBottom: 28 },
  table: { borderWidth: 1.4, borderColor: INK },
  row: { flexDirection: 'row', borderTopWidth: 1.4, borderTopColor: INK },
  rowFirst: { flexDirection: 'row' },
  labelCell: {
    width: 112,
    borderRightWidth: 1.4,
    borderRightColor: INK,
    justifyContent: 'center',
    paddingLeft: 14,
  },
  labelText: { fontSize: 16 },
  valueCell: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  qtyHalf: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  qtyDivider: { borderTopWidth: 0.8, borderTopColor: INK, borderStyle: 'dashed', marginHorizontal: 12 },
})

function Row({
  label,
  height,
  first,
  children,
}: {
  label: string
  height: number
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <View style={[first ? s.rowFirst : s.row, { height }]}>
      <View style={s.labelCell}>
        <Text style={s.labelText}>{label}</Text>
      </View>
      {children}
    </View>
  )
}

function Value({ text, max }: { text: string; max: number }) {
  return (
    <View style={s.valueCell}>
      <Text style={{ fontSize: fitFontSize(text, max, VALUE_W - 20) }}>{text}</Text>
    </View>
  )
}

/** 量目テキスト（例: 「スタンドパック　15袋入」）。規格・入数の有無どちらにも対応。 */
export function volumeText(e: ShippingDocEntry): string {
  const parts: string[] = []
  if (e.spec) parts.push(e.spec)
  if (e.unitsPerBox > 0) parts.push(`${e.unitsPerBox}${e.unitLabel}入`)
  return parts.join('　') || '—'
}

export function ShippingSheetPdf({ entries, dateDisplay }: ShippingSheetPdfProps) {
  return (
    <Document>
      {entries.map((e, idx) => {
        const totalText = `合計 ${e.totalQty}${e.unitLabel}`
        const upperText =
          e.unitsPerBox > 0 ? `${e.boxLabel} ${e.boxes}　　端数 ${e.remainder}` : `${e.boxLabel} —　　端数 —`
        return (
          <Page key={idx} size="A4" style={s.page}>
            <Text style={s.title}>出　荷　表</Text>
            <View style={s.table}>
              <Row label="供給先" height={112} first>
                <Value text={e.destination} max={40} />
              </Row>
              <Row label="品目" height={100}>
                <Value text={e.item} max={36} />
              </Row>
              <Row label="量目" height={74}>
                <Value text={volumeText(e)} max={26} />
              </Row>
              <Row label="数量" height={112}>
                <View style={{ flex: 1 }}>
                  <View style={s.qtyHalf}>
                    <Text style={{ fontSize: fitFontSize(upperText, 26, VALUE_W - 20) }}>{upperText}</Text>
                  </View>
                  <View style={s.qtyDivider} />
                  <View style={s.qtyHalf}>
                    <Text style={{ fontSize: fitFontSize(totalText, 26, VALUE_W - 20) }}>{totalText}</Text>
                  </View>
                </View>
              </Row>
              <Row label="出荷日" height={74}>
                <Value text={dateDisplay} max={24} />
              </Row>
              {/* 生産者名は手書き記入のため空欄 */}
              <Row label="生産者名" height={64}>
                <Value text="" max={24} />
              </Row>
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
