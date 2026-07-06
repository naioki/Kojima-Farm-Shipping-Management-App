import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import {
  aggregateForDeliveryNote,
  fitFontSize,
  rearrangeCutAndStack,
  resolveSingleCustomerName,
  type ShippingDocEntry,
  type ShippingLabel,
} from '@/lib/calculations/shipping-docs'

/**
 * 出荷ラベル PDF（@react-pdf・A4を2列×4段の8分割）＋ 1ページ目に出荷一覧表。
 * v4 の LabelPDFGenerator と同一の確定仕様:
 *   - Cut and Stack: 裁断後に重ねるだけで供給先順が揃う再配置
 *   - ラベル4象限: 左上=供給先（最大）／右上=通し番号／左下=品目／右下=入り数
 *   - 端数箱だけ強調（太い破線枠・中央二重線・「！」透かし・数量特大）
 * 供給先は「取引先＞納入先」解決済みの表示名（例: ヨーク 東道野辺／寺崎）。
 */

export interface ShippingLabelsPdfProps {
  /** 一覧表用の明細（供給先・品目単位） */
  entries: ShippingDocEntry[]
  /** Cut and Stack 配置前のラベル列（buildLabels の出力） */
  labels: ShippingLabel[]
  /** 例: 7月5日 */
  dateDisplay: string
}

// A4 = 595.28 × 841.89pt。ラベル = 297.64 × 210.47pt（2列×4段）
const PAGE_W = 595.28
const PAGE_H = 841.89
const LABEL_W = PAGE_W / 2
const LABEL_H = PAGE_H / 4
const PER_PAGE = 8
const INK = '#1a1410'
const GRAY = '#9ca3af'

const s = StyleSheet.create({
  summaryPage: { fontFamily: 'JP', color: INK, fontSize: 12, paddingTop: 40, paddingHorizontal: 30 },
  customerHeading: { fontSize: 14, color: '#555', marginBottom: 4 },
  summaryTitle: { fontSize: 24, marginBottom: 16 },
  th: { flexDirection: 'row', backgroundColor: '#c0c0c0', borderWidth: 1, borderColor: '#666' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#666' },
  trAlt: { backgroundColor: '#f0f0f0' },
  cDest: { flex: 2.2, padding: 6 },
  cItem: { flex: 2.4, padding: 6 },
  cNum: { width: 62, padding: 6, textAlign: 'center' },
  cTotal: { width: 76, padding: 6, textAlign: 'center' },
  cCont: { width: 64, padding: 6, textAlign: 'center', fontWeight: 'bold' },
  totalRow: { flexDirection: 'row', backgroundColor: '#dcdcdc', borderWidth: 1, borderColor: '#666' },

  noteTitle: { fontSize: 14, marginTop: 26, marginBottom: 8 },
  noteTh: { flexDirection: 'row', backgroundColor: '#d0d0d0', borderWidth: 0.8, borderColor: '#888' },
  noteTr: { flexDirection: 'row', borderBottomWidth: 0.8, borderLeftWidth: 0.8, borderRightWidth: 0.8, borderColor: '#888' },
  noteTrAlt: { backgroundColor: '#f5f5f5' },
  nItem: { flex: 1.6, padding: 5, fontSize: 10 },
  nSpec: { flex: 1.2, padding: 5, fontSize: 10 },
  nQty: { width: 56, padding: 5, fontSize: 10, textAlign: 'right' },
  nUnit: { width: 46, padding: 5, fontSize: 10 },
  nBlank: { flex: 1, padding: 5, fontSize: 10 },

  labelPage: { fontFamily: 'JP', color: INK },
  label: { position: 'absolute', width: LABEL_W, height: LABEL_H },
  guide: { position: 'absolute', borderColor: GRAY, opacity: 0.3, borderStyle: 'dashed' },
  quad: { position: 'absolute', width: LABEL_W / 2, height: LABEL_H / 2 - 14, justifyContent: 'center', alignItems: 'center' },
  date: { position: 'absolute', bottom: 8, left: 0, width: LABEL_W, textAlign: 'center' },
  fracFrame: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: LABEL_W - 8,
    height: LABEL_H - 8,
    borderWidth: 3,
    borderColor: INK,
    borderStyle: 'dashed',
  },
  fracMid: { position: 'absolute', left: 6, width: LABEL_W - 12, borderTopWidth: 2, borderTopColor: INK },
  fracWatermark: {
    position: 'absolute',
    left: 0,
    top: 30,
    width: LABEL_W,
    textAlign: 'center',
    fontSize: 130,
    opacity: 0.08,
  },
})

/** 供給先ごとのコンテナ数（フル箱＋端数箱）。一覧表のコンテナ列・合計に使う。 */
function containerCounts(entries: ShippingDocEntry[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entries) {
    const cont = e.boxes + (e.remainder > 0 ? 1 : 0)
    m.set(e.destination, (m.get(e.destination) ?? 0) + cont)
  }
  return m
}

function SummaryPage({ entries, dateDisplay }: { entries: ShippingDocEntry[]; dateDisplay: string }) {
  const containers = containerCounts(entries)
  const totalContainers = [...containers.values()].reduce((a, b) => a + b, 0)
  const singleCustomer = resolveSingleCustomerName(entries)
  const noteLines = aggregateForDeliveryNote(entries)
  let prevDest: string | null = null
  return (
    <Page size="A4" style={s.summaryPage}>
      {singleCustomer && <Text style={s.customerHeading}>出荷先名前：{singleCustomer}</Text>}
      <Text style={s.summaryTitle}>【出荷一覧表】 {dateDisplay}</Text>
      <View style={s.th}>
        <Text style={s.cDest}>供給先</Text>
        <Text style={s.cItem}>品目</Text>
        <Text style={s.cNum}>フル箱</Text>
        <Text style={s.cNum}>端数箱</Text>
        <Text style={s.cTotal}>合計</Text>
        <Text style={s.cCont}>コンテナ</Text>
      </View>
      {entries.map((e, i) => {
        const firstOfDest = e.destination !== prevDest
        prevDest = e.destination
        const itemDisplay = e.spec ? `${e.item} ${e.spec}` : e.item
        return (
          <View key={i} style={[s.tr, ...(i % 2 === 1 ? [s.trAlt] : [])]}>
            <Text style={s.cDest}>{firstOfDest ? e.destination : ''}</Text>
            <Text style={s.cItem}>{itemDisplay}</Text>
            <Text style={s.cNum}>{e.unitsPerBox > 0 ? e.boxes : '—'}</Text>
            <Text style={s.cNum}>{e.remainder > 0 ? `${e.remainder}${e.unitLabel}` : '—'}</Text>
            <Text style={s.cTotal}>{`${e.totalQty}${e.unitLabel}`}</Text>
            <Text style={s.cCont}>{firstOfDest ? String(containers.get(e.destination) ?? 0) : ''}</Text>
          </View>
        )
      })}
      <View style={s.totalRow}>
        <Text style={s.cDest}>合計</Text>
        <Text style={s.cItem} />
        <Text style={s.cNum} />
        <Text style={s.cNum} />
        <Text style={s.cTotal} />
        <Text style={s.cCont}>{totalContainers}</Text>
      </View>

      {/* 納品書（品目×規格の合算・単価/金額/備考は手書き記入欄） */}
      <Text style={s.noteTitle}>【納品書】</Text>
      <View style={s.noteTh}>
        <Text style={s.nItem}>品目</Text>
        <Text style={s.nSpec}>規格</Text>
        <Text style={s.nQty}>数量</Text>
        <Text style={s.nUnit}>単位</Text>
        <Text style={s.nBlank}>単価</Text>
        <Text style={s.nBlank}>金額</Text>
        <Text style={s.nBlank}>備考</Text>
      </View>
      {noteLines.map((n, i) => (
        <View key={i} style={[s.noteTr, ...(i % 2 === 1 ? [s.noteTrAlt] : [])]}>
          <Text style={s.nItem}>{n.item}</Text>
          <Text style={s.nSpec}>{n.spec || '—'}</Text>
          <Text style={s.nQty}>{n.totalQty}</Text>
          <Text style={s.nUnit}>{n.unitLabel}</Text>
          <Text style={s.nBlank} />
          <Text style={s.nBlank} />
          <Text style={s.nBlank} />
        </View>
      ))}
    </Page>
  )
}

function LabelCell({ label, dateDisplay }: { label: ShippingLabel; dateDisplay: string }) {
  const halfW = LABEL_W / 2 - 12
  return (
    <>
      {label.isFraction && (
        <>
          <Text style={s.fracWatermark}>！</Text>
          <View style={s.fracFrame} />
          <View style={[s.fracMid, { top: LABEL_H / 2 }]} />
          <View style={[s.fracMid, { top: LABEL_H / 2 + 3, borderTopWidth: 1.2 }]} />
        </>
      )}
      {/* Q1 左上: 供給先（最重要・最大） */}
      <View style={[s.quad, { left: 0, top: 0 }]}>
        <Text style={{ fontSize: fitFontSize(label.destination, 38, halfW) }}>{label.destination}</Text>
      </View>
      {/* Q2 右上: 通し番号 */}
      <View style={[s.quad, { left: LABEL_W / 2, top: 0 }]}>
        <Text style={{ fontSize: fitFontSize(label.sequence, 30, halfW) }}>{label.sequence}</Text>
      </View>
      {/* Q3 左下: 品目 */}
      <View style={[s.quad, { left: 0, top: LABEL_H / 2 }]}>
        <Text style={{ fontSize: fitFontSize(label.item, 34, halfW) }}>{label.item}</Text>
      </View>
      {/* Q4 右下: 入り数（端数箱は特大） */}
      <View style={[s.quad, { left: LABEL_W / 2, top: LABEL_H / 2 }]}>
        <Text style={{ fontSize: fitFontSize(label.quantityText, label.isFraction ? 44 : 26, halfW) }}>
          {label.quantityText}
        </Text>
      </View>
      <Text style={[s.date, { fontSize: label.isFraction ? 16 : 12 }]}>{dateDisplay}</Text>
    </>
  )
}

export function ShippingLabelsPdf({ entries, labels, dateDisplay }: ShippingLabelsPdfProps) {
  const arranged = rearrangeCutAndStack(labels, PER_PAGE)
  const pageCount = Math.ceil(arranged.length / PER_PAGE)
  return (
    <Document>
      <SummaryPage entries={entries} dateDisplay={dateDisplay} />
      {Array.from({ length: pageCount }, (_, p) => (
        <Page key={p} size="A4" style={s.labelPage}>
          {arranged.slice(p * PER_PAGE, (p + 1) * PER_PAGE).map((label, slot) => {
            if (!label) return null
            const col = slot % 2
            const row = Math.floor(slot / 2)
            return (
              <View key={slot} style={[s.label, { left: col * LABEL_W, top: row * LABEL_H }]}>
                {/* 切断ガイド（薄い破線） */}
                {col === 0 && (
                  <View style={[s.guide, { right: 0, top: 0, height: LABEL_H, borderRightWidth: 0.5 }]} />
                )}
                {row < 3 && (
                  <View style={[s.guide, { left: 0, bottom: 0, width: LABEL_W, borderBottomWidth: 0.5 }]} />
                )}
                <LabelCell label={label} dateDisplay={dateDisplay} />
              </View>
            )
          })}
        </Page>
      ))}
    </Document>
  )
}
