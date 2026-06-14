import { formatYen } from '@/lib/calculations/tax'
import { amountVisibility, type DeliveryAmountMode } from '@/lib/delivery-notes/amount-mode'
import { docTypeMeta, type DeliveryDocType } from '@/lib/delivery-notes/doc-type'

export interface DeliveryNoteDocumentProps {
  /** 保存済み納品書なら番号を表示（ライブプレビューでは省略） */
  noteNumber?: string
  customerName: string
  /** 納品日 'YYYY-MM-DD' */
  date: string
  issuer: { name: string | null; address: string | null; tel: string | null }
  items: { product_name: string; quantity: number; unit: string; unit_price: number; subtotal: number; tax_rate: number }[]
  totals: { subtotal8: number; subtotal10: number; total: number }
  mode: DeliveryAmountMode
  /** 書面の種類（納品書 / ご注文確認書）。既定は納品書。 */
  docType?: DeliveryDocType
}

/**
 * 納品書の書面本体（印刷対象）。ライブプレビュー（view）と保存済み詳細（[id]）で共有し、
 * 表示内容がズレないようにする。金額モード（金額あり／後から手書き／金額なし）で出し分け。
 */
export function DeliveryNoteDocument({
  noteNumber,
  customerName,
  date,
  issuer,
  items,
  totals,
  mode,
  docType = 'delivery',
}: DeliveryNoteDocumentProps) {
  const v = amountVisibility(mode)
  const meta = docTypeMeta(docType)

  return (
    <article className="space-y-6 rounded-lg border border-line bg-bg-card p-8 print:border-0 print:p-0">
      <header className="flex items-start justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{meta.title}</h1>
        <div className="text-right text-sm text-ink-soft">
          {noteNumber && <p className="num font-bold text-ink">{noteNumber}</p>}
          <p>{meta.dateLabel}: <span className="num">{date}</span></p>
        </div>
      </header>

      <div className="flex items-end justify-between gap-6">
        <p className="border-b border-ink pb-1 text-lg font-bold text-ink">{customerName} 御中</p>
        <div className="text-right text-sm text-ink-soft">
          <p className="font-bold text-ink">{issuer.name ?? '小島農園'}</p>
          {issuer.address && <p>{issuer.address}</p>}
          {issuer.tel && <p>TEL: {issuer.tel}</p>}
        </div>
      </div>

      <p className="text-sm text-ink-soft">{meta.lead}</p>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong text-left text-ink-soft">
            <th className="py-2 font-medium">品目</th>
            <th className="num py-2 text-right font-medium">数量</th>
            {v.showAmountCols && <th className="num py-2 text-right font-medium">単価</th>}
            {v.showAmountCols && <th className="num py-2 text-right font-medium">金額(税抜)</th>}
            {v.showTaxCol && <th className="py-2 text-center font-medium">税率</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1.5 text-ink">{it.product_name}</td>
              <td className="num py-1.5 text-right tabular-nums text-ink">
                {it.quantity}
                <span className="ml-0.5 text-xs text-ink-faint">{it.unit}</span>
              </td>
              {v.showAmountCols && (
                <td className="num py-1.5 text-right tabular-nums text-ink-soft">
                  {v.fillAmounts ? formatYen(it.unit_price) : ''}
                </td>
              )}
              {v.showAmountCols && (
                <td className="num py-1.5 text-right tabular-nums text-ink">
                  {v.fillAmounts ? formatYen(it.subtotal) : ''}
                </td>
              )}
              {v.showTaxCol && (
                <td className="py-1.5 text-center text-ink-soft">
                  {it.tax_rate}%{it.tax_rate === 8 ? ' ※' : ''}
                </td>
              )}
            </tr>
          ))}
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

      {v.showTaxCol && <p className="text-xs text-ink-faint">※ は軽減税率（8%）対象品目です。</p>}
      {mode === 'none' && <p className="text-xs text-ink-faint">※ 金額は別途、請求書にてご案内いたします。</p>}
    </article>
  )
}
