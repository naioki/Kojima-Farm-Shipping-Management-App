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
  Camera,
  Tag,
  Coins,
  Images,
  Truck,
  BarChart3,
  Tags,
  Sparkles,
  Columns,
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
 * 2026-10 Webアプリ一本化アップデート（docs/web_app_migration_plan.md 準拠）:
 * - 受注: 「受注ボックス」「スプリット承認（/admin/approvals）」「受注一覧（/admin/orders）」「AI学習ルール（/admin/rules）」
 */
export const ADMIN_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard }] },
  {
    label: '受注・AI解析',
    items: [
      { href: '/admin/inbox', label: '受注ボックス', icon: Inbox },
      { href: '/admin/approvals', label: 'スプリット承認', icon: Columns },
      { href: '/admin/orders', label: '受注一覧', icon: ClipboardList },
      { href: '/admin/rules', label: 'AI学習ルール', icon: Sparkles },
    ],
  },
  {
    label: '出荷・現場',
    items: [
      { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
      { href: '/field/deliveries', label: '配送リスト', icon: Truck },
      { href: '/field/print', label: '帳票印刷', icon: Printer },
      { href: '/admin/deliveries-report', label: '配送実績', icon: BarChart3 },
      { href: '/admin/lots', label: 'ロット（トレサ）', icon: Tags },
      { href: '/admin/delivery-notes', label: '納品書', icon: ClipboardList },
      { href: '/admin/spec-reports', label: '規格報告', icon: Camera },
    ],
  },
  {
    label: '請求',
    items: [
      { href: '/admin/pricing', label: '価格の確定（月次）', icon: Coins },
      { href: '/admin/invoices', label: '請求', icon: FileText },
    ],
  },
  {
    label: 'マスタ',
    items: [
      { href: '/admin/master-import', label: '写真でマスタ登録', icon: Images },
      { href: '/admin/customers', label: '取引先', icon: Users },
      { href: '/admin/products', label: '商品', icon: Carrot },
      { href: '/admin/pricing-master', label: '単価・荷姿マスタ', icon: Tag },
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
      { href: '/field/deliveries', label: '配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週間マトリックス', icon: Sprout },
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
