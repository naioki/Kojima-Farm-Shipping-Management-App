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
} from 'lucide-react'

/** サイドバー（PC）とモバイルメニューで共有するナビ定義（structure.md）。 */
export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
}

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/inbox', label: '承認待ち', icon: Inbox },
  { href: '/admin/ocr', label: '手動OCR', icon: ScanLine },
  { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
  { href: '/admin/invoices', label: '請求', icon: FileText },
  { href: '/admin/delivery-notes', label: '納品書', icon: ClipboardList },
  { href: '/admin/customers', label: '取引先', icon: Users },
  { href: '/admin/products', label: '商品', icon: Carrot },
  { href: '/admin/settings', label: '設定', icon: Settings },
]

export const STAFF_NAV: NavItem[] = [
  { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
  { href: '/field/matrix', label: '圃場マトリックス', icon: Sprout },
]

export function navFor(role: 'admin' | 'staff'): NavItem[] {
  return role === 'admin' ? ADMIN_NAV : STAFF_NAV
}
