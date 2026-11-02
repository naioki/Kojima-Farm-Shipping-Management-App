/**
 * AI取込やシステム自動生成で `orders.note` / `order_items.line_note` / `deliveries.note` に付与される
 * 内部メタ情報（★新規追加・数量変更ログ・伝票No・数量表記・規格・容器・箱数・単なる便名など）を除去し、
 * 現場スタッフやドライバーが本当に読むべき伝達事項のみを抽出するユーティリティ。
 */
export function extractActionableNote(rawNote: string | null | undefined): string {
  if (!rawNote) return ''

  const parts = rawNote
    .split(/\r?\n|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const actionable: string[] = []

  for (const part of parts) {
    // 1. 純粋なシステムメタ情報・自動生成フラグ・便名単体は現場メモ欄から除外
    if (/^★?新規追加$/i.test(part)) continue
    if (/^★$/i.test(part)) continue
    if (/^【?新規追加】?$/i.test(part)) continue
    if (/^数量変更\s*[:：]/i.test(part)) continue
    if (/^🚨パック済/i.test(part)) continue
    if (/^手書き修正[（(][^）)]+[）)]$/.test(part)) continue
    if (/^入数変更[（(][^）)]+[）)]$/.test(part)) continue
    if (/^伝票No\s*[:：]/i.test(part)) continue
    if (/^規格\s*[:：]/i.test(part)) continue
    if (/^数量表記\s*[:：]/i.test(part)) continue
    if (/^容器\s*[:：]/i.test(part)) continue
    if (/^箱数\s*[:：]/i.test(part)) continue
    if (/^袋\s*[:：]/i.test(part)) continue
    if (/^総数\d+点（\d+ケース[＋+]\s*端数\d+点）$/.test(part)) continue
    if (/^【納入先[:：][^】]+】$/.test(part)) continue
    if (/^(?:納入先|お届け先|配送先)\s*[:：]/i.test(part)) continue
    if (/^(?:NSK|和郷園|農業総研|岩槻|戸田|松戸|柏|相模|川越|直売所|一般|午前|午後)便$/.test(part)) continue

    // 2. 重複しやすい定型プレフィックスを整形
    const cleaned = part
      .replace(/^★?新規追加\s*[\/・,、:]?\s*/g, '')
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
 * `line_note` 内のシステム履歴トークン（数量変更:... / 🚨パック済... / ★新規追加 / 手書き修正(...) 等）のみを抽出し、
 * 人間が現場メモを編集・保存した際にも差分バッジが消えないように保持するユーティリティ。
 */
export function extractSystemTokensFromNote(rawNote: string | null | undefined): string[] {
  if (!rawNote) return []
  const parts = rawNote
    .split(/\r?\n|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const tokens: string[] = []
  for (const part of parts) {
    if (
      /^★?新規追加$/i.test(part) ||
      /^数量変更\s*[:：]/i.test(part) ||
      /^🚨パック済/i.test(part) ||
      /^手書き修正[（(][^）)]+[）)]$/.test(part) ||
      /^入数変更[（(][^）)]+[）)]$/.test(part)
    ) {
      if (!tokens.includes(part)) tokens.push(part)
    }
  }
  return tokens
}

/**
 * システム履歴トークンを維持したまま、人間が入力した現場メモを `line_note` 用に合成する。
 */
export function mergeUserMemoWithSystemTokens(
  existingLineNote: string | null | undefined,
  userMemo: string | null | undefined,
): string | null {
  const sysTokens = extractSystemTokensFromNote(existingLineNote)
  const cleanUser = extractActionableNote(userMemo)
  const combined = [...sysTokens, ...(cleanUser ? [cleanUser] : [])]
  return combined.length > 0 ? combined.join(' / ') : null
}

/**
 * 規格文字列（例: "2〜3株 (入数20)", "入数24"）から冗長な "(入数20)" 等を除去し、
 * カード表面の規格バッジに純粋な規格名のみを表示するためのヘルパー。
 */
export function formatCleanSpecBadge(
  spec: string | null | undefined,
  masterLabelSpec?: string | null,
): string {
  const raw = (spec || masterLabelSpec || '').trim()
  if (!raw) return '標準規格'
  const stripped = raw
    .replace(/[（(]\s*(?:入数|1箱|1ケース)\s*\d+\s*[Pパック入]*\s*[）)]/gi, '')
    .replace(/^(?:入数|1箱|1ケース)\s*\d+\s*[Pパック入]*$/gi, '')
    .trim()
  return stripped || '標準規格'
}

/**
 * 備考・明細メモから「165→150P」「入数30→20」「新規追加」のような
 * 最新FAX更新や手書き修正による変更履歴バッジ文字列（1行・短文）を抽出する。
 */
export function extractChangeDiffBadge(rawNote: string | null | undefined): string | null {
  if (!rawNote) return null
  const text = rawNote.normalize('NFKC')

  // 1. 「165→150P」や「数量変更: 10/25 15:41 165→150P」「手書き修正（165→150P）」
  const arrowMatch = text.match(/(\d+)\s*P?\s*(?:→|->|⇒)\s*(\d+)\s*P?(?:点|パック)?/)
  if (arrowMatch && arrowMatch[1] !== arrowMatch[2]) {
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

  // 4. ★新規追加フラグ（メモ欄ではなく右上の控えめなバッジとして表示）
  if (text.includes('★新規追加')) {
    return '新規追加'
  }

  return null
}
