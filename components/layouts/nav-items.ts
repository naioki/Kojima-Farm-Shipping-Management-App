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
  Camera,
  CheckCircle2,
  Tag,
  Coins,
  Images,
  Truck,
  BarChart3,
  Tags,
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
 * 整理方針（2026-07）:
 *  - 受注: 「受信トレイ（取り込み＋手動読み取り）→ 承認 → 一覧」の一直線。
 *    旧「注文を読む」は受信トレイ内の手動アップロードに統合しメニューから除外。
 *  - 受注一覧をメニューに追加（従来はダッシュボード経由でしか行けなかった不整合を解消）。
 *  - 「規格の未登録」はToDo性が強いためメニューから外し、ダッシュボードのアラートで通知。
 *  - 価格系は役割が一目で分かる名称へ（月次の価格確定／単価・荷姿マスタ）。
 *  - 納品書は出荷実務に近いため「出荷・現場」へ移動。
 */
export const ADMIN_GROUPS: NavGroup[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard }] },
  {
    label: '受注',
    items: [
      { href: '/admin/inbox', label: '受信トレイ', icon: Inbox },
      { href: '/admin/approvals', label: '注文の承認', icon: CheckCircle2 },
      { href: '/admin/orders', label: '受注一覧', icon: ClipboardList },
    ],
  },
  {
    label: '出荷・現場',
    items: [
      { href: '/field/shipments', label: '出荷一覧', icon: PackageCheck },
      { href: '/field/deliveries', label: '配送リスト', icon: Truck },
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
