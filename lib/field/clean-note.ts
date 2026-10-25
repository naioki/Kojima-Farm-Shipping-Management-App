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
