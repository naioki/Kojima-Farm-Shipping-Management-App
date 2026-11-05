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
  BrainCircuit,
  Home,
} from 'lucide-react'

/** サイドバー（PC）とモバイルメニューで共有するナビ定義（structure.md）。 */
export interface NavItem {
  href: string
  label: string
  icon: typeof Inbox
  /** ホバー時の補足説明（ラベルは短く、説明はここに） */
  hint?: string
}

/** 業務フェーズで束ねたナビのグループ（label=null は見出し無しの単独項目）。 */
export interface NavGroup {
  label: string | null
  /** 初回表示で開いておく（毎日使うグループ）。未指定は閉じる */
  defaultOpen?: boolean
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
      { href: '/admin/simple', label: 'かんたん画面', icon: Home, hint: '承認・明日の出荷・今月のお金の3つだけ（大きな文字）' },
      { href: '/field/concierge', label: 'AI相談窓口', icon: Sparkles },
    ],
  },
  {
    label: '毎日の出荷',
    defaultOpen: true,
    items: [
      { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck },
      { href: '/field/deliveries', label: '積込・配送リスト', icon: Truck, hint: '便ごとの積込確認と配送' },
      { href: '/field/matrix', label: '週の管理', icon: Sprout, hint: '週間マトリックス' },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
    ],
  },
  {
    label: '受注',
    defaultOpen: true,
    items: [
      { href: '/admin/orders/new', label: '注文の受付', icon: PlusCircle, hint: '電話・LINE・紙・写真から注文を入れる' },
      { href: '/admin/approvals', label: '承認待ち', icon: CheckSquare, hint: '原本と見比べて承認する' },
      { href: '/admin/inbox', label: '読み取り失敗', icon: Inbox, hint: 'FAX・メールの読み取りに失敗した原本の処理' },
      { href: '/admin/orders', label: '受注台帳', icon: ClipboardList },
    ],
  },
  {
    label: '納品書・請求',
    defaultOpen: true,
    items: [
      { href: '/admin/delivery-notes', label: '納品書の発行', icon: FileCheck2 },
      { href: '/admin/pricing', label: '請求前の単価確認', icon: Coins, hint: '出荷済みで単価が未確定の明細を確定する' },
      { href: '/admin/invoices', label: '請求書', icon: FileText, hint: '作成・確定・送付' },
    ],
  },
  {
    label: '振り返り・記録',
    items: [
      { href: '/admin/metrics', label: '評価指標', icon: Gauge, hint: '処理時間・ミス件数・紙の卒業' },
      { href: '/admin/deliveries-report', label: '配送実績', icon: BarChart3 },
      { href: '/admin/lots', label: 'ロット管理', icon: Layers, hint: 'トレーサビリティ' },
      { href: '/admin/spec-reports', label: '現場からの規格報告', icon: Ruler },
    ],
  },
  {
    label: 'マスタ・設定',
    items: [
      { href: '/admin/customers', label: '取引先・納入先', icon: Users },
      { href: '/admin/products', label: '品目', icon: Carrot },
      { href: '/admin/pricing-master', label: '単価・荷姿の設定', icon: Tag, hint: '取引先ごとの単価表と荷姿' },
      { href: '/admin/rules', label: 'AI学習ルール', icon: BrainCircuit, hint: '取引先ごとの読み取りルール' },
      { href: '/admin/master-import', label: '写真でマスタ登録', icon: Camera },
      { href: '/admin/settings', label: '設定', icon: Settings },
    ],
  },
  {
    label: null,
    items: [{ href: '/field/feedback', label: '改善要望・バグ報告', icon: MessageSquarePlus }],
  },
]

/** 現場（スタッフ）サーフェスは少数のタスク特化。 */
export const STAFF_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/field/concierge', label: 'AI相談窓口', icon: Sparkles },
      { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck },
      { href: '/field/deliveries', label: '積込・配送リスト', icon: Truck },
      { href: '/field/matrix', label: '週の管理', icon: Sprout },
      { href: '/field/print', label: '帳票・ラベル印刷', icon: Printer },
      { href: '/field/approvals', label: '承認待ち', icon: CheckSquare },
      { href: '/field/report-spec', label: '規格の報告', icon: Ruler },
    ],
  },
]

/**
 * ロールのナビ。hiddenHrefs は設定「現場スタッフに任せること」でオフの機能（使えない画面は出さない）。
 */
export function navGroupsFor(role: 'admin' | 'staff', hiddenHrefs: readonly string[] = []): NavGroup[] {
  const groups = role === 'admin' ? ADMIN_GROUPS : STAFF_GROUPS
  if (hiddenHrefs.length === 0) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !hiddenHrefs.includes(it.href)) }))
    .filter((g) => g.items.length > 0)
}

/** 後方互換・現在地判定用のフラット配列。 */
export const ADMIN_NAV: NavItem[] = ADMIN_GROUPS.flatMap((g) => g.items)
export const STAFF_NAV: NavItem[] = STAFF_GROUPS.flatMap((g) => g.items)

export function navFor(role: 'admin' | 'staff', hiddenHrefs: readonly string[] = []): NavItem[] {
  return navGroupsFor(role, hiddenHrefs).flatMap((g) => g.items)
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
