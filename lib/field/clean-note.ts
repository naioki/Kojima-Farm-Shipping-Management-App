/**
 * AI取込やシステム自動生成で `orders.note` / `order_items.line_note` に付与される
 * 内部メタ情報（伝票No・数量表記・規格・容器・箱数など）を除去し、
 * 現場スタッフやドライバーが本当に読むべき伝達事項のみを抽出するユーティリティ。
 */
export function extractActionableNote(rawNote: string | null | undefined): string {
  if (!rawNote) return ''

  // 改行または「 / 」で分割してトークン単位で検査
  const parts = rawNote
    .split(/\r?\n|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const actionable: string[] = []

  for (const part of parts) {
    // 1. 純粋なシステムメタ情報は除外
    if (/^伝票No\s*[:：]/i.test(part)) continue
    if (/^規格\s*[:：]/i.test(part)) continue
    if (/^数量表記\s*[:：]/i.test(part)) continue
    if (/^容器\s*[:：]/i.test(part)) continue
    if (/^箱数\s*[:：]/i.test(part)) continue
    if (/^袋\s*[:：]/i.test(part)) continue
    if (/^総数\d+点（\d+ケース[＋+]\s*端数\d+点）$/.test(part)) continue
    if (/^【納入先[:：][^】]+】$/.test(part)) continue
    if (/^(?:納入先|お届け先|配送先)\s*[:：]/i.test(part)) continue

    // 2. 重複しやすい定型プレフィックスを整形
    const cleaned = part
      .replace(/^【要返答】\s*/, '')
      .replace(/(?:納入先|お届け先|配送先)[^\n,、・\]】]+[\]】]?/g, '')
      .trim()

    if (!cleaned) continue
    if (!actionable.includes(cleaned)) {
      actionable.push(cleaned)
    }
  }

  return actionable.join(' / ')
}

/**
 * 備考・明細メモから「165→150P」「204→201P」「入数30→20」のような
 * 最新FAX更新や手書き修正による変更履歴バッジ文字列（1行・短文）を抽出する。
 */
export function extractChangeDiffBadge(rawNote: string | null | undefined): string | null {
  if (!rawNote) return null
  const text = rawNote.normalize('NFKC')

  // 1. 「165→150P」や「数量変更: 10/25 15:41 165→150P」「手書き修正（165→150P）」
  const arrowMatch = text.match(/(\d+)\s*P?\s*(?:→|->|⇒)\s*(\d+)\s*P?(?:点|パック)?/)
  if (arrowMatch && arrowMatch[1] !== arrowMatch[2]) {
    // 直前（または直後の単位）が「入数」「入」かどうかで判定
    const prefix = text.slice(Math.max(0, (arrowMatch.index ?? 0) - 6), arrowMatch.index ?? 0)
    const suffix = text.slice(
      (arrowMatch.index ?? 0) + arrowMatch[0].length,
      Math.min(text.length, (arrowMatch.index ?? 0) + arrowMatch[0].length + 2),
    )
    if (prefix.includes('入数') || suffix.startsWith('入')) {
      return `入数 ${arrowMatch[1]}→${arrowMatch[2]}`
    }
    return `${arrowMatch[1]}→${arrowMatch[2]}P`
  }

  // 2. 「入数変更（20入）」のような記載
  if (text.includes('入数変更')) {
    const unitMatch = text.match(/入数\s*(\d+)/)
    return unitMatch ? `入数変更(${unitMatch[1]}入)` : '入数変更'
  }

  // 3. 「手書き修正（150点）」のような単一値記載
  const handMatch = text.match(/手書き修正[（(](\d+)(?:点|P|パック)?[）)]/)
  if (handMatch) {
    return `手書き確定(${handMatch[1]}P)`
  }

  return null
}
