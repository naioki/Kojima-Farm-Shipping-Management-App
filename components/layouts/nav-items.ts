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
  Gauge,
  BarChart3,
  Layers,
  Ruler,
  MessageSquarePlus,
  Camera,
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
 * 管理（経営）サーフェスのナビ。毎日の仕事の順（出荷 → 受注 → 請求）に並べ、
 * 振り返り（数字・記録・現場の声）とマスタ・設定を最後に置く。
 * 同じ画面へのリンクを2か所に置かない（重複禁止）。画面を追加したら必ずどこかのグループに載せる。
 */
export const ADMIN_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
      { href: '/field/concierge', label: 'AI相談窓口', icon: Sparkles },
    ],
  },
  {
    label: '毎日の出荷',
    items: [
      { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck },
      { href: '/field/deliveries', label: '便別積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週の管理（マトリックス）', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
    ],
  },
  {
    label: '受注',
    items: [
      { href: '/admin/orders/new', label: '注文の受付（電話・LINE・紙・写真）', icon: PlusCircle },
      { href: '/admin/inbox', label: '受信ボックス（FAX・メール）', icon: Inbox },
      { href: '/admin/approvals', label: '承認待ち（原本と見比べ）', icon: CheckSquare },
      { href: '/admin/orders', label: '受注台帳', icon: ClipboardList },
    ],
  },
  {
    label: '納品書・請求',
    items: [
      { href: '/admin/delivery-notes', label: '納品書の発行', icon: FileCheck2 },
      { href: '/admin/pricing', label: '単価の確定（請求前）', icon: Coins },
      { href: '/admin/invoices', label: '請求書の作成・確定', icon: FileText },
    ],
  },
  {
    label: '振り返り・記録',
    items: [
      { href: '/admin/metrics', label: '評価指標（処理時間・ミス・紙の卒業）', icon: Gauge },
      { href: '/admin/deliveries-report', label: '配送実績', icon: BarChart3 },
      { href: '/admin/lots', label: 'ロット管理（トレーサビリティ）', icon: Layers },
      { href: '/admin/spec-reports', label: '現場からの規格報告', icon: Ruler },
      { href: '/field/feedback', label: '改善要望・バグ報告', icon: MessageSquarePlus },
    ],
  },
  {
    label: 'マスタ・設定',
    items: [
      { href: '/admin/customers', label: '取引先・納入先', icon: Users },
      { href: '/admin/products', label: '品目', icon: Carrot },
      { href: '/admin/pricing-master', label: '単価・荷姿マスタ', icon: Tag },
      { href: '/admin/rules', label: 'AI学習ルール', icon: Sparkles },
      { href: '/admin/master-import', label: '写真でマスタ登録', icon: Camera },
      { href: '/admin/settings', label: '設定', icon: Settings },
    ],
  },
]

/** 現場（スタッフ）サーフェスは少数のタスク特化。 */
export const STAFF_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/field/concierge', label: 'AI相談窓口', icon: Sparkles },
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
