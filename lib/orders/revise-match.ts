import { foldKana } from '@/lib/normalize/kana'

/**
 * AI 修正（/api/orders/revise）の明細を DB の明細に「鍵（line_key = order_items.id）」で対応付ける。
 * AI が明細を並べ替える・増減する・品目を取り違えると別の明細の数量で上書きされうるため、
 * 1件でも対応付けられなければ全体を拒否する（何も書かない）。
 */
export const REVISION_MISMATCH_MESSAGE =
  'AI の修正結果の明細が元の注文と一致しなかったため、保存していません。指示を変えてもう一度試すか、数量を直接直してください'

export class RevisionMismatchError extends Error {
  constructor(public readonly detail?: string) {
    super(REVISION_MISMATCH_MESSAGE)
    this.name = 'RevisionMismatchError'
  }
}

/** 品目名の照合キー（全角半角・ひらがなカタカナ・空白の表記ゆれを吸収。照合専用） */
export function productNameKey(s: string | null | undefined): string {
  return foldKana((s ?? '').normalize('NFKC')).replace(/[\s　]/g, '').toLowerCase()
}

export type DbLine = { id: string; product_name: string; product_id?: string | null }
export type AiLine = { line_key?: string | null; product_name?: string | null; raw_name?: string | null; product_id?: string | null }

/**
 * AI の明細を鍵で DB の明細に対応付ける。鍵の欠落・重複・未知・件数不一致・品目の取り違えなら
 * RevisionMismatchError を投げる。戻り値は DB の明細と AI の明細の組（DB の順）。
 */
export function matchRevisedLines<D extends DbLine, A extends AiLine>(dbLines: D[], aiLines: A[]): Array<{ db: D; ai: A }> {
  const byKey = new Map<string, A>()
  for (const ai of aiLines) {
    const key = typeof ai.line_key === 'string' ? ai.line_key.trim() : ''
    if (!key) throw new RevisionMismatchError('鍵の欠落')
    if (byKey.has(key)) throw new RevisionMismatchError(`鍵の重複: ${key}`)
    byKey.set(key, ai)
  }
  const dbIds = new Set(dbLines.map((d) => d.id))
  for (const key of byKey.keys()) {
    if (!dbIds.has(key)) throw new RevisionMismatchError(`未知の鍵: ${key}`)
  }
  if (byKey.size !== dbLines.length) throw new RevisionMismatchError('件数の不一致')
  return dbLines.map((db) => {
    const ai = byKey.get(db.id)!
    const sameProduct =
      db.product_id && ai.product_id
        ? db.product_id === ai.product_id
        : productNameKey(ai.product_name ?? ai.raw_name) === productNameKey(db.product_name)
    if (!sameProduct) throw new RevisionMismatchError(`品目の取り違え: ${db.product_name} → ${ai.product_name ?? ai.raw_name}`)
    return { db, ai }
  })
}
