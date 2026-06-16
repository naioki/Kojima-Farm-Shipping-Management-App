import {
  Inbox,
  LayoutDashboard,
  Sprout,
  FileText,
  Users,
  PackageCheck,
  Carrot,
  Settings,
  ClipboardList,
  ScanLine,
  Camera,
  CheckCircle2,
  Tag,
  Coins,
} from 'lucide-react'

/** サイドバー（PC）とモバイルメニューで共有するナビ定義（structure.md）。 */
export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
}

/** 業務フェーズで束ねたナビのグループ（label=null は見出し無しの単独項目）。 */
export interface NavGroup {
  label: string | null
  items: NavItem[]
}

/**
 * 管理（経営）サーフェスのナビ。13項目をフラットに並べず、業務フェーズで
 * グルーピングして俯瞰しやすくする（Cの方針：高密度だが整理された経営画面）。
 */
export const ADMIN_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard }] },
  {
    label: '受注',
    items: [
      { href: '/admin/approvals', label: '注文の承認', icon: CheckCircle2 },
      { href: '/admin/inbox', label: '承認待ち（受信）', icon: Inbox },
      { href: '/admin/ocr', label: '手動OCR', icon: ScanLine },
    ],
  },
  {
    label: '出荷・現場',
    items: [
      { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
      { href: '/admin/spec-reports', label: '規格報告', icon: Camera },
    ],
  },
  {
    label: '請求',
    items: [
      { href: '/admin/pricing', label: '請求準備（価格確定）', icon: Coins },
      { href: '/admin/invoices', label: '請求', icon: FileText },
      { href: '/admin/delivery-notes', label: '納品書', icon: ClipboardList },
    ],
  },
  {
    label: 'マスタ',
    items: [
      { href: '/admin/customers', label: '取引先', icon: Users },
      { href: '/admin/products', label: '商品', icon: Carrot },
      { href: '/admin/pricing-master', label: '価格・荷姿', icon: Tag },
    ],
  },
  { label: null, items: [{ href: '/admin/settings', label: '設定', icon: Settings }] },
]

/** 現場（スタッフ）サーフェスは少数のタスク特化。グルーピング不要なので単一グループ。 */
export const STAFF_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
      { href: '/field/matrix', label: '圃場マトリックス', icon: Sprout },
    ],
  },
]

export function navGroupsFor(role: 'admin' | 'staff'): NavGroup[] {
  return role === 'admin' ? ADMIN_GROUPS : STAFF_GROUPS
}

/** 後方互換・現在地判定用のフラット配列。 */
export const ADMIN_NAV: NavItem[] = ADMIN_GROUPS.flatMap((g) => g.items)
export const STAFF_NAV: NavItem[] = STAFF_GROUPS.flatMap((g) => g.items)

export function navFor(role: 'admin' | 'staff'): NavItem[] {
  return role === 'admin' ? ADMIN_NAV : STAFF_NAV
}
