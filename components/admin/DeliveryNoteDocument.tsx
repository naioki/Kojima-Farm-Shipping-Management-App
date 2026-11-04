import { formatYen } from '@/lib/calculations/tax'
import { amountVisibility, type DeliveryAmountMode } from '@/lib/delivery-notes/amount-mode'
import { docTypeMeta, type DeliveryDocType } from '@/lib/delivery-notes/doc-type'
import {
  formatDeliveryNoteItemQty,
  type DeliveryNoteLayout,
} from '@/lib/delivery-notes/driver-note'
import { formatJpDate } from '@/lib/dates'

export interface DeliveryNoteDocumentProps {
  /** 保存済み納品書なら番号を表示（ライブプレビューでは省略） */
  noteNumber?: string
  customerName: string
  /** 納品日 'YYYY-MM-DD' */
  date: string
  issuer: { name: string | null; address: string | null; tel: string | null }
  items: {
    product_name: string
    quantity: number
    unit: string
    unit_price: number
    subtotal: number
    tax_rate: number
    spec?: string | null
    packs_per_case?: number | null
  }[]
  totals: { subtotal8: number; subtotal10: number; total: number }
  mode: DeliveryAmountMode
  /** 書面の種類（納品書 / ご注文確認書）。既定は納品書。 */
  docType?: DeliveryDocType
  /** 用紙レイアウト（'2up' = A4上下2連（A5×2枚：納品書＋控）、'full' = A4全面1枚） */
  layout?: DeliveryNoteLayout
}

function SlipSection({
  noteNumber,
  customerName,
  date,
  issuer,
  items,
  totals,
  mode,
  docType = 'delivery',
  isCopy = false,
  compact = false,
}: DeliveryNoteDocumentProps & { isCopy?: boolean; compact?: boolean }) {
  const v = amountVisibility(mode)
  const meta = docTypeMeta(docType)
  const titleText = isCopy ? `${meta.title}（控）` : meta.title

  return (
    <div className={compact ? 'space-y-3 py-2' : 'space-y-6'}>
      <header className="flex items-start justify-between">
        <h1 className={`font-display font-bold text-ink ${compact ? 'text-xl' : 'text-2xl'}`}>
          {titleText}
        </h1>
        <div className="text-right text-sm text-ink-soft">
          {noteNumber && <p className="num font-bold text-ink">{noteNumber}</p>}
          <p>
            {meta.dateLabel}: <span className="num font-bold text-ink">{formatJpDate(date)}</span>
          </p>
        </div>
      </header>

      <div className="flex items-end justify-between gap-6">
        <p className={`border-b border-ink pb-1 font-bold text-ink ${compact ? 'text-base' : 'text-lg'}`}>
          {customerName} 御中
        </p>
        <div className="text-right text-sm text-ink-soft">
          <p className="font-bold text-ink text-base">{issuer.name ?? '小島農園'}</p>
          {issuer.address && <p>{issuer.address}</p>}
          {issuer.tel && <p>TEL: {issuer.tel}</p>}
        </div>
      </div>

      <p className="text-sm text-ink-soft">{meta.lead}</p>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left text-ink-soft">
            <th className="py-2 font-bold">品目・規格</th>
            <th className="num py-2 text-right font-bold">箱数（ケース）</th>
            <th className="num py-2 text-right font-bold">総数量</th>
            {v.showAmountCols && <th className="num py-2 text-right font-medium">単価</th>}
            {v.showAmountCols && <th className="num py-2 text-right font-medium">金額(税抜)</th>}
            {v.showTaxCol && <th className="py-2 text-center font-medium">税率</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const qInfo = formatDeliveryNoteItemQty({
              customerName,
              productName: it.product_name,
              quantity: it.quantity,
              unit: it.unit,
              spec: it.spec,
              packsPerCase: it.packs_per_case,
            })
            return (
              <tr key={i} className="border-b border-line">
                <td className="py-2 font-bold text-ink">{qInfo.displayName}</td>
                <td className="num py-2 text-right text-base font-black tabular-nums text-ink">
                  {qInfo.boxCountText}
                </td>
                <td className="num py-2 text-right font-bold tabular-nums text-ink">
                  {qInfo.totalQtyText}
                </td>
                {v.showAmountCols && (
                  <td className="num py-2 text-right tabular-nums text-ink-soft">
                    {v.fillAmounts ? formatYen(it.unit_price) : ''}
                  </td>
                )}
                {v.showAmountCols && (
                  <td className="num py-2 text-right tabular-nums text-ink">
                    {v.fillAmounts ? formatYen(it.subtotal) : ''}
                  </td>
                )}
                {v.showTaxCol && (
                  <td className="py-2 text-center text-ink-soft">
                    {it.tax_rate}%{it.tax_rate === 8 ? ' ※' : ''}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {v.showTotals && (
        <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-soft">8%対象 税抜</span>
            <span className="num tabular-nums text-ink">{v.fillTotals ? formatYen(totals.subtotal8) : ''}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-soft">10%対象 税抜</span>
            <span className="num tabular-nums text-ink">{v.fillTotals ? formatYen(totals.subtotal10) : ''}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-ink pt-1">
            <span className="font-bold text-ink">合計（税込）</span>
            <span className="num text-lg font-bold tabular-nums text-ink">
              {v.fillTotals ? formatYen(totals.total) : ''}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-4 pt-2">
        <div>
          {v.showTaxCol && <p className="text-xs text-ink-faint">※ は軽減税率（8%）対象品目です。</p>}
          {mode === 'none' && <p className="text-xs text-ink-faint">※ 金額は別途、請求書にてご案内いたします。</p>}
        </div>
        {isCopy && (
          <p className="border-b border-line-strong pb-1 text-xs text-ink-soft min-w-[140px]">
            確認・メモ：
          </p>
        )}
      </div>
    </div>
  )
}

export function DeliveryNoteDocument(props: DeliveryNoteDocumentProps) {
  const layout = props.layout ?? 'full'

  if (layout === '2up') {
    return (
      <article className="space-y-6 rounded-lg border border-line bg-bg-card p-6 sm:p-8 print:border-0 print:p-0">
        <SlipSection {...props} isCopy={false} compact={true} />
        <div className="flex items-center gap-3 py-2 text-xs text-ink-faint">
          <div className="flex-1 border-b border-dashed border-line-strong" />
          <span>✂ 切り取り線（上：運転手渡し納品書 ／ 下：農園控え）</span>
          <div className="flex-1 border-b border-dashed border-line-strong" />
        </div>
        <SlipSection {...props} isCopy={true} compact={true} />
      </article>
    )
  }

  return (
    <article className="space-y-6 rounded-lg border border-line bg-bg-card p-8 print:border-0 print:p-0">
      <SlipSection {...props} isCopy={false} compact={false} />
    </article>
  )
}
