/**
 * AI読み取りに使った入力の種類から、受注経路を推定する（純関数）。
 * 推定はあくまで初期値。画面で「違えば選び直す」前提（トーストで知らせる）。
 *   - テキスト貼り付け → LINE（個人LINEの転記が主用途。メール本文は自動取り込み側で来る）
 *   - 画像（写真・カメラ）→ 紙・口頭（手書きメモや紙FAXの撮影）
 *   - PDF・Excel → 推定しない（FAXのPDFもメール添付もありうる）
 */
export type ResolverInputKind = 'text' | 'image' | 'pdf' | 'sheet' | 'other'

export function inputKindOf(file: { mimeType: string; fileName: string } | null | undefined): ResolverInputKind {
  if (!file) return 'text'
  const m = file.mimeType.toLowerCase()
  const n = file.fileName.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (/\.(xlsx|xls|csv)$/.test(n) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return 'sheet'
  return 'other'
}

export function suggestIntakeChannel(kind: ResolverInputKind): 'line' | 'paper' | null {
  if (kind === 'text') return 'line'
  if (kind === 'image') return 'paper'
  return null
}
