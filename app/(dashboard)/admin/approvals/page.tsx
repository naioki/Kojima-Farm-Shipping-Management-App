import { redirect } from 'next/navigation'

/**
 * 旧「注文の承認」画面。受注ボックス（/admin/inbox）に統合済み（Issue#3）。
 * 既存のブックマーク・リンク互換のため承認待ちフィルタへリダイレクトする。
 */
export default function AdminApprovalsPage() {
  redirect('/admin/inbox?filter=pending')
}
