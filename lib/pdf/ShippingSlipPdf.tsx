import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

/**
 * 品目別出荷票 PDF（@react-pdf・A4縦）。写真の和郷園伝票フォーマットを再現。
 * ヘッダー会社名は取引先ごとに選択／記入で切替（発行時に確定）。1品目＝1ページ。
 */

/** 用紙サイズ（A4縦 / A5縦）。 */
export type SlipPaperSize = 'A4' | 'A5'

export interface ShippingSlip {
  /** ヘッダー会社名（例: 和郷園）。取引先ごとに選択／記入で変わる。 */
  headerCompany: string
  /** 行先（例: パルシステム生活協同連合会 相模センター）。改行は \n。 */
  destination: string
  /** 商品名（例: 徳用トマト）。 */
  productName: string
  /** 出荷日（整形済み。例: 7月8日(水)）。 */
  shipDate: string
  /** 規格（例: 1kg）。 */
  spec: string
  /** 入数（1ケースあたり）。 */
  iri: string
  /** ケース数。 */
  caseCount: string
  /** 端数。 */
  hasu: string
  /** 端数のケース数。 */
  hasuCaseCount: string
  /** TOTAL数。 */
  total: string
  /** マテハン名（例: 青コン）。 */
  mateHan: string
}

const C = { ink: '#1a1410', line: '#1a1410', soft: '#555' }

/** 用紙サイズごとの寸法。A5 は A4 の約7割で全体を縮小する。 */
function styleFor(size: SlipPaperSize) {
  const a5 = size === 'A5'
  return StyleSheet.create({
    page: {
      fontFamily: 'JP',
      color: C.ink,
      paddingTop: a5 ? 28 : 40,
      paddingBottom: a5 ? 28 : 40,
      paddingHorizontal: a5 ? 34 : 48,
      fontSize: a5 ? 10 : 13,
    },
    title: { fontSize: a5 ? 16 : 22, fontWeight: 'bold', textAlign: 'center', marginBottom: a5 ? 12 : 18 },
    table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: C.line },
    row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.line, minHeight: a5 ? 30 : 40 },
    rowTall: { minHeight: a5 ? 42 : 56 },
    cell: { borderRightWidth: 1, borderColor: C.line, paddingHorizontal: a5 ? 6 : 8, justifyContent: 'center' },
    label: { width: a5 ? 70 : 92, backgroundColor: '#f4f1ec' },
    labelText: { fontSize: a5 ? 9 : 11, color: C.soft },
    value: { flex: 1 },
    valueText: { fontSize: a5 ? 10 : 13 },
    bigText: { fontSize: a5 ? 12 : 16, fontWeight: 'bold' },
  })
}

type Styles = ReturnType<typeof styleFor>

/** ラベル＋値の1行（2セル）。 */
function Row2({ s, label, children, tall }: { s: Styles; label: string; children: React.ReactNode; tall?: boolean }) {
  return (
    <View style={[s.row, tall ? s.rowTall : {}]}>
      <View style={[s.cell, s.label]}>
        <Text style={s.labelText}>{label}</Text>
      </View>
      <View style={[s.cell, s.value]}>{children}</View>
    </View>
  )
}

/** 入数／端数の4セル行（ラベル・値・ラベル・値）。 */
function Row4({ s, l1, v1, l2, v2 }: { s: Styles; l1: string; v1: string; l2: string; v2: string }) {
  return (
    <View style={s.row}>
      <View style={[s.cell, s.label]}>
        <Text style={s.labelText}>{l1}</Text>
      </View>
      <View style={[s.cell, s.value]}>
        <Text style={s.valueText}>{v1}</Text>
      </View>
      <View style={[s.cell, s.label]}>
        <Text style={s.labelText}>{l2}</Text>
      </View>
      <View style={[s.cell, s.value]}>
        <Text style={s.valueText}>{v2}</Text>
      </View>
    </View>
  )
}

export function ShippingSlipPdf({ slips, size = 'A4' }: { slips: ShippingSlip[]; size?: SlipPaperSize }) {
  const s = styleFor(size)
  return (
    <Document>
      {slips.map((slip, i) => (
        <Page key={i} size={size} style={s.page}>
          <Text style={s.title}>{slip.headerCompany}</Text>

          <View style={s.table}>
            <Row2 s={s} label="行先" tall>
              <Text style={s.bigText}>{slip.destination}</Text>
            </Row2>
            <Row2 s={s} label="商品名">
              <Text style={s.bigText}>{slip.productName}</Text>
            </Row2>
            <Row2 s={s} label="出荷日">
              <Text style={s.bigText}>{slip.shipDate}</Text>
            </Row2>
            <Row2 s={s} label="規格">
              <Text style={s.valueText}>{slip.spec}</Text>
            </Row2>
            <Row4 s={s} l1="入数" v1={slip.iri} l2="ケース数" v2={slip.caseCount} />
            <Row4 s={s} l1="端数" v1={slip.hasu} l2="ケース数" v2={slip.hasuCaseCount} />
            <Row2 s={s} label="TOTAL数">
              <Text style={s.bigText}>{slip.total}</Text>
            </Row2>
            <Row2 s={s} label="マテハン名">
              <Text style={s.bigText}>{slip.mateHan}</Text>
            </Row2>
          </View>
        </Page>
      ))}
    </Document>
  )
}
