import { notFound } from 'next/navigation'
import {
  Menu, Search, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown,
  Bell, Plus, Minus, X, Delete, Calendar, LayoutGrid, ClipboardList, Camera,
  Home, History, User, FileText,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * モバイル4画面のUIモック（dev限定・DB非依存・本番404）。
 * 機能ロジックは持たず「見た目の目標」を提示するための足場。スクショ→確認→実画面へ適用。
 */
export default function MobilePreview() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="min-h-screen bg-bg-soft p-6">
      <h1 className="mb-1 font-display text-xl font-bold text-ink">モバイル画面プレビュー（モック）</h1>
      <p className="mb-6 text-sm text-ink-soft">機能はそのまま・見た目のみ。現場=緑／ポータル=紫。</p>
      <div className="flex flex-wrap gap-6">
        <MatrixMock />
        <KeypadMock />
        <ReportMock />
        <PortalMock />
      </div>
    </div>
  )
}

/* ---------- 端末フレーム ---------- */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[300px] shrink-0 overflow-hidden rounded-[28px] border-4 border-ink/80 bg-bg-card shadow-xl">
      <div className="flex items-center justify-between bg-bg-card px-4 pt-2 pb-1 text-[11px] font-medium text-ink-soft">
        <span className="num">9:31</span>
        <span className="num">●●● ◓ 100%</span>
      </div>
      <div className="flex h-[620px] flex-col">{children}</div>
    </div>
  )
}

function TopBar({ title, tone, right }: { title: string; tone: 'forest' | 'grape'; right?: React.ReactNode }) {
  const bg = tone === 'forest' ? 'bg-forest-700' : 'bg-grape-600'
  return (
    <div className={`flex items-center gap-2 ${bg} px-3 py-3 text-white`}>
      <Menu className="h-5 w-5" aria-hidden />
      <span className="flex-1 truncate font-display text-base font-bold">{title}</span>
      {right}
    </div>
  )
}

function BottomTabs({ items, active }: { items: { icon: typeof Home; label: string }[]; active: number }) {
  return (
    <div className="mt-auto grid grid-cols-5 border-t border-line bg-bg-card">
      {items.map((it, i) => {
        const Icon = it.icon
        const on = i === active
        const center = it.label === '報告'
        return (
          <div key={it.label} className="flex flex-col items-center gap-0.5 py-2">
            {center ? (
              <span className="-mt-6 flex h-11 w-11 items-center justify-center rounded-full bg-harvest-500 text-white shadow-md">
                <Plus className="h-6 w-6" aria-hidden />
              </span>
            ) : (
              <Icon className={`h-5 w-5 ${on ? 'text-forest-700' : 'text-ink-faint'}`} aria-hidden />
            )}
            <span className={`text-[10px] ${on ? 'font-medium text-forest-700' : 'text-ink-faint'}`}>{it.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 1. 出荷マトリックス ---------- */
const CELL: Record<string, string> = {
  出荷済: 'bg-harvest-100 text-harvest-700',
  梱包完了: 'bg-earth-100 text-earth-700',
  部分: 'bg-warning-bg text-warning',
  未着手: 'bg-bg-soft text-ink-faint',
}
function MatrixMock() {
  const dates = ['5/24', '5/25', '5/26', '5/27']
  const rows: { name: string; sub: string; cells: [string, string][] }[] = [
    { name: 'A商事', sub: 'トマト 4-2', cells: [['出荷済', '出荷済'], ['梱包完了', '梱包完了'], ['部分', '3/5c'], ['未着手', '未着手']] },
    { name: 'A商事', sub: 'ミニトマト 2-1', cells: [['出荷済', '出荷済'], ['出荷済', '出荷済'], ['梱包完了', '梱包完了'], ['未着手', '未着手']] },
    { name: 'B青果店', sub: 'きゅうり 5-2', cells: [['梱包完了', '梱包完了'], ['部分', '3/5c'], ['未着手', '未着手'], ['未着手', '未着手']] },
    { name: 'Cスーパー', sub: 'なす 3-1', cells: [['未着手', '未着手'], ['梱包完了', '梱包完了'], ['出荷済', '出荷済'], ['未着手', '未着手']] },
  ]
  return (
    <Phone>
      <TopBar title="出荷マトリックス" tone="forest" right={<><SlidersHorizontal className="h-5 w-5" aria-hidden /><Search className="h-5 w-5" aria-hidden /></>} />
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 text-xs text-ink-soft">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="num font-medium">2025/05/24 ～ 05/30</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </div>
        <div className="px-2">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="text-ink-faint">
                <th className="p-1" />
                {dates.map((d) => (
                  <th key={d} className="num p-1 font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name + r.sub}>
                  <td className="p-1 leading-tight">
                    <div className="font-medium text-ink">{r.name}</div>
                    <div className="num text-ink-faint">{r.sub}</div>
                  </td>
                  {r.cells.map(([state, label], i) => (
                    <td key={i} className="p-0.5">
                      <div className={`num flex h-9 items-center justify-center rounded ${CELL[state]}`}>{label}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-3 text-[10px] text-ink-soft">
          <Legend cls="bg-bg-soft" label="未着手" />
          <Legend cls="bg-earth-100" label="梱包完了" />
          <Legend cls="bg-harvest-100" label="出荷済" />
          <Legend cls="bg-warning-bg" label="部分完了" />
        </div>
        <div className="m-2 rounded-lg border border-line bg-bg-soft p-2.5">
          <div className="text-xs font-medium text-ink">A商事 / トマト / 5/26 (月)</div>
          <div className="num mt-0.5 text-sm font-bold text-warning">3 / 5 ケース（部分完了）</div>
          <div className="num mt-1 flex gap-3 text-[11px] text-ink-soft">
            <span>総数 <b className="text-ink">75</b>個</span>
            <span>ケース <b className="text-ink">3</b></span>
            <span>端数 <b className="text-ink">0</b></span>
          </div>
          <button className="mt-2 w-full rounded-lg bg-forest-700 py-2 text-xs font-bold text-white">数量を入力する</button>
          <p className="mt-1 text-center text-[10px] text-ink-faint">長押しで状態を戻す（確認あり）</p>
        </div>
      </div>
      <BottomTabs active={0} items={[{ icon: LayoutGrid, label: 'マトリックス' }, { icon: ClipboardList, label: 'タスク' }, { icon: Plus, label: '報告' }, { icon: Camera, label: 'OCR' }, { icon: Menu, label: 'メニュー' }]} />
    </Phone>
  )
}
function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  )
}

/* ---------- 2. 数量入力テンキー ---------- */
function KeypadMock() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']
  return (
    <Phone>
      <div className="flex items-center gap-2 bg-bg-card px-3 py-3 text-ink">
        <ChevronLeft className="h-5 w-5" aria-hidden />
        <span className="font-display text-base font-bold">数量入力</span>
      </div>
      <div className="flex flex-1 flex-col px-4">
        <div className="text-sm font-medium text-ink">A商事 / トマト / 5/26 (月)</div>
        <div className="num text-xs text-ink-soft">総数 75 個（5c × 15個）</div>
        <div className="mt-4 text-sm font-medium text-ink-soft">出荷数量を入力</div>
        <div className="mt-1 flex items-baseline gap-1 border-b-2 border-forest-600 pb-1">
          <span className="num text-4xl font-bold text-ink">45</span>
          <span className="ml-auto text-sm text-ink-soft">個</span>
        </div>
        <div className="mt-3 text-xs text-ink-soft">自動分解結果</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-bg-soft p-2 text-center">
            <div className="num text-lg font-bold text-ink">3</div>
            <div className="text-[10px] text-ink-faint">ケース数</div>
          </div>
          <div className="rounded-lg bg-bg-soft p-2 text-center">
            <div className="num text-lg font-bold text-ink">0</div>
            <div className="text-[10px] text-ink-faint">端数 パック</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <div key={k} className="num flex h-11 items-center justify-center rounded-lg border border-line bg-bg-card text-lg font-bold text-ink">
              {k === '⌫' ? <Delete className="h-5 w-5" aria-hidden /> : k}
            </div>
          ))}
        </div>
        <button className="mb-3 mt-3 w-full rounded-lg bg-forest-700 py-2.5 text-sm font-bold text-white">確定</button>
      </div>
    </Phone>
  )
}

/* ---------- 3. 進捗報告・タスク ---------- */
function ReportMock() {
  return (
    <Phone>
      <TopBar title="進捗報告・タスク" tone="forest" right={<Search className="h-5 w-5" aria-hidden />} />
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-2 border-b border-line text-sm">
          <div className="border-b-2 border-forest-700 py-2 text-center font-medium text-forest-700">報告フォーム</div>
          <div className="py-2 text-center text-ink-faint">タスク一覧</div>
        </div>
        <div className="space-y-2.5 p-3">
          <Field label="作業日"><span className="num flex items-center justify-between"><span>2025/05/24</span><Calendar className="h-4 w-4 text-ink-faint" aria-hidden /></span></Field>
          <Field label="作業内容"><Select value="収穫" /></Field>
          <Field label="圃場"><Select value="A-1 (トマト)" /></Field>
          <Field label="作業者"><Select value="小島 太郎" /></Field>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-soft">作業量</div>
            <div className="flex gap-2">
              <div className="num flex-1 rounded-lg border border-line bg-bg-card px-3 py-2 text-sm text-ink">120</div>
              <div className="w-24"><Select value="ケース" /></div>
            </div>
            <p className="mt-0.5 text-[10px] text-ink-faint">（複数 / 個数など）</p>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-soft">備考</div>
            <div className="rounded-lg border border-line bg-bg-card px-3 py-2 text-sm text-ink-soft">順調に収穫できました。</div>
          </div>
          <button className="w-full rounded-lg bg-forest-700 py-2.5 text-sm font-bold text-white">報告する</button>
        </div>
      </div>
      <BottomTabs active={2} items={[{ icon: LayoutGrid, label: 'マトリックス' }, { icon: ClipboardList, label: 'タスク' }, { icon: Plus, label: '報告' }, { icon: Camera, label: 'OCR' }, { icon: Menu, label: 'メニュー' }]} />
    </Phone>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-soft">{label}</div>
      <div className="rounded-lg border border-line bg-bg-card px-3 py-2 text-sm text-ink">{children}</div>
    </div>
  )
}
function Select({ value }: { value: string }) {
  return (
    <span className="flex items-center justify-between text-sm text-ink">
      {value}
      <ChevronDown className="h-4 w-4 text-ink-faint" aria-hidden />
    </span>
  )
}

/* ---------- 4. 取引先ポータル ---------- */
function PortalMock() {
  const items = [
    { name: 'トマト 4-2', qty: 5, fixed: true },
    { name: 'ミニトマト 2-1', qty: 3 },
    { name: 'きゅうり 5-2', qty: 2 },
    { name: 'なす 3-1', qty: 2 },
  ]
  return (
    <Phone>
      <TopBar title="取引先ポータル" tone="grape" right={<Bell className="h-5 w-5" aria-hidden />} />
      <div className="flex-1 overflow-hidden p-3">
        <div className="text-base font-bold text-ink">A商事 様</div>
        <p className="text-xs text-ink-soft">いつもありがとうございます！</p>
        <div className="mb-1 mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">いつものセット</span>
          <span className="text-xs font-medium text-grape-600">編集</span>
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.name} className="flex items-center justify-between rounded-lg border border-line bg-bg-card px-3 py-2">
              <span className="text-sm text-ink">{it.name}</span>
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-soft"><Minus className="h-4 w-4" aria-hidden /></span>
                <span className="num w-5 text-center text-sm font-bold text-ink">{it.qty}</span>
                <span className="text-xs text-ink-faint">{it.fixed ? '×' : ''}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-grape-600 text-white"><Plus className="h-4 w-4" aria-hidden /></span>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
          <span className="text-sm text-ink-soft">合計</span>
          <span className="num text-base font-bold text-ink">12 ケース</span>
        </div>
        <button className="mt-3 w-full rounded-lg bg-grape-600 py-2.5 text-sm font-bold text-white">この内容で発注する</button>
      </div>
      <BottomTabs active={0} items={[{ icon: Home, label: 'ホーム' }, { icon: History, label: '注文履歴' }, { icon: Bell, label: 'お知らせ' }, { icon: User, label: 'アカウント' }, { icon: FileText, label: '明細' }]} />
    </Phone>
  )
}
