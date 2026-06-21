'use client'

import {
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Upload,
  X,
  Sparkles,
  AlertTriangle,
  Carrot,
  Tag,
  Users,
  CheckCircle2,
  RotateCcw,
  ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { normalizeName as norm, classify, type Dup } from '@/lib/master-import/dedupe'
import { downscaleImage } from '@/lib/image/downscale'

/** 既存マスタ（重複判定の基準）。サーバ（page.tsx）から渡す。 */
export interface ExistingForDedup {
  customers: string[]
  products: string[]
  standards: { product_name: string; label: string }[]
}

type Phase = 'select' | 'analyzing' | 'review' | 'committing' | 'done'

const MAX_IMAGES = 6
const MAX_DIM = 1600
const JPEG_QUALITY = 0.8
const LOW_CONFIDENCE = 0.6

interface Img {
  dataUrl: string
  base64: string
  mimeType: string
  name: string
}

interface ProductRow {
  key: string
  name: string
  name_kana: string
  base_unit: string
  tax_rate: 8 | 10
  confidence: number
  dup: Dup
  checked: boolean
}
interface StandardRow {
  key: string
  product_name: string
  label: string
  selling_unit_label: string
  base_per_selling: string
  confidence: number
  dup: Dup
  checked: boolean
}
interface CustomerRow {
  key: string
  name: string
  name_kana: string
  confidence: number
  dup: Dup
  checked: boolean
}
interface Counts {
  created: number
  skipped: number
}
interface CommitResult {
  products: Counts
  standards: Counts
  customers: Counts
  errors: string[]
}

let seq = 0
const nextKey = () => `r${seq++}`

/** 全角数字（２０）やカンマ・単位混入を吸収して数値化する。読めなければ NaN。 */
function numOf(s: string): number {
  const cleaned = s.normalize('NFKC').replace(/[,\s]/g, '').replace(/[^0-9.]/g, '')
  return cleaned === '' ? NaN : Number(cleaned)
}

/** File を共有ユーティリティで最大MAX_DIMpx・JPEG圧縮し、Img 形（name付き）にする。 */
async function compressImage(file: File): Promise<Img> {
  const img = await downscaleImage(file, { maxDim: MAX_DIM, quality: JPEG_QUALITY })
  return { dataUrl: img.dataUrl, base64: img.base64, mimeType: img.mimeType, name: file.name }
}

export function MasterImportWizard({ existing }: { existing: ExistingForDedup }) {
  const [phase, setPhase] = useState<Phase>('select')
  const [images, setImages] = useState<Img[]>([])
  const [model, setModel] = useState<string | null>(null)

  const [products, setProducts] = useState<ProductRow[]>([])
  const [standards, setStandards] = useState<StandardRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [uncategorized, setUncategorized] = useState<{ text: string; reason?: string }[]>([])
  const [committed, setCommitted] = useState<CommitResult | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const existingProducts = new Set(existing.products.map(norm))
  const existingCustomers = new Set(existing.customers.map(norm))
  const existingStandards = new Set(
    existing.standards.map((s) => `${norm(s.product_name)}|${norm(s.label)}`),
  )

  async function addFiles(files: FileList) {
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`)
      return
    }
    const picked = Array.from(files).slice(0, remaining)
    try {
      const compressed = await Promise.all(
        picked.map((f) => {
          if (!f.type.startsWith('image/')) throw new Error('画像ファイルを選択してください')
          return compressImage(f)
        }),
      )
      setImages((prev) => [...prev, ...compressed])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '画像の処理に失敗しました')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function runAnalyze() {
    if (images.length === 0) return
    setPhase('analyzing')
    // サーバ上限(120s)より少し短いクライアント側タイムアウト。ハングで画面が固まらないように。
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 115_000)
    try {
      const res = await fetch('/api/master-import/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          images: images.map((im) => ({ base64: im.base64, mimeType: im.mimeType })),
        }),
        signal: ctrl.signal,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `解析失敗 (${res.status})`)

      const p = classify(
        (json.products ?? []) as ProductRow[],
        (x) => norm(x.name),
        existingProducts,
      ).map((x) => ({
        key: nextKey(),
        name: x.name ?? '',
        name_kana: x.name_kana ?? '',
        base_unit: x.base_unit || '個',
        tax_rate: (x.tax_rate === 10 ? 10 : 8) as 8 | 10,
        confidence: x.confidence ?? 0,
        dup: x.dup,
        checked: x.checked,
      }))

      const s = classify(
        (json.standards ?? []) as StandardRow[],
        (x) => `${norm(x.product_name)}|${norm(x.label)}`,
        existingStandards,
      ).map((x) => ({
        key: nextKey(),
        product_name: x.product_name ?? '',
        label: x.label ?? '',
        selling_unit_label: x.selling_unit_label ?? '',
        base_per_selling:
          x.base_per_selling != null && Number(x.base_per_selling) > 0
            ? String(x.base_per_selling)
            : '',
        confidence: x.confidence ?? 0,
        dup: x.dup,
        checked: x.checked,
      }))

      const c = classify(
        (json.customers ?? []) as CustomerRow[],
        (x) => norm(x.name),
        existingCustomers,
      ).map((x) => ({
        key: nextKey(),
        name: x.name ?? '',
        name_kana: x.name_kana ?? '',
        confidence: x.confidence ?? 0,
        dup: x.dup,
        checked: x.checked,
      }))

      setProducts(p)
      setStandards(s)
      setCustomers(c)
      setUncategorized(json.uncategorized ?? [])
      setModel(json.model ?? null)
      setPhase('review')
      const total = p.length + s.length + c.length
      toast.success(`${total}件の候補を読み取りました`)
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === 'AbortError'
          ? '解析がタイムアウトしました。枚数を減らすか、もう一度お試しください'
          : e instanceof Error
            ? e.message
            : '解析に失敗しました'
      toast.error(msg)
      setPhase('select')
    } finally {
      clearTimeout(timer)
    }
  }

  async function runCommit() {
    const pSel = products.filter((x) => x.checked)
    const sSel = standards.filter((x) => x.checked)
    const cSel = customers.filter((x) => x.checked)
    if (pSel.length + sSel.length + cSel.length === 0) {
      toast.error('登録する項目にチェックを入れてください')
      return
    }
    // 規格は selling_unit_label と base_per_selling(>0) が必須。
    const badStandards = sSel.filter(
      (x) => !x.selling_unit_label.trim() || !(numOf(x.base_per_selling) > 0) || !x.label.trim(),
    )
    if (badStandards.length > 0) {
      toast.error(
        `規格「${badStandards[0]!.label || '(名称未入力)'}」の販売単位・換算数(基準単位/販売単位1)を入力してください`,
      )
      return
    }

    setPhase('committing')
    try {
      const res = await fetch('/api/master-import/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          products: pSel.map((x) => ({
            name: x.name.trim(),
            name_kana: x.name_kana.trim() || null,
            base_unit: x.base_unit.trim() || '個',
            tax_rate: x.tax_rate,
          })),
          standards: sSel.map((x) => ({
            product_name: x.product_name.trim(),
            label: x.label.trim(),
            selling_unit_label: x.selling_unit_label.trim(),
            base_per_selling: numOf(x.base_per_selling),
          })),
          customers: cSel.map((x) => ({
            name: x.name.trim(),
            name_kana: x.name_kana.trim() || null,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      setCommitted(json as CommitResult)
      setPhase('done')
      toast.success('登録が完了しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
      setPhase('review')
    }
  }

  function reset() {
    setImages([])
    setProducts([])
    setStandards([])
    setCustomers([])
    setUncategorized([])
    setCommitted(null)
    setModel(null)
    setPhase('select')
  }

  // ----- 画面 -----
  if (phase === 'done' && committed) {
    return <DoneScreen result={committed} onReset={reset} />
  }

  return (
    <div className="space-y-5">
      {(phase === 'select' || phase === 'analyzing') && (
        <SelectScreen
          images={images}
          fileRef={fileRef}
          onPick={addFiles}
          onRemove={removeImage}
          onAnalyze={runAnalyze}
          analyzing={phase === 'analyzing'}
        />
      )}

      {(phase === 'review' || phase === 'committing') && (
        <ReviewScreen
          model={model}
          products={products}
          standards={standards}
          customers={customers}
          uncategorized={uncategorized}
          setProducts={setProducts}
          setStandards={setStandards}
          setCustomers={setCustomers}
          onCommit={runCommit}
          onBack={reset}
          committing={phase === 'committing'}
        />
      )}
    </div>
  )
}

// ============================================================
// select
// ============================================================
function SelectScreen({
  images,
  fileRef,
  onPick,
  onRemove,
  onAnalyze,
  analyzing,
}: {
  images: Img[]
  fileRef: RefObject<HTMLInputElement>
  onPick: (f: FileList) => void
  onRemove: (i: number) => void
  onAnalyze: () => void
  analyzing: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((im, i) => (
          <div key={i} className="relative aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={im.dataUrl}
              alt={im.name}
              className="h-full w-full rounded-lg border border-line object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="画像を削除"
              className="absolute -right-2 -top-2 rounded-full bg-alert p-1 text-white shadow-md hover:opacity-90"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line text-ink-soft transition-colors hover:border-earth-400 hover:bg-bg-soft"
          >
            <Upload className="h-6 w-6" aria-hidden />
            <span className="text-xs font-medium">写真を追加</span>
          </button>
        )}
      </div>
      <p className="text-xs text-ink-faint">
        取引先一覧・品目台帳・規格表などを撮影（最大{MAX_IMAGES}枚）。送信前に自動で圧縮します。
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files)
        }}
      />
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="lg"
          onClick={onAnalyze}
          disabled={images.length === 0 || analyzing}
          isLoading={analyzing}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          AIで読み取る（{images.length}枚）
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// review
// ============================================================
const fieldCls =
  'w-full rounded border border-line-strong bg-bg-card px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

function lowRing(conf: number): string {
  return conf < LOW_CONFIDENCE ? 'border-warning ring-2 ring-warning/30' : ''
}

function ConfBadge({ conf }: { conf: number }) {
  const low = conf < LOW_CONFIDENCE
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs tabular-nums',
        low ? 'bg-warning-bg text-warning' : 'text-ink-faint',
      )}
    >
      {low && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {low ? '⚠ 要確認 ' : ''}
      {Math.round(conf * 100)}%
    </span>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  rows,
  onAll,
}: {
  icon: typeof Carrot
  title: string
  rows: { dup: Dup; checked: boolean }[]
  onAll?: (checked: boolean) => void
}) {
  const newCount = rows.filter((r) => r.dup === 'new').length
  const dupCount = rows.length - newCount
  const selected = rows.filter((r) => r.checked).length
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Icon className="h-4 w-4 text-earth-600" aria-hidden />
      <h2 className="font-display text-base font-bold text-ink">{title}</h2>
      <span className="text-xs text-ink-soft">
        新規 {newCount} / 重複 {dupCount}・選択 {selected}
      </span>
      {onAll && rows.length > 0 && (
        <span className="ml-auto flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => onAll(true)}
            className="rounded px-2 py-0.5 text-trust-600 hover:bg-trust-50 hover:underline"
          >
            すべて選択
          </button>
          <span className="text-line-strong" aria-hidden>
            |
          </span>
          <button
            type="button"
            onClick={() => onAll(false)}
            className="rounded px-2 py-0.5 text-ink-soft hover:bg-bg-soft hover:underline"
          >
            すべて解除
          </button>
        </span>
      )}
    </div>
  )
}

/** 重複行は <details>（閉）でラップ。新規行はそのまま展開表示。 */
function RowShell({
  dup,
  checked,
  onToggle,
  summary,
  children,
}: {
  dup: Dup
  checked: boolean
  onToggle: (v: boolean) => void
  summary: ReactNode
  children: ReactNode
}) {
  const head = (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        aria-label="この項目を登録対象にする"
        className="h-4 w-4 shrink-0 accent-earth-600"
      />
      <div className="min-w-0 flex-1">{summary}</div>
    </div>
  )

  if (dup === 'duplicate') {
    return (
      <details className="group rounded-lg border border-line bg-bg-soft px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
          {head}
          <span className="ml-auto shrink-0 rounded-full bg-bg-card px-2 py-0.5 text-xs text-ink-soft">
            重複の可能性
          </span>
        </summary>
        <div className="mt-3 border-t border-line pt-3">{children}</div>
      </details>
    )
  }
  return (
    <div className="rounded-lg border border-line bg-bg-card px-3 py-3 shadow-sm">
      {head}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function ReviewScreen({
  model,
  products,
  standards,
  customers,
  uncategorized,
  setProducts,
  setStandards,
  setCustomers,
  onCommit,
  onBack,
  committing,
}: {
  model: string | null
  products: ProductRow[]
  standards: StandardRow[]
  customers: CustomerRow[]
  uncategorized: { text: string; reason?: string }[]
  setProducts: Dispatch<SetStateAction<ProductRow[]>>
  setStandards: Dispatch<SetStateAction<StandardRow[]>>
  setCustomers: Dispatch<SetStateAction<CustomerRow[]>>
  onCommit: () => void
  onBack: () => void
  committing: boolean
}) {
  const totalChecked =
    products.filter((x) => x.checked).length +
    standards.filter((x) => x.checked).length +
    customers.filter((x) => x.checked).length

  const upd =
    <T extends { key: string }>(setter: Dispatch<SetStateAction<T[]>>) =>
    (key: string, patch: Partial<T>) =>
      setter((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const updP = upd(setProducts)
  const updS = upd(setStandards)
  const updC = upd(setCustomers)

  const setAll =
    <T extends { checked: boolean }>(setter: Dispatch<SetStateAction<T[]>>) =>
    (checked: boolean) =>
      setter((prev) => prev.map((r) => ({ ...r, checked })))

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-faint">
        新規はチェックON・展開、重複の可能性があるものはチェックOFF・折りたたみ済みです。
        <span className="text-warning"> ⚠要確認（確信度{Math.round(LOW_CONFIDENCE * 100)}%未満）</span>
        は内容をご確認ください。すべて編集できます。
        {model && <span className="ml-1 text-ink-faint">（解析モデル: {model}）</span>}
      </p>

      {/* 品目 */}
      <section className="space-y-2">
        <SectionHeader icon={Carrot} title="品目" rows={products} onAll={setAll(setProducts)} />
        {products.length === 0 ? (
          <Empty />
        ) : (
          products.map((r) => (
            <RowShell
              key={r.key}
              dup={r.dup}
              checked={r.checked}
              onToggle={(v) => updP(r.key, { checked: v })}
              summary={
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{r.name || '(名称未入力)'}</span>
                  <ConfBadge conf={r.confidence} />
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="品目名">
                  <input
                    value={r.name}
                    onChange={(e) => updP(r.key, { name: e.target.value })}
                    className={cn(fieldCls, lowRing(r.confidence))}
                  />
                </Field>
                <Field label="読み仮名">
                  <input
                    value={r.name_kana}
                    onChange={(e) => updP(r.key, { name_kana: e.target.value })}
                    className={fieldCls}
                  />
                </Field>
                <Field label="基準単位">
                  <input
                    value={r.base_unit}
                    onChange={(e) => updP(r.key, { base_unit: e.target.value })}
                    placeholder="個・本・束・kg"
                    className={fieldCls}
                  />
                </Field>
                <Field label="税率">
                  <select
                    value={r.tax_rate}
                    onChange={(e) => updP(r.key, { tax_rate: Number(e.target.value) as 8 | 10 })}
                    className={fieldCls}
                  >
                    <option value={8}>8%（農産物）</option>
                    <option value={10}>10%（資材等）</option>
                  </select>
                </Field>
              </div>
            </RowShell>
          ))
        )}
      </section>

      {/* 規格・荷姿 */}
      <section className="space-y-2">
        <SectionHeader icon={Tag} title="規格・荷姿" rows={standards} onAll={setAll(setStandards)} />
        {standards.length === 0 ? (
          <Empty />
        ) : (
          standards.map((r) => {
            const needsFill =
              r.checked && (!r.selling_unit_label.trim() || !(numOf(r.base_per_selling) > 0))
            return (
              <RowShell
                key={r.key}
                dup={r.dup}
                checked={r.checked}
                onToggle={(v) => updS(r.key, { checked: v })}
                summary={
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">
                      {r.label || '(名称未入力)'}
                    </span>
                    <span className="shrink-0 text-xs text-ink-soft">{r.product_name || '—'}</span>
                    <ConfBadge conf={r.confidence} />
                  </div>
                }
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="品目名（紐付け先）">
                    <input
                      value={r.product_name}
                      onChange={(e) => updS(r.key, { product_name: e.target.value })}
                      className={cn(fieldCls, lowRing(r.confidence))}
                    />
                  </Field>
                  <Field label="規格・荷姿名">
                    <input
                      value={r.label}
                      onChange={(e) => updS(r.key, { label: e.target.value })}
                      placeholder="Lサイズ 4kg箱 など"
                      className={cn(fieldCls, lowRing(r.confidence))}
                    />
                  </Field>
                  <Field label="販売単位">
                    <input
                      value={r.selling_unit_label}
                      onChange={(e) => updS(r.key, { selling_unit_label: e.target.value })}
                      placeholder="箱・ケース・袋"
                      className={cn(fieldCls, needsFill && 'border-warning ring-2 ring-warning/30')}
                    />
                  </Field>
                  <Field label="換算数（基準単位 / 販売単位1）">
                    <input
                      value={r.base_per_selling}
                      onChange={(e) => updS(r.key, { base_per_selling: e.target.value })}
                      inputMode="decimal"
                      placeholder="例: 1箱=20個 → 20"
                      className={cn(
                        fieldCls,
                        'tabular-nums',
                        needsFill && 'border-warning ring-2 ring-warning/30',
                      )}
                    />
                  </Field>
                </div>
                {needsFill && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    登録には販売単位と換算数が必要です。
                  </p>
                )}
              </RowShell>
            )
          })
        )}
      </section>

      {/* 取引先 */}
      <section className="space-y-2">
        <SectionHeader icon={Users} title="店舗・取引先" rows={customers} onAll={setAll(setCustomers)} />
        {customers.length === 0 ? (
          <Empty />
        ) : (
          customers.map((r) => (
            <RowShell
              key={r.key}
              dup={r.dup}
              checked={r.checked}
              onToggle={(v) => updC(r.key, { checked: v })}
              summary={
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{r.name || '(名称未入力)'}</span>
                  <ConfBadge conf={r.confidence} />
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="店舗・取引先名">
                  <input
                    value={r.name}
                    onChange={(e) => updC(r.key, { name: e.target.value })}
                    className={cn(fieldCls, lowRing(r.confidence))}
                  />
                </Field>
                <Field label="読み仮名">
                  <input
                    value={r.name_kana}
                    onChange={(e) => updC(r.key, { name_kana: e.target.value })}
                    className={fieldCls}
                  />
                </Field>
              </div>
            </RowShell>
          ))
        )}
      </section>

      {/* 分類外 */}
      {uncategorized.length > 0 && (
        <details className="rounded-lg border border-line bg-bg-soft px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-ink-soft">
            分類外として読み取った情報（{uncategorized.length}件）
          </summary>
          <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-ink-soft">
            {uncategorized.map((u, i) => (
              <li key={i}>
                ・{u.text}
                {u.reason ? <span className="text-ink-faint">（{u.reason}）</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 操作バー */}
      <div className="sticky bottom-0 -mx-3 flex items-center justify-between gap-2 border-t border-line bg-bg-card/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        <Button variant="tertiary" size="md" onClick={onBack} disabled={committing}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          やり直す
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onCommit}
          disabled={totalChecked === 0 || committing}
          isLoading={committing}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          選択した{totalChecked}件を登録
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  )
}

function Empty() {
  return (
    <p className="rounded-lg border border-line bg-bg-soft px-3 py-4 text-center text-xs text-ink-soft">
      読み取れた項目はありませんでした。
    </p>
  )
}

// ============================================================
// done
// ============================================================
function DoneScreen({ result, onReset }: { result: CommitResult; onReset: () => void }) {
  const rows: { label: string; c: Counts }[] = [
    { label: '品目', c: result.products },
    { label: '規格・荷姿', c: result.standards },
    { label: '店舗・取引先', c: result.customers },
  ]
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-6 w-6 text-harvest-600" aria-hidden />
        <h2 className="font-display text-lg font-bold text-ink">登録が完了しました</h2>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-xs text-ink-soft">
            <tr>
              <th className="px-4 py-2 text-left font-medium">区分</th>
              <th className="px-4 py-2 text-right font-medium">新規登録</th>
              <th className="px-4 py-2 text-right font-medium">スキップ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-4 py-2 font-medium text-ink">{r.label}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums text-harvest-600">
                  {r.c.created}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{r.c.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.errors.length > 0 && (
        <div className="rounded-lg border border-alert/40 bg-alert-bg px-4 py-3">
          <p className="flex items-center gap-1 text-sm font-medium text-alert">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            一部登録できませんでした（{result.errors.length}件）
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
            {result.errors.map((e, i) => (
              <li key={i}>・{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" size="md" onClick={onReset}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          続けて別の写真を取り込む
        </Button>
      </div>
    </div>
  )
}
