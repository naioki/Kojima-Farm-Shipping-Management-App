import {
  Inbox,
  Printer,
  LayoutDashboard,
  Sprout,
  FileText,
  Users,
  PackageCheck,
  Carrot,
  Settings,
  ClipboardList,
  Truck,
  Sparkles,
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
 * 管理（経営）サーフェスのナビ。業務フェーズでグルーピングして俯瞰しやすくする。
 *
 * 2026-10 現場最適化・スリム化アップデート:
 * 1. 日常の出荷・現場: 当日出荷・袋詰め, 便別積込・配送リスト, 週間マトリックス, 帳票・ラベル印刷
 * 2. 請求・台帳: 請求書作成・確定, 受注履歴・台帳
 * 3. 設定・マスタ管理: 取引先・納品先, 品目設定, AI学習ルール, システム設定
 */
export const ADMIN_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard }] },
  {
    label: '日常の出荷・現場',
    items: [
      { href: '/field/shipments', label: '当日出荷・袋詰め', icon: PackageCheck },
      { href: '/field/deliveries', label: '便別積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週間マトリックス', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
    ],
  },
  {
    label: '請求・台帳',
    items: [
      { href: '/admin/invoices', label: '請求書作成・確定', icon: FileText },
      { href: '/admin/orders', label: '受注履歴・台帳', icon: ClipboardList },
    ],
  },
  {
    label: '設定・マスタ管理',
    items: [
      { href: '/admin/customers', label: '取引先・納品先', icon: Users },
      { href: '/admin/products', label: '品目設定', icon: Carrot },
      { href: '/admin/rules', label: 'AI学習ルール', icon: Sparkles },
      { href: '/admin/settings', label: 'システム設定', icon: Settings },
    ],
  },
]

/** 現場（スタッフ）サーフェスは少数のタスク特化。 */
export const STAFF_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/field/shipments', label: '当日出荷・袋詰め', icon: PackageCheck },
      { href: '/field/deliveries', label: '便別積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週間マトリックス', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
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
