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
  PlusCircle,
  Truck,
  Sparkles,
  CheckSquare,
  FileCheck2,
  Coins,
  Tag,
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
 * 1. 日常の出荷・現場: 当日出荷・袋詰め, 便別積込・配送リスト, 週間マトリックス, 帳票・ラベル印刷
 * 2. 受注・AI承認: 新規注文入力, 受信ボックス（AI解析）, スプリット承認・確認, 受注履歴・台帳
 * 3. 納品書・請求・単価: 納品書発行, 単価確定（出荷後）, 請求書作成・確定
 * 4. 設定・マスタ管理: 取引先・納品先, 品目設定, 単価・荷姿マスタ, AI学習ルール, システム設定
 */
export const ADMIN_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard }] },
  {
    label: '日常の出荷・現場',
    items: [
      { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck },
      { href: '/field/deliveries', label: '便別積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週の管理（マトリックス）', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
    ],
  },
  {
    label: '受注・AI承認',
    items: [
      { href: '/admin/orders/new', label: '新規注文入力', icon: PlusCircle },
      { href: '/admin/inbox', label: '受信ボックス (FAX/AI)', icon: Inbox },
      { href: '/admin/approvals', label: 'AI注文の承認・確認', icon: CheckSquare },
      { href: '/admin/orders', label: '受注履歴・台帳', icon: ClipboardList },
    ],
  },
  {
    label: '納品書・請求・単価',
    items: [
      { href: '/admin/delivery-notes', label: '納品書の発行', icon: FileCheck2 },
      { href: '/admin/pricing', label: '単価確定（請求前確認）', icon: Coins },
      { href: '/admin/invoices', label: '請求書作成・確定', icon: FileText },
    ],
  },
  {
    label: '設定・マスタ管理',
    items: [
      { href: '/admin/customers', label: '取引先・納品先', icon: Users },
      { href: '/admin/products', label: '品目マスタ設定', icon: Carrot },
      { href: '/admin/pricing-master', label: '単価・荷姿マスタ', icon: Tag },
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
      { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck },
      { href: '/field/deliveries', label: '便別積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週の管理（マトリックス）', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
      { href: '/field/approvals', label: '未確認注文の承認', icon: CheckSquare },
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

/**
 * 現場画面（/field/*）間の移動時に、現在選択中の date / week と product クエリパラメータを自動引き継ぎするヘルパー。
 */
export function buildPreservedFieldHref(
  targetHref: string,
  currentDate?: string | null,
  currentProduct?: string | null,
): string {
  if (!targetHref.startsWith('/field/')) return targetHref
  const params = new URLSearchParams()
  if (currentDate && /^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    if (targetHref === '/field/matrix') {
      params.set('week', currentDate)
      params.set('date', currentDate)
    } else {
      params.set('date', currentDate)
    }
  }
  if (currentProduct) {
    params.set('product', currentProduct)
  }
  const qs = params.toString()
  return qs ? `${targetHref}?${qs}` : targetHref
}
