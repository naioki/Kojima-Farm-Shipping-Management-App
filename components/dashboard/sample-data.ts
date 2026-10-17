import { ClipboardList, CheckCircle2, Camera, LayoutGrid, FileText, Settings } from 'lucide-react'
import type { AdminDashboardData } from './AdminDashboard'

/**
 * /ui-preview 用のサンプルデータ（モック画像の数値を再現）。DB非依存・dev限定。
 * 本番では使わない。実データ配線は app/(dashboard)/admin/page.tsx 側。
 */

const man = (n: number) => n * 10000

// 今月の出荷推移（右肩上がり・軽いノイズ）
const TREND = [
  ['5/1', 82], ['5/3', 96], ['5/6', 120], ['5/8', 138], ['5/10', 125],
  ['5/13', 168], ['5/15', 192], ['5/17', 205], ['5/20', 238], ['5/22', 262],
  ['5/24', 290], ['5/27', 330], ['5/29', 358], ['5/31', 392],
].map(([label, v]) => ({ label: label as string, value: man(v as number) }))

export const SAMPLE_DASHBOARD: AdminDashboardData = {
  header: {
    name: '小島',
    greeting: 'おはようございます',
    dateLabel: '2025年5月24日 (土)',
    notificationCount: 3,
  },
  stats: {
    notStarted: 12,
    packed: 28,
    shipped: 58,
    progressPct: 73,
    totalItems: 98,
    amounts: { notStarted: 348600, packed: 1245000, shipped: 2193400 },
  },
  trend: TREND,
  alerts: [
    { id: 'a1', tone: 'alert', label: '承認待ち受注が 8件 あります', meta: '最終更新: 5分前', count: 8, href: '/admin/approvals' },
    { id: 'a2', tone: 'warning', label: '未処理の受信データが 5件 あります', meta: '最終更新: 12分前', count: 5, href: '/admin/inbox' },
    { id: 'a3', tone: 'alert', label: '解析失敗が 2件 あります', meta: '最終更新: 1時間前', count: 2, href: '/admin/inbox?status=ai_failed' },
  ],
  actions: [
    { href: '/admin/orders', label: '受注一覧', icon: ClipboardList, tone: 'trust' },
    { href: '/admin/approvals', label: '受注承認', icon: CheckCircle2, tone: 'harvest' },
    { href: '/admin/master-import', label: 'マスタ取込 (OCR)', icon: Camera, tone: 'earth' },
    { href: '/field/matrix', label: '出荷マトリックス', icon: LayoutGrid, tone: 'forest' },
    { href: '/admin/invoices', label: '請求書作成', icon: FileText, tone: 'earth' },
    { href: '/admin/settings', label: '設定', icon: Settings, tone: 'trust' },
  ],
  recentOrders: [
    { id: 'o1', date: '5/24', customer: '㈱A商事', itemCount: 12, amount: 286000, status: 'pending_review' },
    { id: 'o2', date: '5/24', customer: 'B青果店', itemCount: 8, amount: 152400, status: 'needs_check' },
    { id: 'o3', date: '5/23', customer: 'Cスーパー', itemCount: 15, amount: 312800, status: 'approved' },
    { id: 'o4', date: '5/23', customer: 'D市場', itemCount: 10, amount: 198000, status: 'shipped' },
    { id: 'o5', date: '5/22', customer: 'Eフード', itemCount: 6, amount: 98600, status: 'shipped' },
  ],
  summary: [
    { key: 'orders', label: '受注件数', value: '152 件', deltaPct: 18, spark: [88, 102, 96, 120, 134, 128, 152] },
    { key: 'shipped', label: '出荷金額', value: '¥5,842,300', deltaPct: 12, spark: [410, 460, 520, 540, 560, 575, 584] },
    { key: 'invoiced', label: '請求金額', value: '¥5,614,700', deltaPct: 9, spark: [400, 440, 500, 520, 540, 552, 561] },
    { key: 'unpaid', label: '未請求額', value: '¥227,600', deltaPct: -5, spark: [320, 300, 280, 260, 250, 238, 227], invertDelta: true },
  ],
}
