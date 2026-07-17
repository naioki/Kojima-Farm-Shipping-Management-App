/**
 * 取引先名・納入先名の「正規化名」を作る純関数（Issue#6-(5) 重複登録防止の核）。
 *
 * 表記ゆれ（全角/半角・空白・法人格の書き方）を吸収して比較キーを1つに揃える。
 * 例:「（株）小島農園」「株式会社 小島農園」「(株)小島農園」→ すべて "小島農園"。
 *
 * この関数は DB 側の plpgsql/SQL 関数 normalize_org_name()（migrations/0022）と
 * **完全に同じ結果**を返すこと。片方だけ直すと UNIQUE INDEX と API チェックがずれて
 * 「APIは通したがDBが弾く」事故になる。変更時は両方＋単体テストを必ず揃える。
 *
 * 手順（DB 関数と同順）:
 *   1. NFKC 正規化（全角英数記号→半角・全角空白→半角空白・半角カナ→全角）
 *   2. lower（英字の大小を無視）
 *   3. 空白（半角/全角ともNFKCで半角化済み）を全除去
 *   4. 法人格トークンを全除去
 */

/** 除去する法人格表記（NFKC・lower 後の形で一致させる。（株）はNFKCで (株) になる）。 */
const CORP_TOKENS = [
  '株式会社',
  '有限会社',
  '合同会社',
  '合資会社',
  '合名会社',
  '一般社団法人',
  '公益社団法人',
  '一般財団法人',
  '公益財団法人',
  '(株)',
  '(有)',
  '(名)',
  '(資)',
  '(同)',
]

export function normalizeOrgName(input: string | null | undefined): string {
  let s = (input ?? '').normalize('NFKC').toLowerCase()
  // 空白除去（NFKCで全角空白 U+3000 は半角に落ちるが、念のため両方対象）
  s = s.replace(/[\s　]+/g, '')
  // 法人格除去（空白除去のあと＝「株式 会社」も先に空白を消してから吸収できる）
  for (const t of CORP_TOKENS) {
    if (t) s = s.split(t).join('')
  }
  return s
}
