'use client'

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  ArrowRight,
  UserPlus,
  Check,
  Sparkles,
  Camera,
  Image as ImageIcon,
  FileText,
  Clipboard,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  BookmarkPlus,
  Split,
  Merge,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { fieldErrorMessage } from '@/lib/field/net-error'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { determineHasCard, resolveContainerType, determineUnitCount } from '@/lib/pipeline/schemas'
import { matchDestination, resolveBatchDate, createBatchModePlanner } from '@/lib/field/batch-register'
import { findBestMatchingCustomer } from '@/lib/orders/natural-parser'
import { cn } from '@/lib/cn'
import { useOutbox } from '@/hooks/useOutbox'
import { IntakeChannelPicker, type ManualIntakeChannel } from '@/components/ui/IntakeChannelPicker'
import { inputKindOf, suggestIntakeChannel } from '@/lib/orders/intake-suggest'
import { extractWarnings, showResponseWarnings } from '@/lib/client/show-warnings'

export interface CustomerProductRuleSummary {
  packsPerCase?: number | null
  spec?: string | null
  containerType?: string | null
  hasCard?: boolean | null
  hasSeal?: boolean | null
  sealText?: string | null
  bagType?: string | null
}

export interface ShipmentAddFormProps {
  deliveryDate: string
  defaultProductId?: string | null
  customers: { id: string; name: string; aliases?: string[] | null }[]
  products: { id: string; name: string; unit: string; category?: string | null }[]
  /** 取引先配下の納入先（届け先） */
  destinations: { id: string; customerId: string; label: string; defaultContainerType?: string | null }[]
  /** `${customer_id}:${product_id}` → packs_per_case（c記法プレビュー用） */
  packsByPair: Record<string, number | null>
  /** `${customer_id}:${product_id}` → 登録済みルール一式（入数・容器・規格・シール・カード・袋） */
  rulesByPair?: Record<string, CustomerProductRuleSummary>
  /**
   * 開いた時点で添付しておく原本（受信ボックスの「読み取る」から、FAX・メールの原本を引き継ぐ）。
   * 指定するとフォームを自動で開き、そのまま AI 読み取りを始める。
   */
  initialAttachment?: { base64: string; mimeType: string; fileName: string } | null
  /** 受注経路を固定する（受信ボックスから来た FAX・メールは経路が確定しているので選ばせない） */
  fixedIntakeChannel?: 'fax' | 'email' | null
  /** 写真・ファイルの AI 読み取りを使えるか（現場スタッフは設定「写真・FAX自動読取を許可」に従う） */
  allowAiRead?: boolean
  /**
   * ページにそのまま入力欄を出す（/admin/orders/new「注文の受付」用）。モーダルにせず、
   * 手入力の欄も最初から開いておく。登録が終わったら閉じずに空のフォームへ戻る。
   */
  inline?: boolean
}

/** フォームの外枠（現場=モーダル、注文の受付=ページ内カード）。 */
function FormShell({
  inline,
  open,
  onClose,
  title,
  footer,
  children,
}: {
  inline: boolean
  open: boolean
  onClose: () => void
  title: string
  footer?: ReactNode
  children: ReactNode
}) {
  if (!inline) {
    return (
      <Modal open={open} onClose={onClose} title={title} className="max-w-xl" footer={footer}>
        {children}
      </Modal>
    )
  }
  return (
    <section aria-label={title} className="rounded-2xl border border-line-strong bg-bg-card shadow-sm">
      <div className="px-4 py-4 sm:px-5">{children}</div>
      {footer && (
        <div className="sticky bottom-0 z-10 rounded-b-2xl border-t border-line bg-bg-card px-4 py-3 sm:px-5">
          {footer}
        </div>
      )}
    </section>
  )
}

type LocalCustomer = { id: string; name: string; aliases?: string[] | null }
type LocalDestination = { id: string; customerId: string; label: string; defaultContainerType?: string | null }
type LocalProduct = { id: string; name: string; unit: string; category?: string | null }

const UNGROUPED_LABEL = 'その他'
const CATEGORY_PRIORITY = ['チンゲン菜', 'キュウリ', 'トマト', 'ネギ']
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

function formatShortDateWithWeekday(dateStr?: string | null): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '日付未定'
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  const w = WEEKDAY_JA[dt.getUTCDay()] ?? ''
  return `${m}/${d}(${w})`
}

function resolveProductCategory(p: { name: string; category?: string | null }): string {
  const cat = p.category?.trim()
  if (cat) return cat
  const name = p.name
  if (/キュウリ|胡瓜/.test(name)) return 'キュウリ'
  if (/青梗菜|チンゲン|ちんげん/.test(name)) return 'チンゲン菜'
  if (/トマト/.test(name)) return 'トマト'
  if (/ネギ|長ねぎ|ねぎ/.test(name)) return 'ネギ'
  return UNGROUPED_LABEL
}

const ADD_ERRORS: Record<string, string> = {
  packs_per_case_required: 'ケース記法ですが P/C（1ケースの入数）が未設定です。取引先設定で登録してください。',
  unparseable: '数量を解釈できませんでした（例: 10 / 15c2 / x58）。',
  negative: '数量が負の値です。',
  empty_quantity: '数量を入力してください。',
  unknown_product: '商品が見つかりません。',
}

interface UncertainItem {
  field: string
  question: string
  suggestions: string[]
}

export interface ParsedCandidateEntry {
  id: string
  customer_name?: string | null
  delivery_date?: string | null
  destination_name?: string | null
  product_name?: string | null
  raw_name?: string | null
  cases?: number | null
  quantity?: string | number | null
  packs_per_case?: number | null
  spec?: string | null
  container_type?: string | null
  has_seal?: boolean | null
  seal_text?: string | null
  bag_type?: string | null
  has_card?: boolean | null
  note?: string | null
  is_handwritten_modified?: boolean | null
  explicit_cancel_in_slip?: boolean | null
  existing_quantity?: number | null
  selected: boolean
  registered?: boolean
  /** 欄外内訳（例: ライフ近畿40箱 / サンプラザ20箱）を分割可能かどうかのメタ情報 */
  breakdownParts?: Array<{ subDestination: string; cases: number; packs: number }> | null
  isSplitChild?: boolean
  parentGroupId?: string
}

/**
 * 欄外内訳メモ（例: "内訳: ライフ近畿40箱(960P) / サンプラザ20箱(480P)" や "ライフ近畿：40 / サンプラザ：20"）から
 * 分割候補を抽出するヘルパー。
 */
function extractBreakdownParts(
  destName: string | null | undefined,
  note: string | null | undefined,
  packsPerCase: number,
): Array<{ subDestination: string; cases: number; packs: number }> | null {
  if (!note) return null
  const normalized = note.normalize('NFKC')
  const baseDest = (destName ?? '').trim()
  // パターン: 「名称：数値箱? / 名称：数値箱?」
  const regex = /([^\s:：/／,、()（）「」『』内訳]+)\s*[:：]?\s*(\d+)\s*(?:箱|ケース|c)?(?:\(\d+P\))?/g
  const parts: Array<{ subDestination: string; cases: number; packs: number }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(normalized)) !== null) {
    const rawLabel = match[1]?.trim() ?? ''
    const cNum = Number(match[2])
    if (!rawLabel || !Number.isFinite(cNum) || cNum <= 0) continue
    if (/^(手書き|旧|変更|赤字|生産者|買値|単価|入数|総数|合計|\d+)$/.test(rawLabel)) continue
    const cleanLabel = rawLabel.replace(/^(?:内訳|木のみ|\(木\)のみ)\s*/, '').trim()
    if (!cleanLabel) continue
    const subDest = baseDest && !cleanLabel.includes(baseDest) ? `${baseDest}（${cleanLabel}）` : cleanLabel
    parts.push({
      subDestination: subDest,
      cases: cNum,
      packs: cNum * packsPerCase,
    })
  }
  return parts.length >= 2 ? parts : null
}

const EMPTY_DESTINATIONS: LocalDestination[] = []
const EMPTY_RULES_BY_PAIR: Record<string, CustomerProductRuleSummary> = {}

/**
 * 出荷一覧の「スマート追加・変更」フォーム（画像＋テキスト＋事前指示書の完全統合＆一覧確認ボード搭載）。
 */
export function ShipmentAddForm({
  deliveryDate,
  defaultProductId,
  customers: initialCustomers,
  products: initialProducts,
  destinations = EMPTY_DESTINATIONS,
  packsByPair,
  rulesByPair = EMPTY_RULES_BY_PAIR,
  initialAttachment = null,
  fixedIntakeChannel = null,
  allowAiRead = true,
  inline = false,
}: ShipmentAddFormProps) {
  const router = useRouter()
  const { enqueueShipment } = useOutbox()
  const [isOpen, setIsOpen] = useState(inline)
  const [step, setStep] = useState<'input' | 'confirm'>('input')

  // マスタ state
  const [customers, setCustomers] = useState<LocalCustomer[]>(initialCustomers)
  const [products, setProducts] = useState<LocalProduct[]>(initialProducts)
  const [allDestinations, setAllDestinations] = useState<LocalDestination[]>(destinations)
  const [localPacksByPair, setLocalPacksByPair] = useState<Record<string, number | null>>(packsByPair)
  const [localRulesByPair, setLocalRulesByPair] = useState<Record<string, CustomerProductRuleSummary>>(rulesByPair)

  // AI読取時にAIが明示指定したフィールドを記録し、useEffectによる誤上書きを防止するref
  const aiExplicitFieldsRef = useRef<{
    packsPerCase?: number | null
    spec?: string | null
    containerType?: string | null
    hasCard?: boolean | null
    hasSeal?: boolean | null
    sealText?: string | null
    bagType?: string | null
  }>({})

  // フォーム入力値
  const [targetDate, setTargetDate] = useState(deliveryDate)
  const [customerId, setCustomerId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [mode, setMode] = useState<'create' | 'increase' | 'decrease' | 'set'>('create')
  const [shippingTime, setShippingTime] = useState<'am' | 'pm' | ''>('')
  const [intakeChannel, setIntakeChannel] = useState<ManualIntakeChannel | null>(null)
  const intakeChannelRef = useRef<ManualIntakeChannel | null>(null)
  useEffect(() => {
    intakeChannelRef.current = intakeChannel
  }, [intakeChannel])
  /** AI読み取りの入力から受注経路を推定して初期値にする（違えば画面で選び直せる） */
  function applyIntakeSuggestion(suggested: ManualIntakeChannel | null) {
    if (!suggested || intakeChannelRef.current === suggested) return
    intakeChannelRef.current = suggested
    setIntakeChannel(suggested)
    toast(`受注経路を「${suggested === 'line' ? 'LINE' : '紙・口頭'}」にしました（違えば上で選び直してください）`, {
      icon: '📮',
    })
  }
  const [note, setNote] = useState('')
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const fileSelectorRef = useRef<HTMLInputElement | null>(null)

  // 📦 3連動数量エディタ state（入数 × 箱数 ＝ 総パック数）
  const [inputPacksPerCase, setInputPacksPerCase] = useState<number>(20)
  const [inputCases, setInputCases] = useState<string>('')
  const [inputTotalPacks, setInputTotalPacks] = useState<string>('')

  // 🏷 現場必須荷姿属性（コンテナ種別・規格・カード有無・シール有無）
  const [containerType, setContainerType] = useState<string>('青コン')
  const [spec, setSpec] = useState<string>('2〜3株 (入数20)')
  const [hasCard, setHasCard] = useState<boolean>(false)
  const [hasSeal, setHasSeal] = useState<boolean | null>(null)
  const [sealText, setSealText] = useState<string>('')
  const [bagType, setBagType] = useState<string>('')
  const [batchRegistering, setBatchRegistering] = useState<boolean>(false)

  // 自然言語・画像統合スマート入力 state
  const [naturalText, setNaturalText] = useState('')
  const [analyzingNatural, setAnalyzingNatural] = useState(false)
  const [streamStep, setStreamStep] = useState<number>(0) // 1: 読取, 2: 照合, 3: まとめ
  const abortControllerRef = useRef<AbortController | null>(null)
  // テキスト欄に「貼り付け」で入れたか（貼り付け＝LINE の転記。手打ちの指示は経路を推定しない）
  const textPastedRef = useRef(false)
  const [dragOver, setDragOver] = useState(false)
  const naturalTextAreaRef = useRef<HTMLTextAreaElement | null>(null)

  // AI解析結果・確認事項
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [confirmedBadges, setConfirmedBadges] = useState<string[]>([])
  const [uncertainItems, setUncertainItems] = useState<UncertainItem[]>([])
  const [appliedRulesCount, setAppliedRulesCount] = useState<number>(0)
  const [savingAiRule, setSavingAiRule] = useState<boolean>(false)
  const [dateScopeMode, setDateScopeMode] = useState<'all' | 'target_only'>('all')
  const [existingShipmentInfo, setExistingShipmentInfo] = useState<{
    order_id: string
    current_quantity: number
    product_name: string
    delivery_date: string
  } | null>(null)

  // ⚡ AI初回読取の記録（ユーザー修正差分を学習ループへ蓄積用）
  const aiOriginalParsedRef = useRef<{
    customer_name?: string | null
    destination_name?: string | null
    cases?: number | null
    packs_per_case?: number | null
    quantity?: string | number | null
    product_name?: string | null
  } | null>(null)

  // 画像・カメラ・添付ファイル保持（テキスト＋画像の同時解析用）
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [attachedFilePayload, setAttachedFilePayload] = useState<{
    base64: string
    mime: string
    fileName?: string
  } | null>(null)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)

  // 📄 伝票・画像から抽出された候補明細リスト（1件でも複数件でも「これでよいか？」一覧確認に対応）
  const [parsedCandidates, setParsedCandidates] = useState<ParsedCandidateEntry[]>([])
  const [activeCandidateIdx, setActiveCandidateIdx] = useState<number>(0)

  // 📍 既存取引先への新規納入先クイック追加 state
  const [showNewDestForExisting, setShowNewDestForExisting] = useState(false)
  const [newDestForExistingName, setNewDestForExistingName] = useState('')
  const [creatingDestForExisting, setCreatingDestForExisting] = useState(false)

  // 🏢 新規取引先ワンストップ一括作成 state
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newDestinationName, setNewDestinationName] = useState('')
  const [newPacksPerCase, setNewPacksPerCase] = useState<number>(20)
  const [newContainerType, setNewContainerType] = useState<string>('青コン')
  const [newAliases, setNewAliases] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 親更新追従
  useEffect(() => setCustomers(initialCustomers), [initialCustomers])
  useEffect(() => setProducts(initialProducts), [initialProducts])
  useEffect(() => setAllDestinations(destinations), [destinations])
  useEffect(() => setLocalPacksByPair(packsByPair), [packsByPair])
  useEffect(() => setLocalRulesByPair(rulesByPair), [rulesByPair])
  // AI入力欄が主役。手入力は必要なときだけ開く（AIの単品結果・未登録取引先の作成時は自動で開く）
  // 注文の受付（inline）では電話注文の手入力が主なので、最初から開いておく
  const [manualFormOpen, setManualFormOpen] = useState(inline)

  /** モーダルを開くたびに前回の取引先・数量・候補残りをクリーンに初期化して別会社への混入を100%防ぐ */
  const openCleanAddModal = () => {
    aiExplicitFieldsRef.current = {}
    aiOriginalParsedRef.current = null
    setStep('input')
    setTargetDate(deliveryDate)
    setCustomerId('')
    setDestinationId('')
    setQtyRaw('')
    setInputCases('')
    setInputTotalPacks('')
    setInputPacksPerCase(20)
    setSpec('2〜3株 (入数20)')
    setContainerType('青コン')
    setHasCard(false)
    setHasSeal(null)
    setSealText('')
    setBagType('')
    setMode('create')
    setShippingTime('')
    setNote('')
    setNaturalText('')
    textPastedRef.current = false
    setPhotoPreview(null)
    setAttachedFilePayload(null)
    setConfirmedBadges([])
    setUncertainItems([])
    setAiExplanation(null)
    setParsedCandidates([])
    setActiveCandidateIdx(0)
    setExistingShipmentInfo(null)
    setShowNewCustomer(false)
    setNewCustomerName('')
    setNewDestinationName('')
    setNewAliases('')
    setShowNewDestForExisting(false)
    setNewDestForExistingName('')
    setManualFormOpen(inline)
    if (defaultProductId) {
      const matchedP = products.find((p) => p.id === defaultProductId)
      if (matchedP) {
        setProductId(matchedP.id)
        setSelectedCategory(resolveProductCategory(matchedP))
      }
    }
    setIsOpen(true)
  }

  /** 閉じる（ページ内フォームは閉じずに空の状態へ戻す） */
  const closeForm = () => {
    if (inline) openCleanAddModal()
    else setIsOpen(false)
  }

  useEffect(() => {
    if (isOpen) {
      setTargetDate(deliveryDate)
      if (defaultProductId) {
        const matchedP = products.find((p) => p.id === defaultProductId)
        if (matchedP) {
          setProductId(matchedP.id)
          setSelectedCategory(resolveProductCategory(matchedP))
        }
      }
    }
  }, [isOpen, deliveryDate, defaultProductId, products])

  // クイック日付用（日本時間 JST 基準）
  const todayStr = useMemo(() => jstTodayStr(), [])
  const tomorrowStr = useMemo(() => shiftDateStr(todayStr, 1), [todayStr])
  const dayAfterTomorrowStr = useMemo(() => shiftDateStr(todayStr, 2), [todayStr])

  // 品目カテゴリグループ
  const categoryGroups = useMemo(() => {
    const map = new Map<string, LocalProduct[]>()
    for (const p of products) {
      const cat = resolveProductCategory(p)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }

    const sortedCategories = Array.from(map.keys()).sort((a, b) => {
      const idxA = CATEGORY_PRIORITY.indexOf(a)
      const idxB = CATEGORY_PRIORITY.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      if (a === UNGROUPED_LABEL) return 1
      if (b === UNGROUPED_LABEL) return -1
      return a.localeCompare(b, 'ja')
    })

    return sortedCategories.map((category) => ({
      category,
      products: map.get(category) ?? [],
    }))
  }, [products])

  useEffect(() => {
    if (categoryGroups.length > 0 && !selectedCategory) {
      const defaultGroup = categoryGroups[0]!
      setSelectedCategory(defaultGroup.category)
      if (defaultGroup.products.length > 0 && !productId) {
        setProductId(defaultGroup.products[0]!.id)
      }
    }
  }, [categoryGroups, selectedCategory, productId])

  const activeGroup = useMemo(() => {
    return categoryGroups.find((g) => g.category === selectedCategory) ?? categoryGroups[0]
  }, [categoryGroups, selectedCategory])

  const categoryProducts = activeGroup?.products ?? []

  const handleSelectCategory = (cat: string) => {
    setSelectedCategory(cat)
    const grp = categoryGroups.find((g) => g.category === cat)
    if (grp && grp.products.length > 0) {
      setProductId(grp.products[0]!.id)
    }
  }

  // 納入先リスト
  const customerDestinations = useMemo(
    () => allDestinations.filter((d) => d.customerId === customerId),
    [allDestinations, customerId],
  )

  useEffect(() => {
    if (!customerId) return
    const destsForCust = allDestinations.filter((d) => d.customerId === customerId)
    if (destsForCust.length === 1 && !showNewDestForExisting) setDestinationId(destsForCust[0]!.id)
    else if (!destsForCust.some((d) => d.id === destinationId)) setDestinationId('')
  }, [customerId, allDestinations, destinationId, showNewDestForExisting])

  const selectedProduct = products.find((p) => p.id === productId)
  // 表示単位はパック数（P）にそろえる（品目マスタの「袋」「パック」とPが画面で混ざらないように）
  const unit = (() => {
    const u = selectedProduct?.unit?.trim()
    return !u || u === '袋' || u === 'パック' || u === 'p' ? 'P' : u
  })()
  const packsPerCase = customerId && productId ? localPacksByPair[`${customerId}:${productId}`] ?? null : null

  // 取引先・品目・納入先変更時に連動して登録済みルール（入数・コンテナ・規格・カード・シール・袋）を自動セット
  // （AI解析が明示指定したフィールドがある場合はAI読取値を優先維持）
  useEffect(() => {
    const cName = customers.find((c) => c.id === customerId)?.name || ''
    const destObjCurrent = allDestinations.find((d) => d.id === destinationId)
    const dName = destObjCurrent?.label || ''
    const pName = products.find((p) => p.id === productId)?.name || ''
    const ruleSummary = customerId && productId ? localRulesByPair[`${customerId}:${productId}`] : undefined
    const aiExplicit = aiExplicitFieldsRef.current

    if (customerId && productId) {
      const rulePacks = ruleSummary?.packsPerCase ?? localPacksByPair[`${customerId}:${productId}`]
      const inferredPacks =
        (aiExplicit.packsPerCase && aiExplicit.packsPerCase > 0 ? aiExplicit.packsPerCase : null) ??
        (rulePacks && rulePacks > 0 ? rulePacks : null) ??
        determineUnitCount(cName, dName, undefined, pName)
      setInputPacksPerCase(inferredPacks)
      setInputCases((curCases) => {
        if (curCases && Number(curCases) > 0) {
          const tot = Math.round(Number(curCases) * inferredPacks)
          setInputTotalPacks(String(tot))
          setQtyRaw(`${curCases}c`)
        }
        return curCases
      })

      const isNsk = cName.includes('農業総合研究所') || cName.toUpperCase().includes('NSK')
      if (aiExplicit.spec) {
        const s = aiExplicit.spec
        setSpec(s.includes('入数') ? s : `${s} (入数${inferredPacks})`)
      } else if (ruleSummary?.spec && !(isNsk && dName.includes('北海道') && ruleSummary.spec.includes('200gUP'))) {
        const cleanRuleSpec = ruleSummary.spec.replace(/\s*\(入数\d+\)/g, '').trim()
        setSpec(`${cleanRuleSpec} (入数${inferredPacks})`)
      } else {
        const baseLabel = isNsk
          ? dName.includes('北海道')
            ? '200g'
            : '200gUP'
          : pName.includes('小松菜')
          ? '200g'
          : pName.includes('青梗菜') || pName.includes('チンゲン')
          ? '2〜3株'
          : '標準'
        setSpec(`${baseLabel} (入数${inferredPacks})`)
      }

      if (aiExplicit.hasSeal !== undefined && aiExplicit.hasSeal !== null) {
        setHasSeal(aiExplicit.hasSeal)
        setSealText(aiExplicit.sealText || (aiExplicit.hasSeal ? 'シールあり' : 'シールなし'))
      } else if (ruleSummary?.hasSeal !== undefined && ruleSummary?.hasSeal !== null) {
        setHasSeal(ruleSummary.hasSeal)
        setSealText(ruleSummary.sealText || (ruleSummary.hasSeal ? 'シールあり' : 'シールなし'))
      } else if (isNsk) {
        const nskSeal = !dName.includes('北海道')
        setHasSeal(nskSeal)
        setSealText(nskSeal ? 'シールあり（生産者11:小島裕美）' : 'シールなし')
      } else {
        setHasSeal(null)
        setSealText('')
      }

      if (aiExplicit.bagType) {
        setBagType(aiExplicit.bagType)
      } else if (ruleSummary?.bagType) {
        setBagType(ruleSummary.bagType)
      } else if (cName.includes('勘兵衛')) {
        setBagType('印字袋(FG)')
      } else {
        setBagType('')
      }
    }

    if (cName || dName) {
      setContainerType(
        resolveContainerType({
          explicitContainer: aiExplicit.containerType ?? null,
          ruleContainer: ruleSummary?.containerType ?? null,
          destDefaultContainer: destObjCurrent?.defaultContainerType ?? null,
          clientName: cName,
          destination: dName,
        }),
      )
      setHasCard(
        determineHasCard({
          explicitHasCard: aiExplicit.hasCard ?? null,
          ruleHasCard: ruleSummary?.hasCard ?? null,
          clientName: cName,
          destination: dName,
        }),
      )
    }
  }, [customerId, productId, destinationId, localPacksByPair, localRulesByPair, customers, allDestinations, products])

  // ⚡ Step 1 リアルタイム既存出荷チェック（選択直後に現在の登録数と上書き/増量/減量を表示）
  useEffect(() => {
    if (!isOpen || !customerId || !productId || !targetDate) {
      setExistingShipmentInfo(null)
      return
    }
    let cancelled = false
    const q = new URLSearchParams({
      customerId,
      deliveryDate: targetDate,
      productId,
      ...(destinationId ? { destinationId } : {}),
    })
    fetch(`/api/shipments?${q.toString()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return
        const ex = json?.existingShipment || null
        setExistingShipmentInfo(ex)
        if (ex) {
          setMode((m) => (m === 'create' ? 'set' : m))
        } else {
          setMode((m) => (m !== 'create' ? 'create' : m))
        }
      })
      // 既存出荷の有無は入力補助の表示だけ。取れなければ「新規」として入力を続けられる（ログには残す）
      .catch((e) => console.error('[ShipmentAddForm] 既存出荷の確認に失敗:', e))
    return () => {
      cancelled = true
    }
  }, [isOpen, customerId, productId, destinationId, targetDate])

  // 📦 3連動数量ハンドラ
  const handlePacksPerCaseChange = (newP: number) => {
    const p = Math.max(1, newP)
    setInputPacksPerCase(p)
    setSpec((prev) => {
      const cleaned = prev.replace(/\s*\(入数\d+\)/g, '').trim() || '2〜3株'
      return `${cleaned} (入数${p})`
    })
    if (inputCases && Number(inputCases) > 0) {
      const tot = Math.round(Number(inputCases) * p)
      setInputTotalPacks(String(tot))
      setQtyRaw(`${inputCases}c`)
    } else if (inputTotalPacks && Number(inputTotalPacks) > 0) {
      setInputCases(String(Math.floor(Number(inputTotalPacks) / p)))
    }
  }

  const handleCasesChange = (val: string) => {
    setInputCases(val)
    const c = parseFloat(val)
    if (!isNaN(c) && c >= 0) {
      const tot = Math.round(c * inputPacksPerCase)
      setInputTotalPacks(String(tot))
      setQtyRaw(`${val}c`)
    } else if (val === '') {
      setInputTotalPacks('')
      setQtyRaw('')
    }
  }

  const handleTotalPacksChange = (val: string) => {
    setInputTotalPacks(val)
    const tot = parseFloat(val)
    if (!isNaN(tot) && tot >= 0) {
      setQtyRaw(val)
      if (inputPacksPerCase > 0) {
        const c = Math.floor(tot / inputPacksPerCase)
        setInputCases(String(c))
      }
    } else if (val === '') {
      setInputCases('')
      setQtyRaw('')
    }
  }

  // 数量プレビュー
  const preview = useMemo(() => {
    if (qtyRaw.trim() === '') return null
    return parseQuantity(qtyRaw, { packsPerCase: inputPacksPerCase || packsPerCase })
  }, [qtyRaw, inputPacksPerCase, packsPerCase])

  const previewText = (() => {
    if (!preview) return null
    if (preview.type === 'delete') return null
    if (preview.type === 'error')
      return { kind: 'error' as const, text: ADD_ERRORS[preview.reason] ?? '解釈できません', reason: preview.reason }
    const parts = [`合計 ${preview.total.toString()} ${unit}`]
    if (preview.interpretation === 'cases' && preview.cases != null) {
      parts.push(`（${preview.cases}ケース × ${inputPacksPerCase || packsPerCase || 20} + 端数${preview.loose}）`)
    }
    return { kind: 'ok' as const, text: parts.join(' ') }
  })()

  const destinationRequired = customerDestinations.length >= 2

  // -------------------------------------------------------------
  // ⚡ 画像＋テキスト＋事前指示書（ai_rules）統合解析ハンドラ
  // -------------------------------------------------------------
  async function handleNaturalInputSubmit() {
    const q = naturalText.trim()
    // 添付画像・ファイルがある場合は、必ず /api/ocr/analyze に画像＋テキスト指示を同時送信して解析する！
    if (attachedFilePayload) {
      const cleanedHint = q
        .replace(/画像から読み込んで(ください)?|読み込んで(ください)?|写真を見て(ください)?/g, '')
        .trim()
      await runOcrAnalyzeWithPayload({
        base64: attachedFilePayload.base64,
        mime: attachedFilePayload.mime,
        fileName: attachedFilePayload.fileName,
        instructionText: cleanedHint || undefined,
      })
      return
    }

    if (!q) {
      toast.error('指示テキストを入力するか、上のボタンから注文書・写真を選択してください')
      return
    }

    setAnalyzingNatural(true)
    setStreamStep(1)
    setConfirmedBadges([])
    setUncertainItems([])
    setAiExplanation(null)
    setExistingShipmentInfo(null)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const t1 = setTimeout(() => setStreamStep(2), 400)
    const t2 = setTimeout(() => setStreamStep(3), 950)

    try {
      const res = await fetch('/api/shipments/natural-input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: q, referenceDate: targetDate }),
        signal: abortController.signal,
      })
      clearTimeout(t1)
      clearTimeout(t2)

      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '解析に失敗しました')

      const data = json.data
      const badges: string[] = []
      if (textPastedRef.current) applyIntakeSuggestion(suggestIntakeChannel('text'))
      // 文字入力の解析結果（1件）は手入力欄に反映されるので、確認できるよう開く
      setManualFormOpen(true)

      // 1. 取引先の反映
      if (data.customer_id) {
        setCustomerId(data.customer_id)
        const c = customers.find((x) => x.id === data.customer_id)
        badges.push(`取引先: ${c?.name || data.customer_name}`)
      }

      // 2. 納入先の反映
      if (data.destination_id) {
        setDestinationId(data.destination_id)
        badges.push(`納入先: ${data.destination_name}`)
      }

      // 3. 品目の反映
      if (data.product_id) {
        setProductId(data.product_id)
        const p = products.find((x) => x.id === data.product_id)
        if (p) setSelectedCategory(resolveProductCategory(p))
        badges.push(`品目: ${p?.name || data.product_name}`)
      }

      // 4. 数量・入数・箱数の完全連動反映
      const resolvedPacksPerCase =
        (data.packs_per_case && data.packs_per_case > 0 ? Number(data.packs_per_case) : null) ||
        inputPacksPerCase ||
        20
      setInputPacksPerCase(resolvedPacksPerCase)
      if (data.cases != null && data.cases > 0) {
        const c = Number(data.cases)
        const tot = Math.round(c * resolvedPacksPerCase)
        setInputCases(String(c))
        setInputTotalPacks(String(tot))
        setQtyRaw(`${c}c`)
        badges.push(`数量: ${c}ケース (${tot}P)`)
      } else if (data.quantity_number != null && data.quantity_number > 0) {
        const tot = Number(data.quantity_number)
        const c = Math.floor(tot / resolvedPacksPerCase)
        setInputTotalPacks(String(tot))
        setInputCases(String(c))
        setQtyRaw(String(tot))
        badges.push(`数量: ${tot}P (${c}箱相当)`)
      }

      // 5. 操作モード
      if (data.action) {
        setMode(data.action)
        if (data.action === 'increase') badges.push('操作: 既存出荷に加算（増量）')
        else if (data.action === 'decrease') badges.push('操作: 減量')
        else if (data.action === 'set') badges.push('操作: 数量上書き')
      }

      // 6. 日付の反映
      if (data.delivery_date) {
        setTargetDate(data.delivery_date)
        badges.push(`納品日: ${data.delivery_date}`)
      }

      setConfirmedBadges(badges)
      setAiExplanation(data.explanation || null)
      setUncertainItems(data.uncertain_items || [])
      setExistingShipmentInfo(data.existing_shipment || null)

      toast.success('AIが指示を解析し、わかる範囲をすべて入力しました！')
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        toast('解析を中断し、手動入力へ戻りました', { icon: 'ℹ️' })
      } else {
        toast.error((err as Error)?.message || '解析に失敗しました')
      }
    } finally {
      clearTimeout(t1)
      clearTimeout(t2)
      setAnalyzingNatural(false)
      setStreamStep(0)
      abortControllerRef.current = null
    }
  }

  function handleCancelNaturalAnalysis() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setAnalyzingNatural(false)
    setAnalyzingPhoto(false)
    setStreamStep(0)
  }

  // 不明点チップの選択（選んだ内容を即座に全候補＆フォームへ反映）
  function handleSelectSuggestion(item: UncertainItem, suggestion: string) {
    if (item.field === 'delivery_date') {
      let chosenDate = targetDate
      if (suggestion.includes('明日') || suggestion.includes(tomorrowStr)) chosenDate = tomorrowStr
      else if (suggestion.includes('明後日') || suggestion.includes(dayAfterTomorrowStr)) chosenDate = dayAfterTomorrowStr
      else if (suggestion.includes('今日') || suggestion.includes(todayStr)) chosenDate = todayStr
      else {
        const match = suggestion.match(/\d{4}-\d{2}-\d{2}/)
        if (match && match[0]) chosenDate = match[0]
      }
      setTargetDate(chosenDate)
      setParsedCandidates((prev) =>
        prev.map((c) => (!c.delivery_date ? { ...c, delivery_date: chosenDate } : c)),
      )
    } else if (item.field === 'customer' || item.field === 'customer_id') {
      const hit = customers.find((c) => c.name === suggestion || suggestion.includes(c.name) || c.name.includes(suggestion))
      if (hit) {
        setCustomerId(hit.id)
        setParsedCandidates((prev) => prev.map((c) => ({ ...c, customer_name: hit.name })))
      }
    } else if (item.field === 'destination' || item.field === 'destination_id') {
      const hit = customerDestinations.find((d) => d.label.includes(suggestion) || suggestion.includes(d.label))
      if (hit) setDestinationId(hit.id)
    } else if (item.field === 'product' || item.field === 'product_id') {
      const hit = products.find((p) => p.name.includes(suggestion) || suggestion.includes(p.name))
      if (hit) {
        setProductId(hit.id)
        setSelectedCategory(resolveProductCategory(hit))
      }
    }
    setUncertainItems((prev) => prev.filter((u) => u.question !== item.question))
    toast.success(`「${suggestion}」を反映しました`)
  }

  // 📷 画像圧縮・読込
  async function compressImageFile(file: File): Promise<{ dataUrl: string; base64: string; mime: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const MAX_DIM = 1400
          let { width, height } = img
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width)
              width = MAX_DIM
            } else {
              width = Math.round((width * MAX_DIM) / height)
              height = MAX_DIM
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            const dataUrl = e.target?.result as string
            resolve({ dataUrl, base64: dataUrl.split(',')[1] || '', mime: file.type || 'image/jpeg' })
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.78)
          resolve({ dataUrl: compressedDataUrl, base64: compressedDataUrl.split(',')[1] || '', mime: 'image/jpeg' })
        }
        img.onerror = () => {
          const dataUrl = e.target?.result as string
          resolve({ dataUrl, base64: dataUrl.split(',')[1] || '', mime: file.type || 'image/jpeg' })
        }
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function applyAllParsedOrders(
    orders?: Array<{
      customer_name?: string | null
      delivery_date?: string | null
      destination_name?: string | null
      note?: string | null
      items?: Array<{
        product_name?: string | null
        raw_name?: string | null
        cases?: number | null
        quantity?: string | number | null
        packs_per_case?: number | null
        spec?: string | null
        container_type?: string | null
        has_seal?: boolean | null
        seal_text?: string | null
        bag_type?: string | null
        has_card?: boolean | null
        note?: string | null
        is_handwritten_modified?: boolean | null
        explicit_cancel_in_slip?: boolean | null
      }>
    }> | null,
    clarifications?: Array<{
      targetField: string
      title: string
      reason: string
      options: Array<{ label: string; value: string }>
    }> | null,
    existingShipments?: Array<{
      order_id: string
      customer_id: string | null
      destination_id: string | null
      delivery_date: string
      total_quantity: number
    }> | null,
    rulesCount?: number,
  ) {
    if (typeof rulesCount === 'number') setAppliedRulesCount(rulesCount)

    const entries: ParsedCandidateEntry[] = []
    let seq = 0

    for (const ord of orders ?? []) {
      const items = ord.items ?? []
      const matchedCust = ord.customer_name ? findBestMatchingCustomer(ord.customer_name, customers) : undefined
      const destPool = matchedCust
        ? allDestinations.filter((d) => d.customerId === matchedCust.id)
        : allDestinations
      const matchedDest = ord.destination_name ? matchDestination(ord.destination_name, destPool) : undefined

      // 既存出荷の照合
      const existingMatch = (existingShipments ?? []).find(
        (ex) =>
          ex.delivery_date === ord.delivery_date &&
          (!matchedCust || ex.customer_id === matchedCust.id) &&
          (matchedDest ? ex.destination_id === matchedDest.id : !ex.destination_id),
      )
      const existingQty = existingMatch ? existingMatch.total_quantity : null

      if (items.length === 0) {
        entries.push({
          id: `cand-${++seq}`,
          customer_name: ord.customer_name,
          delivery_date: ord.delivery_date,
          destination_name: ord.destination_name,
          existing_quantity: existingQty,
          selected: true,
          registered: false,
        })
      } else {
        for (const it of items) {
          const ppc = it.packs_per_case || determineUnitCount(ord.customer_name, ord.destination_name, undefined, it.product_name)
          const qNum = Number(String(it.quantity ?? '0').replace(/,/g, ''))
          const isZeroCancel = Boolean(it.explicit_cancel_in_slip) && qNum === 0
          const mergedNote = [it.note, ord.note].filter(Boolean).join(' / ') || null
          const breakdown = extractBreakdownParts(ord.destination_name, mergedNote, ppc)

          // 数量0（表の「0」セル）は、既存注文がある日のみ「取消対象」として初期チェックON、既存注文がない日は「注文なし（スキップ）」として初期チェックOFF
          const shouldSelect = isZeroCancel ? Boolean(existingQty && existingQty > 0) : qNum > 0

          entries.push({
            id: `cand-${++seq}`,
            customer_name: ord.customer_name,
            delivery_date: ord.delivery_date,
            destination_name: ord.destination_name,
            product_name: it.product_name,
            raw_name: it.raw_name,
            cases: it.cases ?? (Number.isFinite(qNum) && ppc > 0 ? Math.floor(qNum / ppc) : null),
            quantity: it.quantity,
            packs_per_case: ppc,
            spec: it.spec ?? null,
            container_type: it.container_type ?? null,
            has_seal: it.has_seal ?? null,
            seal_text: it.seal_text ?? null,
            bag_type: it.bag_type ?? null,
            has_card: it.has_card ?? true,
            note: mergedNote,
            is_handwritten_modified: it.is_handwritten_modified ?? null,
            explicit_cancel_in_slip: it.explicit_cancel_in_slip ?? null,
            existing_quantity: existingQty,
            breakdownParts: breakdown,
            selected: shouldSelect,
            registered: false,
          })
        }
      }
    }

    setDateScopeMode('all')
    setParsedCandidates(entries)
    setActiveCandidateIdx(0)
    if (entries.length > 0) setManualFormOpen(false)
    setUncertainItems([])

    if (entries.length === 0) {
      applyParsedOrder(null, clarifications, false)
      return
    }
    const first = entries.find((e) => e.selected) ?? entries[0]!
    applyParsedOrder(
      {
        customer_name: first.customer_name,
        delivery_date: first.delivery_date,
        destination_name: first.destination_name,
        items: [first],
      },
      clarifications,
      entries.length >= 2,
    )
  }

  // 📅 週間表の対象日スコープ切替（全日程 vs 選択中の納品日のみ）
  function handleDateScopeToggle(nextScope: 'all' | 'target_only') {
    setDateScopeMode(nextScope)
    setParsedCandidates((prev) =>
      prev.map((c) => {
        const qNum = Number(String(c.quantity ?? '0').replace(/,/g, ''))
        const isZero = qNum === 0
        if (nextScope === 'target_only') {
          const matchesTarget = c.delivery_date === targetDate
          return {
            ...c,
            selected: matchesTarget && (!isZero || Boolean(c.existing_quantity && c.existing_quantity > 0)),
          }
        }
        return {
          ...c,
          selected: !isZero || Boolean(c.existing_quantity && c.existing_quantity > 0),
        }
      }),
    )
  }

  // 🔀 欄外内訳（例：6関西 ライフ近畿40箱 / サンプラザ20箱）を2件に分割または1件に統合
  function handleSplitCandidateBreakdown(candId: string) {
    setParsedCandidates((prev) => {
      const targetIdx = prev.findIndex((c) => c.id === candId)
      if (targetIdx === -1) return prev
      const target = prev[targetIdx]!
      if (!target.breakdownParts || target.breakdownParts.length < 2) return prev

      const children: ParsedCandidateEntry[] = target.breakdownParts.map((part, pIdx) => ({
        ...target,
        id: `${target.id}-split-${pIdx + 1}`,
        destination_name: part.subDestination,
        cases: part.cases,
        quantity: String(part.packs),
        note: `欄外内訳より分割（${part.subDestination} ${part.cases}箱）`,
        breakdownParts: null,
        isSplitChild: true,
        parentGroupId: target.id,
        selected: true,
      }))

      const next = [...prev]
      next.splice(targetIdx, 1, ...children)
      return next
    })
    toast.success('欄外内訳の2店舗（ライフ近畿 / サンプラザ等）に明細を分割しました')
  }

  function handleMergeSplitCandidates(parentGroupId: string) {
    setParsedCandidates((prev) => {
      const children = prev.filter((c) => c.parentGroupId === parentGroupId)
      if (children.length === 0) return prev
      const first = children[0]!
      const ppc = first.packs_per_case || 24
      const totalCases = children.reduce((acc, cur) => acc + (Number(cur.cases) || 0), 0)
      const totalPacks = totalCases * ppc
      const baseDest = (first.destination_name ?? '').replace(/[（(][^）)]+[）)]$/, '').trim() || '6関西'
      const breakdownParts = children.map((c) => ({
        subDestination: c.destination_name || '',
        cases: Number(c.cases) || 0,
        packs: (Number(c.cases) || 0) * ppc,
      }))
      const summaryNote = `内訳: ${children.map((c) => `${(c.destination_name ?? '').replace(/^.*（|）$/g, '')}${c.cases}箱(${Number(c.cases) * ppc}P)`).join(' / ')}`

      const merged: ParsedCandidateEntry = {
        ...first,
        id: parentGroupId,
        destination_name: baseDest,
        cases: totalCases,
        quantity: String(totalPacks),
        note: summaryNote,
        breakdownParts,
        isSplitChild: false,
        parentGroupId: undefined,
        selected: true,
      }

      const firstIdx = prev.findIndex((c) => c.parentGroupId === parentGroupId)
      const filtered = prev.filter((c) => c.parentGroupId !== parentGroupId)
      filtered.splice(firstIdx, 0, merged)
      return filtered
    })
    toast.success('1件の明細（現場メモに内訳記載）へまとめました')
  }

  // 明細行の箱数をインラインで変更
  function handleCandidateCasesChange(candId: string, nextCases: number) {
    const safeCases = Math.max(0, nextCases)
    setParsedCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== candId) return c
        const ppc = c.packs_per_case || 20
        const tot = safeCases * ppc
        return {
          ...c,
          cases: safeCases,
          quantity: String(tot),
          selected: safeCases > 0 || Boolean(c.existing_quantity && c.existing_quantity > 0),
        }
      }),
    )
  }

  // 💡 事前指示書（AIルール）へワンタップで記憶
  async function handleSaveRuleToMaster(customRuleText?: string) {
    const targetCustName =
      customers.find((c) => c.id === customerId)?.name ||
      parsedCandidates[0]?.customer_name ||
      '共通'
    const ruleTextToSave =
      customRuleText ||
      (naturalText.trim()
        ? `[現場追加指示] ${naturalText.trim()}`
        : `${targetCustName}の注文表は入数${inputPacksPerCase}・容器「${containerType}」・規格「${spec}」として自動判定する。`)

    setSavingAiRule(true)
    try {
      const res = await fetch('/api/ai-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: targetCustName,
          rule_text: ruleTextToSave,
          is_active: true,
          priority: 5,
          category: 'parsing',
          source: 'field_learning',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'AIルールの保存に失敗しました')
      toast.success(`「${targetCustName}」の事前指示書（AIルール）に記憶しました！次回から自動適用されます`)
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '指示書の保存に失敗しました'))
    } finally {
      setSavingAiRule(false)
    }
  }

  function selectParsedCandidate(idx: number, candidatesList = parsedCandidates) {
    const target = candidatesList[idx]
    if (!target) return
    setActiveCandidateIdx(idx)
    applyParsedOrder(
      {
        customer_name: target.customer_name,
        delivery_date: target.delivery_date,
        destination_name: target.destination_name,
        items: [target],
      },
      null,
      candidatesList.length >= 2,
    )
  }

  function applyParsedOrder(
    parsedOrder?: {
      customer_name?: string | null
      delivery_date?: string | null
      destination_name?: string | null
      items?: Array<{
        product_name?: string | null
        raw_name?: string | null
        cases?: number | null
        quantity?: string | number | null
        packs_per_case?: number | null
        spec?: string | null
        container_type?: string | null
        has_seal?: boolean | null
        seal_text?: string | null
        bag_type?: string | null
        has_card?: boolean | null
        note?: string | null
      }>
    } | null,
    clarifications?: Array<{
      targetField: string
      title: string
      reason: string
      options: Array<{ label: string; value: string }>
    }> | null,
    isMultiMatrix = false,
  ) {
    if (!parsedOrder) {
      toast('注文を特定できませんでした。「手で入力する」の欄に入力してください。', { icon: 'ℹ️' })
      return
    }

    const firstItem = parsedOrder.items?.[0]
    aiOriginalParsedRef.current = {
      customer_name: parsedOrder.customer_name ?? null,
      destination_name: parsedOrder.destination_name ?? null,
      cases: firstItem?.cases ?? null,
      packs_per_case: firstItem?.packs_per_case ?? null,
      quantity: firstItem?.quantity ?? null,
      product_name: firstItem?.product_name || firstItem?.raw_name || null,
    }

    const rawTextForPacks = firstItem?.raw_name || ''
    const explicitPacks =
      firstItem?.packs_per_case ||
      (rawTextForPacks.match(/(\d+)入/)?.[1] ? parseInt(RegExp.$1, 10) : null) ||
      null

    aiExplicitFieldsRef.current = {
      packsPerCase: explicitPacks,
      spec: firstItem?.spec ?? null,
      containerType: firstItem?.container_type ?? null,
      hasCard: firstItem?.has_card ?? null,
      hasSeal: firstItem?.has_seal ?? null,
      sealText: firstItem?.seal_text ?? null,
      bagType: firstItem?.bag_type ?? null,
    }

    const badges: string[] = []
    let detectedCustName = parsedOrder.customer_name?.trim() || ''

    if (/アイプラス|小島農園/.test(detectedCustName)) {
      detectedCustName = ''
    }

    // 1. 取引先照合（未登録の場合は前回の取引先IDを絶対に引き継がずクリアし、新規取引先確認フォームを自動で開く）
    const matchedCust = detectedCustName
      ? findBestMatchingCustomer(detectedCustName, customers)
      : undefined

    if (matchedCust) {
      setCustomerId(matchedCust.id)
      setShowNewCustomer(false)
      badges.push(`取引先: ${matchedCust.name}`)
    } else if (detectedCustName) {
      setCustomerId('')
      setDestinationId('')
      setNewCustomerName(detectedCustName)
      setNewDestinationName(parsedOrder.destination_name?.trim() || '')
      const inferredNewPacks =
        (explicitPacks && explicitPacks > 0 ? explicitPacks : null) ||
        determineUnitCount(detectedCustName, parsedOrder.destination_name)
      setNewPacksPerCase(inferredNewPacks)
      setNewContainerType(
        resolveContainerType({
          explicitContainer: firstItem?.container_type,
          clientName: detectedCustName,
          destination: parsedOrder.destination_name,
          rawText: firstItem?.note,
        }),
      )
      setNewAliases(detectedCustName)
      setShowNewCustomer(true)
      setManualFormOpen(true)
      badges.push(`未登録取引先: ${detectedCustName}`)
    }

    // 2. 納品日（週間マトリクス表の場合は表内の日付をそのまま維持し、単発過去日のみ質問を出す）
    if (parsedOrder.delivery_date) {
      if (!isMultiMatrix && parsedOrder.delivery_date < todayStr) {
        setUncertainItems((prev) => [
          ...prev,
          {
            field: 'delivery_date',
            question: `伝票上の日付（${parsedOrder.delivery_date}）は過去です。いつの納品にしますか？`,
            suggestions: [`直近の次回納品 (${tomorrowStr})`, `今日 (${todayStr})`, `明後日 (${dayAfterTomorrowStr})`],
          },
        ])
        setTargetDate(tomorrowStr)
      } else {
        setTargetDate(parsedOrder.delivery_date)
        badges.push(`納品日: ${parsedOrder.delivery_date}`)
      }
    } else if (!isMultiMatrix) {
      setUncertainItems((prev) => [
        ...prev,
        {
          field: 'delivery_date',
          question: '納品日が記載されていませんでした。いつの出荷にしますか？',
          suggestions: [`明日 (${tomorrowStr})`, `今日 (${todayStr})`],
        },
      ])
    }

    // 3. 納入先
    if (parsedOrder.destination_name) {
      const dName = parsedOrder.destination_name.trim()
      const destPool = matchedCust
        ? allDestinations.filter((d) => d.customerId === matchedCust.id)
        : []
      const matchedDest = matchedCust ? matchDestination(dName, destPool) : undefined
      if (matchedDest) {
        setDestinationId(matchedDest.id)
        setShowNewDestForExisting(false)
        badges.push(`納入先: ${matchedDest.label}`)
      } else if (matchedCust) {
        setDestinationId('')
        setNewDestForExistingName(dName)
        if (!isMultiMatrix) setShowNewDestForExisting(true)
        badges.push(`納入先: ${dName} (一括登録時に自動追加)`)
      } else {
        setDestinationId('')
        setNewDestinationName(dName)
        badges.push(`納入先: ${dName}`)
      }
    } else {
      setDestinationId('')
      setShowNewDestForExisting(false)
    }

    // 4. 品目・数量・入数・規格・シール・メモ
    if (firstItem) {
      const pName = firstItem.product_name || firstItem.raw_name || ''
      const matchedProd = products.find(
        (p) =>
          p.name.includes(pName) ||
          pName.includes(p.name) ||
          (pName.includes('チンゲン') && p.name.includes('青梗菜')),
      )
      if (matchedProd) {
        setProductId(matchedProd.id)
        setSelectedCategory(resolveProductCategory(matchedProd))
        badges.push(`品目: ${matchedProd.name}`)
      }

      const ruleForPair =
        matchedCust && (matchedProd?.id || productId)
          ? localRulesByPair[`${matchedCust.id}:${matchedProd?.id || productId}`]
          : undefined
      const currentPacks =
        explicitPacks ||
        ruleForPair?.packsPerCase ||
        determineUnitCount(matchedCust?.name || detectedCustName, parsedOrder.destination_name, undefined, matchedProd?.name) ||
        inputPacksPerCase ||
        20
      setInputPacksPerCase(currentPacks)

      if (firstItem.spec) {
        const s = firstItem.spec
        setSpec(s.includes('入数') ? s : `${s} (入数${currentPacks})`)
        badges.push(`規格: ${firstItem.spec}`)
      }
      setContainerType(
        resolveContainerType({
          explicitContainer: firstItem.container_type,
          ruleContainer: ruleForPair?.containerType ?? null,
          clientName: matchedCust?.name || detectedCustName,
          destination: parsedOrder.destination_name,
          rawText: firstItem.note,
        }),
      )
      setHasCard(
        determineHasCard({
          explicitHasCard: firstItem.has_card,
          ruleHasCard: ruleForPair?.hasCard ?? null,
          clientName: matchedCust?.name || detectedCustName,
          destination: parsedOrder.destination_name,
          rawText: firstItem.note,
        }),
      )
      if (firstItem.has_seal !== undefined && firstItem.has_seal !== null) {
        setHasSeal(firstItem.has_seal)
        setSealText(firstItem.seal_text || (firstItem.has_seal ? 'シールあり' : 'シールなし'))
        badges.push(firstItem.has_seal ? `🏷️ ${firstItem.seal_text || 'シールあり'}` : 'シールなし')
      }
      if (firstItem.bag_type) {
        setBagType(firstItem.bag_type)
      }
      if (firstItem.note) {
        setNote(firstItem.note)
      }

      if (firstItem.cases != null && firstItem.cases > 0) {
        const c = firstItem.cases
        const tot = c * currentPacks
        setInputCases(String(c))
        setInputTotalPacks(String(tot))
        setQtyRaw(`${c}c`)
        badges.push(`数量: ${c}箱 (${currentPacks}P/箱 ＝ 計${tot}P)`)
      } else if (firstItem.quantity) {
        const qNum = typeof firstItem.quantity === 'number' ? firstItem.quantity : parseInt(String(firstItem.quantity).replace(/,/g, ''), 10)
        if (!isNaN(qNum) && qNum >= 0) {
          setInputTotalPacks(String(qNum))
          setQtyRaw(String(qNum))
          const c = Math.floor(qNum / currentPacks)
          setInputCases(String(c))
          badges.push(`数量: ${qNum} P (${c}箱相当)`)
        }
      }
    }

    // 5. 不明点・確認カードの統合（一括登録で自動解決される未登録納入先通知は、週間マトリクス時はノイズにならないよう整理）
    if (clarifications && clarifications.length > 0) {
      const mapped: UncertainItem[] = clarifications
        .filter((c) => !(isMultiMatrix && c.targetField === 'destination_id'))
        .map((c) => ({
          field: c.targetField,
          question: c.title ? `${c.title}: ${c.reason}` : c.reason,
          suggestions: c.options.map((o) => o.label),
        }))
      setUncertainItems((prev) => [...prev, ...mapped])
    }

    setConfirmedBadges(badges)
  }

  async function runOcrAnalyzeWithPayload(params: {
    base64: string
    mime: string
    fileName?: string
    instructionText?: string
    /** 受注経路を推定するか（クリップボードから貼った画像は LINE のスクショか紙か判別できないので推定しない） */
    suggestChannel?: boolean
  }) {
    setAnalyzingPhoto(true)
    setStreamStep(1)
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const t1 = setTimeout(() => setStreamStep(2), 500)
    const t2 = setTimeout(() => setStreamStep(3), 1200)

    try {
      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: params.base64,
          mimeType: params.mime,
          fileName: params.fileName,
          text: params.instructionText,
        }),
        signal: abortController.signal,
      })
      clearTimeout(t1)
      clearTimeout(t2)

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'AI解析に失敗しました')

      applyAllParsedOrders(
        data.orders,
        data.clarifications,
        data.existingShipments,
        data.applied_rules_count,
      )
      toast.success('画像と事前指示書から注文内容をすべて読み取りました！一覧を確認してください')
      if (params.suggestChannel) {
        applyIntakeSuggestion(
          suggestIntakeChannel(inputKindOf({ mimeType: params.mime, fileName: params.fileName ?? '' })),
        )
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        toast('解析を中断しました', { icon: 'ℹ️' })
      } else {
        toast.error((err as Error)?.message || '読み取りに失敗しました')
      }
    } finally {
      clearTimeout(t1)
      clearTimeout(t2)
      setAnalyzingPhoto(false)
      setStreamStep(0)
      abortControllerRef.current = null
    }
  }

  async function handlePhotoFile(file: File, opts: { fromClipboard?: boolean } = {}) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (fileSelectorRef.current) fileSelectorRef.current.value = ''

    try {
      const { dataUrl, base64, mime } = await compressImageFile(file)
      setPhotoPreview(dataUrl)
      setAttachedFilePayload({ base64, mime, fileName: file.name })

      const cleanedHint = naturalText
        .replace(/画像から読み込んで(ください)?|読み込んで(ください)?|写真を見て(ください)?/g, '')
        .trim()
      await runOcrAnalyzeWithPayload({
        base64,
        mime,
        fileName: file.name,
        instructionText: cleanedHint || undefined,
        suggestChannel: !opts.fromClipboard,
      })
    } catch (err: unknown) {
      toast.error((err as Error)?.message || '画像の処理に失敗しました')
    }
  }

  async function handleGenericFile(file: File) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (fileSelectorRef.current) fileSelectorRef.current.value = ''
    setActionSheetOpen(false)

    if (file.type?.startsWith('image/')) {
      await handlePhotoFile(file)
      return
    }

    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      const base64 = dataUrl.split(',')[1] || ''
      const mime = file.type || 'application/octet-stream'
      setAttachedFilePayload({ base64, mime, fileName: file.name })
      setPhotoPreview(null)

      const cleanedHint = naturalText
        .replace(/画像から読み込んで(ください)?|読み込んで(ください)?/g, '')
        .trim()
      await runOcrAnalyzeWithPayload({
        base64,
        mime,
        fileName: file.name,
        instructionText: cleanedHint || undefined,
      })
    }
    reader.onerror = () => {
      toast.error('ファイルの読み込みに失敗しました')
    }
    reader.readAsDataURL(file)
  }

  // AI入力欄を主役に: 開いたら（PCのみ）入力欄にカーソルを置き、すぐ Ctrl+V で貼れるようにする。
  // スマホでは自動でキーボードが出ると邪魔なので行わない。
  const handlePhotoFileRef = useRef(handlePhotoFile)
  handlePhotoFileRef.current = handlePhotoFile
  useEffect(() => {
    if (!isOpen || step !== 'input') return
    const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches
    const focusTimer = finePointer ? window.setTimeout(() => naturalTextAreaRef.current?.focus(), 150) : undefined

    // 入力欄の外で貼り付けても受け付ける（画像→AI読み取り、文字→AI入力欄へ）
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const data = e.clipboardData
      if (!data) return
      const imageFile = allowAiRead ? Array.from(data.files).find((f) => f.type.startsWith('image/')) : undefined
      if (imageFile) {
        e.preventDefault()
        void handlePhotoFileRef.current(imageFile, { fromClipboard: true })
        return
      }
      const text = data.getData('text')
      if (text.trim()) {
        e.preventDefault()
        textPastedRef.current = true
        setNaturalText((prev) => (prev.trim() ? `${prev}\n${text}` : text))
        naturalTextAreaRef.current?.focus()
      }
    }
    document.addEventListener('paste', onPaste)
    return () => {
      if (focusTimer) window.clearTimeout(focusTimer)
      document.removeEventListener('paste', onPaste)
    }
  }, [isOpen, step, allowAiRead])

  // 受信ボックスの「読み取る」から来た場合: 原本を添付した状態でフォームを開き、そのまま AI 読み取りを始める（1回だけ）
  const initialAttachmentHandledRef = useRef(false)
  const runOcrRef = useRef(runOcrAnalyzeWithPayload)
  runOcrRef.current = runOcrAnalyzeWithPayload
  const openCleanRef = useRef<() => void>(() => {})
  openCleanRef.current = openCleanAddModal
  useEffect(() => {
    if (!initialAttachment || initialAttachmentHandledRef.current) return
    initialAttachmentHandledRef.current = true
    openCleanRef.current()
    const { base64, mimeType, fileName } = initialAttachment
    setAttachedFilePayload({ base64, mime: mimeType, fileName })
    setPhotoPreview(mimeType.startsWith('image/') ? `data:${mimeType};base64,${base64}` : null)
    void runOcrRef.current({ base64, mime: mimeType, fileName })
  }, [initialAttachment])

  // 📍 既存取引先への新規納入先クイック追加
  async function handleCreateDestinationForExisting() {
    const dName = newDestForExistingName.trim()
    if (!customerId) {
      toast.error('先に取引先を選択してください')
      return
    }
    if (!dName) {
      toast.error('納入先・運送便名を入力してください')
      return
    }
    setCreatingDestForExisting(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          code: dName,
          full_name: dName,
        }),
      })
      const json = await res.json()
      if (res.status === 409 && json.existing) {
        const ex = json.existing
        const label = ex.code || ex.full_name || dName
        setAllDestinations((prev) =>
          prev.some((d) => d.id === ex.id) ? prev : [...prev, { id: ex.id, customerId, label }],
        )
        setDestinationId(ex.id)
        setShowNewDestForExisting(false)
        setNewDestForExistingName('')
        toast.success(`登録済みの納入先「${label}」を選択しました`)
        return
      }
      if (!res.ok || !json.destination?.id) {
        throw new Error(json.error ?? '納入先の作成に失敗しました')
      }
      const created = json.destination
      const label = created.code || created.full_name || dName
      setAllDestinations((prev) => [
        ...prev.filter((d) => d.id !== created.id),
        { id: created.id, customerId, label },
      ])
      setDestinationId(created.id)
      setShowNewDestForExisting(false)
      setNewDestForExistingName('')
      toast.success(`納入先「${label}」を追加し、選択しました！`)
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '納入先の追加に失敗しました'))
    } finally {
      setCreatingDestForExisting(false)
    }
  }

  // 🏢 新規取引先ワンストップ一括作成（納入先・入数ルール・AIルールも同時登録）
  async function handleCreateOneStopCustomer() {
    const name = newCustomerName.trim()
    if (!name) {
      toast.error('取引先名を入力してください')
      return
    }
    setCreatingCustomer(true)
    try {
      const aliasList = newAliases
        .split(/[,、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/customers/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          destination_name: newDestinationName.trim() || undefined,
          packs_per_case: newPacksPerCase > 0 ? newPacksPerCase : undefined,
          container_type: newContainerType,
          aliases: aliasList.length > 0 ? aliasList : undefined,
          product_id: productId || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.id) throw new Error(json.error ?? '作成失敗')

      const createdAliases = aliasList.length > 0 ? aliasList : undefined
      setCustomers((prev) =>
        prev.some((c) => c.id === json.id)
          ? prev
          : [...prev, { id: json.id, name: json.name, aliases: createdAliases }],
      )
      aiExplicitFieldsRef.current = {}
      setCustomerId(json.id)

      if (json.destination) {
        setAllDestinations((prev) => [
          ...prev.filter((d) => d.id !== json.destination.id),
          {
            id: json.destination.id,
            customerId: json.id,
            label: json.destination.label,
            defaultContainerType: newContainerType || null,
          },
        ])
        setDestinationId(json.destination.id)
      }

      if (json.packs_per_case) {
        setInputPacksPerCase(json.packs_per_case)
        if (productId) {
          setLocalPacksByPair((prev) => ({
            ...prev,
            [`${json.id}:${productId}`]: json.packs_per_case,
          }))
          setLocalRulesByPair((prev) => ({
            ...prev,
            [`${json.id}:${productId}`]: {
              packsPerCase: json.packs_per_case,
              containerType: newContainerType || null,
            },
          }))
        }
        if (inputCases && Number(inputCases) > 0) {
          const tot = Math.round(Number(inputCases) * json.packs_per_case)
          setInputTotalPacks(String(tot))
          setQtyRaw(`${inputCases}c`)
        }
      }
      if (newContainerType) {
        setContainerType(newContainerType)
      }

      // 候補一覧の未登録取引先名も作成した取引先名へ同期する
      setParsedCandidates((prev) =>
        prev.map((cand) => {
          const cName = cand.customer_name?.trim() || ''
          if (!cName || cName === name || !findBestMatchingCustomer(cName, customers)) {
            return {
              ...cand,
              customer_name: json.name,
              packs_per_case: cand.packs_per_case || json.packs_per_case || newPacksPerCase,
              container_type: cand.container_type || newContainerType || null,
            }
          }
          return cand
        }),
      )

      setShowNewCustomer(false)
      setNewCustomerName('')
      setNewDestinationName('')
      setNewAliases('')
      toast.success(
        `「${json.name}」を一括登録しました！` +
          (json.destination ? `（納入先: ${json.destination.label}）` : '') +
          (json.packs_per_case ? `（入数: ${json.packs_per_case}P）` : ''),
      )
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '取引先の作成に失敗しました'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  // -------------------------------------------------------------
  // ステップ1: 確認画面への遷移バリデーション（最新の既存出荷差分を取得）
  // -------------------------------------------------------------
  async function proceedToConfirm() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    if (!productId) {
      toast.error('品目を選択してください')
      return
    }
    if (!qtyRaw.trim() || previewText?.kind === 'error') {
      toast.error('有効な数量を入力してください')
      return
    }
    if (destinationRequired && !destinationId) {
      toast.error('納入先を選択してください')
      return
    }

    try {
      const q = new URLSearchParams({
        customerId,
        deliveryDate: targetDate,
        productId,
        ...(destinationId ? { destinationId } : {}),
      })
      const res = await fetch(`/api/shipments?${q.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setExistingShipmentInfo(json.existingShipment || null)
        if (json.existingShipment && mode === 'create') {
          setMode('increase')
        }
      }
    } catch {
      // ネットワーク不通時は手動設定値を維持
    }

    setStep('confirm')
  }

  // -------------------------------------------------------------
  // 📄 読み取り結果まとめ一覧の一括登録（規格・シール・内訳メモ・0取消も完全反映）
  // -------------------------------------------------------------
  async function handleBatchRegisterAllCandidates() {
    const targets = parsedCandidates
      .map((c, idx) => ({ cand: c, idx }))
      .filter((x) => x.cand.selected && !x.cand.registered)
    if (targets.length === 0) {
      toast('反映対象の明細にチェックが入っていません', { icon: 'ℹ️' })
      return
    }

    setBatchRegistering(true)
    let successCount = 0
    let sharedReceiptId: string | null = null
    const updatedList = [...parsedCandidates]
    const failures: string[] = []
    const batchWarnings = new Set<string>()
    const createdDests: Array<{ id: string; label: string; customerId: string }> = []
    const registeredDates: string[] = []
    const planMode = createBatchModePlanner()

    try {
      for (const { cand, idx } of targets) {
        const rowLabel = `${cand.delivery_date ?? '日付不明'} ${cand.destination_name ?? cand.customer_name ?? ''} ${cand.product_name ?? cand.raw_name ?? ''}`.trim()
        let detectedCustName = cand.customer_name?.trim() || ''
        if (/アイプラス|小島農園/.test(detectedCustName)) detectedCustName = ''

        const matchedByName = detectedCustName
          ? findBestMatchingCustomer(detectedCustName, customers) ?? null
          : null

        // 🚨 未登録の取引先名が検出された場合、別会社の納入先に混ぜたり既存選択を引き継いだりせず、新規取引先作成フォームを開く
        if (detectedCustName && !matchedByName) {
          setCustomerId('')
          setDestinationId('')
          setNewCustomerName(detectedCustName)
          if (cand.destination_name?.trim()) setNewDestinationName(cand.destination_name.trim())
          if (cand.packs_per_case && cand.packs_per_case > 0) setNewPacksPerCase(cand.packs_per_case)
          if (cand.container_type?.trim()) setNewContainerType(cand.container_type.trim())
          setNewAliases(detectedCustName)
          setShowNewCustomer(true)
          setManualFormOpen(true)
          toast.error(
            `未登録の取引先「${detectedCustName}」があります。下の確認フォームで「取引先・納入先・ルールを一括作成」を押してから登録してください。`,
            { duration: 8000 },
          )
          setBatchRegistering(false)
          return
        }

        const matchedCust = matchedByName || customers.find((c) => c.id === customerId)
        if (!matchedCust) {
          failures.push(`${rowLabel}：取引先が未選択または未登録です`)
          continue
        }

        const dName = cand.destination_name?.trim() || ''
        const destPool = [...allDestinations, ...createdDests].filter((d) => d.customerId === matchedCust.id)
        let matchedDest: { id: string; label: string } | undefined = matchDestination(dName, destPool)

        // 未登録の納入先（5北海道、6関西、ライフ近畿等）は自動登録して進める
        if (dName && !matchedDest) {
          const dr = await fetch('/api/destinations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ customer_id: matchedCust.id, code: dName, full_name: dName, aliases: [dName] }),
          })
          const dj = await dr.json().catch(() => ({}))
          const dest = dr.status === 409 ? dj.existing : dj.destination
          if (dest?.id) {
            matchedDest = { id: dest.id, label: dest.full_name ?? dName }
            createdDests.push({ id: dest.id, label: dest.full_name ?? dName, customerId: matchedCust.id })
            setAllDestinations((prev) =>
              prev.some((d) => d.id === dest.id)
                ? prev
                : [...prev, { id: dest.id, customerId: matchedCust.id, label: dest.full_name ?? dName }],
            )
          } else {
            failures.push(`${rowLabel}：納入先「${dName}」を登録できませんでした（${dj.error ?? dr.status}）`)
            continue
          }
        }

        const pName = cand.product_name || cand.raw_name || ''
        const matchedProd =
          products.find(
            (p) =>
              p.name.includes(pName) ||
              pName.includes(p.name) ||
              (pName.includes('チンゲン') && p.name.includes('青梗菜')),
          ) || products.find((p) => p.id === productId) || products[0]
        if (!matchedProd) {
          failures.push(`${rowLabel}：品目が見つかりません`)
          continue
        }

        const ruleObj = localRulesByPair[`${matchedCust.id}:${matchedProd.id}`]
        const rulePacks = localPacksByPair[`${matchedCust.id}:${matchedProd.id}`] ?? ruleObj?.packsPerCase
        const cPacks =
          cand.packs_per_case ||
          rulePacks ||
          determineUnitCount(matchedCust.name, matchedDest?.label || dName)

        const qNum = Number(String(cand.quantity ?? '').replace(/,/g, ''))
        const isZeroCancel = (cand.explicit_cancel_in_slip || cand.cases === 0) && qNum === 0
        const qRaw = isZeroCancel
          ? '0'
          : cand.cases != null && cand.cases > 0
          ? `${cand.cases}c`
          : cand.quantity != null
          ? String(cand.quantity).replace(/,/g, '')
          : ''
        if (!qRaw) {
          failures.push(`${rowLabel}：数量が読み取れません`)
          continue
        }

        const cDate = resolveBatchDate(cand.delivery_date, targetDate)
        const rowMode = isZeroCancel
          ? 'set'
          : planMode({
              customerId: matchedCust.id,
              productId: matchedProd.id,
              destinationId: matchedDest?.id ?? null,
              date: cDate,
            })

        const destDefaultContainer = allDestinations.find((d) => d.id === matchedDest?.id)?.defaultContainerType
        const cContainer = resolveContainerType({
          explicitContainer: cand.container_type || destDefaultContainer || ruleObj?.containerType,
          clientName: matchedCust.name,
          destination: matchedDest?.label || dName,
          rawText: cand.note,
        })
        const cHasCard = determineHasCard({
          explicitHasCard: cand.has_card ?? ruleObj?.hasCard,
          clientName: matchedCust.name,
          destination: matchedDest?.label || dName,
          rawText: cand.note,
        })
        const isNsk = matchedCust.name.includes('農業総合研究所') || matchedCust.name.toUpperCase().includes('NSK')
        const defaultSpecLabel = isNsk
          ? (matchedDest?.label || dName).includes('北海道')
            ? `200g (入数${cPacks})`
            : `200gUP (入数${cPacks})`
          : `${matchedProd.name.includes('小松菜') ? '200g' : '2〜3株'} (入数${cPacks})`
        const cSpec = cand.spec || ruleObj?.spec || defaultSpecLabel

        const batchPayload = {
          customer_id: matchedCust.id,
          product_id: matchedProd.id,
          delivery_date: cDate,
          quantity_raw: qRaw,
          packs_per_case: cPacks,
          spec: cSpec,
          container_type: cContainer,
          has_card: cHasCard,
          has_seal: cand.has_seal ?? ruleObj?.hasSeal ?? undefined,
          seal_text: cand.seal_text ?? ruleObj?.sealText ?? undefined,
          bag_type: cand.bag_type ?? ruleObj?.bagType ?? undefined,
          intake_channel: fixedIntakeChannel ?? intakeChannel ?? undefined,
          note: cand.note ?? undefined,
          destination_id: matchedDest?.id || null,
          mode: rowMode,
          ...(sharedReceiptId
            ? { receipt_id: sharedReceiptId }
            : attachedFilePayload?.base64
            ? {
                original_file: {
                  base64: attachedFilePayload.base64,
                  mimeType: attachedFilePayload.mime,
                  fileName: attachedFilePayload.fileName || 'field_upload.jpg',
                },
              }
            : {}),
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await enqueueShipment(batchPayload, rowLabel)
          updatedList[idx] = { ...cand, registered: true }
          registeredDates.push(cDate)
          successCount++
          continue
        }
        try {
          const res = await fetch('/api/shipments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(batchPayload),
          })
          if (res.ok) {
            const okJson = await res.json().catch(() => ({}))
            for (const w of extractWarnings(okJson)) batchWarnings.add(w)
            if (okJson?.receiptId && !sharedReceiptId) {
              sharedReceiptId = okJson.receiptId as string
            }
            updatedList[idx] = { ...cand, registered: true }
            registeredDates.push(cDate)
            successCount++
          } else {
            const ej = await res.json().catch(() => ({}))
            failures.push(`${rowLabel}：保存失敗（${ej.error ?? res.status}）`)
          }
        } catch {
          await enqueueShipment(batchPayload, rowLabel)
          updatedList[idx] = { ...cand, registered: true }
          registeredDates.push(cDate)
          successCount++
        }
      }

      if (failures.length > 0) {
        toast.error(`登録できなかった明細 ${failures.length} 件:\n${failures.slice(0, 5).join('\n')}`, { duration: 12000 })
      }
      // 登録はできたが付随更新（収穫数など）に失敗した明細の警告。同じ文言は1回だけ出す
      showResponseWarnings({ warnings: Array.from(batchWarnings) })

      setParsedCandidates(updatedList)

      const remaining = updatedList.filter((c) => c.selected && !c.registered).length
      if (remaining === 0) {
        toast.success(`✨ 選択した ${successCount} 件の明細をすべて反映しました！`)
        closeForm()
        setStep('input')
        setParsedCandidates([])
        setActiveCandidateIdx(0)
        setPhotoPreview(null)
        setAttachedFilePayload(null)
        setNaturalText('')
        textPastedRef.current = false
        if (registeredDates.length > 0 && !registeredDates.includes(deliveryDate)) {
          const jumpDate = registeredDates[0]
          router.push(`/field/shipments?date=${jumpDate}${productId ? `&product=${productId}` : ''}`)
        } else {
          router.refresh()
        }
      } else {
        router.refresh()
        toast.success(`${successCount} 件を登録しました（残り ${remaining} 件を確認してください）`)
        const nextIdx = updatedList.findIndex((c) => c.selected && !c.registered)
        if (nextIdx !== -1) selectParsedCandidate(nextIdx, updatedList)
      }
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '一括登録中にエラーが発生しました'))
    } finally {
      setBatchRegistering(false)
    }
  }

  // -------------------------------------------------------------
  // ステップ2: 最終確定・DB保存
  // -------------------------------------------------------------
  async function submitFinal() {
    setSubmitting(true)
    const shipmentPayload = {
      customer_id: customerId,
      product_id: productId,
      delivery_date: targetDate,
      shipping_time: shippingTime || undefined,
      intake_channel: fixedIntakeChannel ?? intakeChannel ?? undefined,
      quantity_raw: qtyRaw,
      packs_per_case: inputPacksPerCase > 0 ? inputPacksPerCase : undefined,
      spec: spec.trim() || undefined,
      container_type: containerType.trim() || undefined,
      has_card: hasCard,
      has_seal: hasSeal ?? undefined,
      seal_text: sealText.trim() || undefined,
      bag_type: bagType.trim() || undefined,
      destination_id: destinationId || null,
      mode,
      note: note.trim() || undefined,
      ai_original: aiOriginalParsedRef.current || undefined,
      ...(attachedFilePayload?.base64
        ? {
            original_file: {
              base64: attachedFilePayload.base64,
              mimeType: attachedFilePayload.mime,
              fileName: attachedFilePayload.fileName || 'field_upload.jpg',
            },
          }
        : {}),
    }
    const summaryLabel = `${customers.find((c) => c.id === customerId)?.name ?? '取引先'} / ${products.find((p) => p.id === productId)?.name ?? '品目'} (${qtyRaw})`

    try {
      if (!navigator.onLine) {
        await enqueueShipment(shipmentPayload, summaryLabel)
        toast.success('電波が弱い場所のため端末に一時保存しました（繋がり次第自動で反映されます）', {
          duration: 4000,
        })
        closeForm()
        setStep('input')
        setQtyRaw('')
        return
      }
      let res: Response
      try {
        res = await fetch('/api/shipments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(shipmentPayload),
        })
      } catch {
        await enqueueShipment(shipmentPayload, summaryLabel)
        toast.success('電波が弱い場所のため端末に一時保存しました（繋がり次第自動で反映されます）', {
          duration: 4000,
        })
        closeForm()
        setStep('input')
        setQtyRaw('')
        return
      }
      const json = await res.json()
      if (!res.ok) {
        throw new Error(ADD_ERRORS[json.error ?? ''] ?? json.error ?? `追加に失敗 (${res.status})`)
      }

      toast.success(
        json.cancelled
          ? '該当の出荷をキャンセル（0に更新）しました！'
          : mode === 'increase'
          ? '既存出荷に数量を加算しました！'
          : mode === 'decrease'
          ? '出荷数量を減量しました！'
          : '出荷を登録・更新しました！',
      )
      showResponseWarnings(json)

      if (json.learnedMistake) {
        toast('💡 修正内容をAI自動学習ループに蓄積しました（次回から自動補正されます）', {
          icon: '⚡',
          duration: 4000,
        })
      }

      if (parsedCandidates.length > 1) {
        const updatedCandidates = parsedCandidates.map((c, idx) =>
          idx === activeCandidateIdx ? { ...c, registered: true } : c,
        )
        const nextUnregisteredIdx = updatedCandidates.findIndex((c) => c.selected && !c.registered)
        setParsedCandidates(updatedCandidates)
        router.refresh()

        if (nextUnregisteredIdx !== -1) {
          const remainingCount = updatedCandidates.filter((c) => c.selected && !c.registered).length
          toast.success(
            `続けて次の明細（残り ${remainingCount} 件）を入力欄にセットしました！`,
            { duration: 4000 },
          )
          setStep('input')
          selectParsedCandidate(nextUnregisteredIdx, updatedCandidates)
          return
        }
      }

      // すべて完了時のリセット
      closeForm()
      setStep('input')
      setQtyRaw('')
      setNaturalText('')
      textPastedRef.current = false
      setPhotoPreview(null)
      setAttachedFilePayload(null)
      setConfirmedBadges([])
      setUncertainItems([])
      setParsedCandidates([])
      setActiveCandidateIdx(0)
      aiOriginalParsedRef.current = null
      aiExplicitFieldsRef.current = {}
      if (targetDate && targetDate !== deliveryDate) {
        router.push(`/field/shipments?date=${targetDate}${productId ? `&product=${productId}` : ''}`)
      } else {
        router.refresh()
      }
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '登録に失敗しました'))
    } finally {
      setSubmitting(false)
    }
  }

  const custObj = customers.find((c) => c.id === customerId)
  const destObj = customerDestinations.find((d) => d.id === destinationId)
  const prodObj = products.find((p) => p.id === productId)

  const uniqueCandidateDates = useMemo(
    () => Array.from(new Set(parsedCandidates.map((c) => c.delivery_date).filter(Boolean))),
    [parsedCandidates],
  )
  const selectedCandidateCount = useMemo(
    () => parsedCandidates.filter((c) => c.selected && !c.registered).length,
    [parsedCandidates],
  )

  return (
    <>
      {/* ボード内明示ボタン ＋ 右下の新規追加丸ボタン（現場のみ。注文の受付はページに直接フォームを出す） */}
      {!inline && (
        <>
          <div className="print:hidden pt-1">
            <button
              type="button"
              onClick={openCleanAddModal}
              className="w-full min-h-12 rounded-2xl border-2 border-dashed border-forest-200 bg-forest-50/70 hover:bg-forest-100/80 px-4 py-3 text-forest-900 font-black text-sm flex items-center justify-center gap-2 transition active:scale-[0.99] shadow-2xs"
            >
              <Plus className="h-4 w-4 shrink-0 stroke-[2.8] text-forest-700" aria-hidden />
              <span>注文を追加（写真・LINEを貼り付け / 手入力も可）</span>
            </button>
          </div>
          {/* 右下の丸ボタンがカード右端の操作（展開・戻す等）を覆わないよう、ページ末尾に余白を足す */}
          <div className="h-20 print:hidden" aria-hidden />

          <div
            className="fixed right-5 z-40 print:hidden"
            style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <button
              type="button"
              onClick={openCleanAddModal}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-forest-600 text-white shadow-2xl ring-4 ring-white/90 hover:bg-forest-700 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-forest-200"
              aria-label="注文を追加"
              title="注文を追加"
            >
              <Plus className="h-7 w-7 stroke-[3]" aria-hidden />
            </button>
          </div>
        </>
      )}

      {/* 入力フォーム（現場=モーダル／注文の受付=ページ内） */}
      <FormShell
        inline={inline}
        open={isOpen}
        onClose={() => {
          if (!submitting) closeForm()
        }}
        title={step === 'confirm' ? '内容の確認' : inline ? '注文の受付' : '注文を追加'}
        footer={
          step === 'confirm' ? (
            <div className="flex w-full items-center justify-between gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('input')}
                disabled={submitting}
                className="flex items-center gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" />
                修正に戻る
              </Button>
              <Button
                type="button"
                onClick={submitFinal}
                isLoading={submitting}
                className="bg-forest-600 hover:bg-forest-700 text-white font-black px-6 flex items-center gap-2 shadow-md"
              >
                <Check className="h-4 w-4" />
                この内容で確定・保存する
              </Button>
            </div>
          ) : (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={closeForm}
                disabled={submitting || analyzingNatural || analyzingPhoto}
                className="min-h-10 whitespace-nowrap"
              >
                {inline ? '入力を消す' : 'キャンセル'}
              </Button>
              {manualFormOpen && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={proceedToConfirm}
                  disabled={analyzingNatural || analyzingPhoto || !customerId || !productId || !qtyRaw.trim()}
                  className="min-h-10 whitespace-nowrap font-bold px-3.5 text-xs flex items-center gap-1"
                >
                  <span>確認してから登録</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (!customerId) {
                      toast.error('取引先を選択してください')
                      return
                    }
                    if (!productId) {
                      toast.error('品目を選択してください')
                      return
                    }
                    if (!qtyRaw.trim() || previewText?.kind === 'error') {
                      toast.error('有効な数量を入力してください')
                      return
                    }
                    if (destinationRequired && !destinationId) {
                      toast.error('納入先を選択してください')
                      return
                    }
                    void submitFinal()
                  }}
                  isLoading={submitting}
                  disabled={analyzingNatural || analyzingPhoto || !customerId || !productId || !qtyRaw.trim() || (destinationRequired && !destinationId)}
                  className="min-h-10 whitespace-nowrap bg-forest-600 hover:bg-forest-700 text-white font-black px-5 flex items-center gap-1.5 shadow-md"
                >
                  <Check className="h-4 w-4" />
                  <span>登録する</span>
                </Button>
              </div>
              )}
            </div>
          )
        }
      >
        {step === 'confirm' ? (
          // =========================================================
          // Step 2: 変更前後差分付き確認カード
          // =========================================================
          <div className="space-y-4 py-1">
            <div className="rounded-2xl border-2 border-forest-200 bg-forest-50/70 p-5 space-y-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-forest-200 pb-2">
                <span className="text-xs font-black text-forest-800 uppercase tracking-wide">
                  {mode === 'increase'
                    ? '⚡ 既存出荷への加算（増量）'
                    : mode === 'decrease'
                    ? '📉 出荷数量の減量'
                    : mode === 'set'
                    ? '🔄 数量上書き'
                    : '✨ 新規出荷登録'}
                </span>
                <span className="whitespace-nowrap rounded-lg bg-forest-200/80 px-2.5 py-0.5 text-xs font-black text-forest-900">
                  {targetDate} 納品分
                </span>
              </div>

              {/* 取引先 & 納入先 */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-bold text-ink-muted">取引先</p>
                  <p className="font-black text-base text-ink">{custObj?.name || '未指定'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-ink-muted">納入先</p>
                  <p className="font-bold text-sm text-ink">{destObj?.label || '（指定なし・通常便）'}</p>
                </div>
              </div>

              {/* 品目 & 荷姿（コンテナ・規格・シール・カード） */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-bold text-ink-muted">出荷品目・規格</p>
                  <p className="font-black text-base text-ink">{prodObj?.name || 'チンゲン菜'}</p>
                  <p className="text-xs font-bold text-forest-800 mt-0.5">{spec || `入数${inputPacksPerCase}`}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-ink-muted">容器・シール・カード</p>
                  <p className="font-black text-sm text-ink">{containerType || '青コン'}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    <span className="text-xs font-bold text-ink-soft">
                      {hasCard ? '🏷 品名カードあり' : 'カードなし'}
                    </span>
                    {hasSeal !== null && (
                      <span className={cn('text-xs font-bold px-1.5 rounded', hasSeal ? 'bg-harvest-100 text-forest-900' : 'bg-bg-soft text-ink-soft')}>
                        {hasSeal ? sealText || 'シールあり' : 'シールなし'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 数量（差分表示） */}
              <div className="rounded-xl border border-forest-200 bg-bg-card p-3.5 space-y-1">
                <p className="text-xs font-bold text-ink-muted">出荷数量・ケース換算</p>
                {existingShipmentInfo ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-ink-muted font-bold line-through tabular-nums">
                        現在: {Math.floor(existingShipmentInfo.current_quantity / (inputPacksPerCase || 20))}箱 ({existingShipmentInfo.current_quantity} {unit})
                      </span>
                      <span className="font-black text-forest-700 text-lg">
                        ➔ {mode === 'set' ? '変更後' : '反映後'}:{' '}
                        {(() => {
                          const delta = preview && preview.type === 'ok' ? preview.total.toNumber() : 0
                          if (mode === 'increase' || mode === 'create') return existingShipmentInfo.current_quantity + delta
                          if (mode === 'decrease') return Math.max(0, existingShipmentInfo.current_quantity - delta)
                          return delta
                        })()}{' '}
                        {unit}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-forest-800">
                      （差分: {mode === 'decrease' ? '-' : '+'}{previewText?.text}
                      {mode === 'create' ? ' ※既存出荷に自動合算されます' : ''}）
                    </p>
                  </div>
                ) : (
                  <div className="text-forest-900">
                    <p className="text-xl font-black">{previewText?.text}</p>
                  </div>
                )}
              </div>

              {/* 現場メモ */}
              {note && (
                <div className="rounded-lg bg-sand-100/60 p-2 text-xs font-bold text-ink-soft">
                  <span>📝 現場メモ: </span>
                  <span className="text-ink">{note}</span>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-ink-soft font-bold">
              内容に間違いがなければ「この内容で確定・保存する」を押してください。
            </p>
          </div>
        ) : (
          // =========================================================
          // Step 1: 1画面統合レイアウト（スマートバー ＋ 読み取り結果まとめ一覧 ＋ 直接入力）
          // =========================================================
          <div className="space-y-4">
            {/* 📷 ファイル・画像隠しInput群 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-camera-input-unified"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-gallery-input-unified"
            />
            <input
              ref={fileSelectorRef}
              type="file"
              accept="image/*,application/pdf,.xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-file-selector-unified"
            />

            {/* ① スマート入力エリア（ボトムアクションシート起動 ＋ 自然言語・画像統合解析） */}
            <div
              onDragOver={(e) => {
                if (allowAiRead && Array.from(e.dataTransfer.types).includes('Files')) {
                  e.preventDefault()
                  setDragOver(true)
                }
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                const file = allowAiRead ? e.dataTransfer.files?.[0] : undefined
                setDragOver(false)
                if (file) {
                  e.preventDefault()
                  void handleGenericFile(file)
                }
              }}
              className={cn(
                'rounded-2xl border-2 bg-gradient-to-br from-forest-50/70 to-harvest-50/40 p-4 space-y-3 shadow-2xs',
                dragOver ? 'border-dashed border-forest-600' : 'border-forest-200',
              )}
            >
              {/* 受注経路（電話・LINE・紙）— 評価指標「紙の卒業」の計測用。AI読み取りの入力から自動推定し、前回の選択も記憶 */}
              {fixedIntakeChannel ? (
                <p className="text-xs font-bold text-forest-900">
                  受注経路: {fixedIntakeChannel === 'fax' ? 'FAX' : 'メール'}（受信ボックスの原本から読み取り）
                </p>
              ) : (
                <IntakeChannelPicker value={intakeChannel} onChange={setIntakeChannel} />
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-black text-forest-900">
                  <Sparkles className="h-4 w-4 text-forest-600" />
                  注文書・写真・自然言語からAIスマート入力
                </span>
                {appliedRulesCount > 0 && (
                  <span className="whitespace-nowrap rounded-full bg-harvest-100 border border-harvest-400 px-2 py-0.5 text-xs font-black text-forest-900">
                    ✓ 事前指示書 {appliedRulesCount}件 適用済
                  </span>
                )}
              </div>

              {allowAiRead && (
              <>
              {/* 1タップで下から開く読み込みアクションボタン */}
              <button
                type="button"
                onClick={() => setActionSheetOpen(true)}
                className="w-full py-2.5 px-3.5 rounded-xl bg-forest-800 hover:bg-forest-900 text-white font-bold text-xs flex items-center justify-between shadow-2xs active:scale-[0.99] transition"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-harvest-100" />
                  <span>📄 注文書・写真・ファイルから自動読込</span>
                </span>
                <span className="text-xs font-bold text-harvest-100 bg-white/10 px-2 py-0.5 rounded">
                  カメラ / 写真 / PDF / Excel ➜
                </span>
              </button>
              </>
              )}

              {/* 📷 添付中の画像・ファイルプレビュー */}
              {(photoPreview || attachedFilePayload) && (
                <div className="flex items-center justify-between rounded-xl bg-bg-card p-2.5 border-2 border-forest-200 shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    {photoPreview ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- ローカルで選んだ写真のdata URLプレビュー。next/imageは最適化対象外のURLに向かない */
                      <img src={photoPreview} alt="添付画像" className="h-11 w-11 object-cover rounded-lg border border-forest-200" />
                    ) : (
                      <div className="h-11 w-11 rounded-lg bg-forest-100 text-forest-800 flex items-center justify-center font-black text-xs">
                        FILE
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-black text-forest-900 block">
                        📎 {attachedFilePayload?.fileName || '注文書画像を添付中'}
                      </span>
                      <span className="text-xs font-bold text-forest-800">
                        下のテキスト欄に補足指示を書いて「AIで解析して入力」を押すと画像＋指示で再解析できます
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview(null)
                      setAttachedFilePayload(null)
                    }}
                    className="text-xs text-alert font-bold hover:underline px-2 py-1 shrink-0"
                  >
                    解除
                  </button>
                </div>
              )}

              {/* 自然言語・補足指示入力欄 */}
              <div className="relative">
                <textarea
                  id="shipment-natural-text-area"
                  ref={naturalTextAreaRef}
                  value={naturalText}
                  onChange={(e) => {
                    setNaturalText(e.target.value)
                    if (!e.target.value.trim()) textPastedRef.current = false
                  }}
                  onPaste={(e) => {
                    // 画像（スクリーンショット・コピーした写真）の貼り付け → そのまま読み取り
                    const imageFile = allowAiRead
                      ? Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
                      : undefined
                    if (imageFile) {
                      e.preventDefault()
                      void handlePhotoFile(imageFile, { fromClipboard: true })
                      return
                    }
                    if (e.clipboardData.getData('text').trim()) textPastedRef.current = true
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleNaturalInputSubmit()
                    }
                  }}
                  rows={3}
                  placeholder="LINEの文面や画像をここに貼り付け／例:「明日の和郷園に20c追加」「寺崎 50P」"
                  className="w-full rounded-xl border border-forest-200/80 bg-bg-card p-3 text-sm text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:outline-none focus:ring-2 focus:ring-forest-200"
                />
              </div>

              {/* 解析ボタン（画像が添付されていればテキストが空でも押せる！） */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-muted">
                  画像選択時に自動解析されます。テキスト入力後や再解析時は右のボタンを押してください
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleNaturalInputSubmit}
                  disabled={analyzingNatural || analyzingPhoto || (!naturalText.trim() && !attachedFilePayload)}
                  className="bg-forest-700 hover:bg-forest-800 text-white font-bold shrink-0 text-xs px-3.5 h-8 flex items-center gap-1.5 shadow-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{attachedFilePayload ? '画像をAI再解析' : 'AIで解析して入力'}</span>
                </Button>
              </div>

              {/* ⏳ ストリーミング・ステップ進捗演出 */}
              {(analyzingNatural || analyzingPhoto) && (
                <div className="rounded-xl border border-forest-200 bg-bg-card p-3.5 space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-black text-forest-800">
                      <Loader2 className="h-4 w-4 animate-spin text-forest-600" />
                      <span>
                        {streamStep === 1
                          ? '📖 (1/3) 注文書画像・テキストを読み取り中...'
                          : streamStep === 2
                          ? '🏢 (2/3) 事前指示書（AIルール）・取引先・納入先マスタと照合中...'
                          : '✨ (3/3) 確定事項・確認項目まとめを作成中...'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelNaturalAnalysis}
                      className="text-xs text-ink-soft hover:text-ink font-bold underline"
                    >
                      中断
                    </button>
                  </div>
                  <div className="h-1.5 w-full bg-forest-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-forest-600 transition-all duration-300 ease-out"
                      style={{ width: `${(streamStep / 3) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* ===================================================================== */}
              {/* 📋 3/3 確定事項・読み取り結果まとめ一覧（「この内容でよいか？」ワンタップ確認ボード） */}
              {/* ===================================================================== */}
              {parsedCandidates.length > 0 && !analyzingNatural && !analyzingPhoto && (
                <div className="rounded-2xl border-2 border-harvest-400 bg-bg-card p-3.5 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-harvest-100 pb-2">
                    <div>
                      <p className="text-xs font-black text-forest-900 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-harvest-600 shrink-0" />
                        <span>
                          【AI読み取り結果まとめ】わかる範囲をすべて入力しました。この内容でよろしいですか？
                        </span>
                      </p>
                      <p className="text-xs font-bold text-ink-muted mt-0.5">
                        取引先: <span className="text-ink font-black">{parsedCandidates[0]?.customer_name || custObj?.name || '自動判定'}</span>
                        {' ／ '}容器: <span className="text-ink font-black">{parsedCandidates[0]?.container_type || containerType}</span>
                        {' ／ '}入数: <span className="text-ink font-black">{parsedCandidates[0]?.packs_per_case || inputPacksPerCase}P/箱</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveRuleToMaster()}
                      disabled={savingAiRule}
                      className="inline-flex items-center gap-1 rounded-lg border border-harvest-400 bg-harvest-50 hover:bg-harvest-100 px-2.5 py-1 text-xs font-black text-forest-900 transition"
                      title="この取引先の読み取り特徴を事前指示書（AIルール）に保存します"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5 text-harvest-700" />
                      <span>{savingAiRule ? '保存中...' : '指示書に記憶'}</span>
                    </button>
                  </div>

                  {/* ① 週間表・複数日が含まれる場合の「登録対象日スコープ」ワンタップ切替（質問①への回答機能） */}
                  {uniqueCandidateDates.length >= 2 && (
                    <div className="rounded-xl bg-forest-50/80 border border-forest-200 p-2.5 space-y-1.5">
                      <p className="text-xs font-black text-forest-900">
                        📅 複数日（{uniqueCandidateDates.length}日分）の週間表が検出されました。反映する範囲を選択してください：
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDateScopeToggle('all')}
                          className={cn(
                            'rounded-lg py-1.5 px-2.5 text-xs font-black border text-left transition flex items-center justify-between',
                            dateScopeMode === 'all'
                              ? 'border-forest-700 bg-forest-700 text-white shadow-2xs'
                              : 'border-forest-200 bg-bg-card text-ink hover:bg-forest-100/60',
                          )}
                        >
                          <span>📅 表の全日程を一括反映（{uniqueCandidateDates.map(formatShortDateWithWeekday).join('〜')}）</span>
                          {dateScopeMode === 'all' && <span>✓</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDateScopeToggle('target_only')}
                          className={cn(
                            'rounded-lg py-1.5 px-2.5 text-xs font-black border text-left transition flex items-center justify-between',
                            dateScopeMode === 'target_only'
                              ? 'border-forest-700 bg-forest-700 text-white shadow-2xs'
                              : 'border-forest-200 bg-bg-card text-ink hover:bg-forest-100/60',
                          )}
                        >
                          <span>🎯 選択中の納品日（{formatShortDateWithWeekday(targetDate)}）のみ反映</span>
                          {dateScopeMode === 'target_only' && <span>✓</span>}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ② 欄外内訳（例：6関西 ライフ近畿：40 / サンプラザ：20）の分割・統合確認カード（質問④への回答機能） */}
                  {parsedCandidates.map((cand) => {
                    if (cand.breakdownParts && cand.breakdownParts.length >= 2) {
                      return (
                        <div
                          key={`breakdown-${cand.id}`}
                          className="rounded-xl border-2 border-warning bg-warning-bg/90 p-2.5 space-y-1.5"
                        >
                          <p className="text-xs font-black text-earth-900 flex items-center gap-1.5">
                            <Split className="h-4 w-4 text-earth-800 shrink-0" />
                            <span>
                              📌 確認：{formatShortDateWithWeekday(cand.delivery_date)}「{cand.destination_name}（{cand.cases}箱＝{cand.quantity}P）」に欄外内訳があります
                            </span>
                          </p>
                          <p className="text-xs font-bold text-earth-900">
                            {cand.note} — 現場ボードでの登録方法を選べます：
                          </p>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            <span className="rounded-lg border border-warning bg-warning text-white px-2.5 py-1 text-xs font-black">
                              ✓ 現在：「{cand.destination_name}（{cand.cases}箱）」1件にまとめメモに内訳記載
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSplitCandidateBreakdown(cand.id)}
                              className="rounded-lg border border-warning bg-bg-card hover:bg-warning-bg text-ink px-2.5 py-1 text-xs font-black transition shadow-2xs flex items-center gap-1"
                            >
                              <Split className="h-3.5 w-3.5" />
                              <span>
                                👉 {cand.breakdownParts.map((p) => `${p.subDestination} ${p.cases}箱`).join(' と ')} の{cand.breakdownParts.length}件に分けて登録する
                              </span>
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return null
                  })}

                  {/* 分割後の明細を1件に戻すボタン */}
                  {Array.from(new Set(parsedCandidates.map((c) => c.parentGroupId).filter(Boolean))).map((groupId) => (
                    <div
                      key={`merge-${groupId}`}
                      className="rounded-xl border border-harvest-400 bg-harvest-50/70 p-2 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-bold text-forest-900">
                        ✓ 欄外内訳を店舗別の2件に分割中です
                      </span>
                      <button
                        type="button"
                        onClick={() => handleMergeSplitCandidates(groupId!)}
                        className="rounded-lg border border-harvest-400 bg-bg-card hover:bg-harvest-100 px-2.5 py-1 text-xs font-black text-forest-900 flex items-center gap-1"
                      >
                        <Merge className="h-3.5 w-3.5" />
                        <span>1件（60箱・メモに内訳）に戻す</span>
                      </button>
                    </div>
                  ))}

                  {/* ③ 抽出明細一覧（各行でチェックON/OFF・箱数微調整・シール/規格/赤字バッジ確認可能） */}
                  <div className="max-h-[28rem] overflow-y-auto space-y-2 pr-0.5">
                    {parsedCandidates.map((cand, cIdx) => {
                      const qNum = Number(String(cand.quantity ?? '0').replace(/,/g, ''))
                      const ppc = cand.packs_per_case || inputPacksPerCase || 20
                      const cCases = cand.cases ?? (ppc > 0 ? Math.floor(qNum / ppc) : 0)
                      const isZero = qNum === 0
                      const isRedModified = Boolean((cand.note ?? '').includes('赤字') || cand.is_handwritten_modified)
                      const hasExisting = cand.existing_quantity != null && cand.existing_quantity > 0
                      const isCurrent = cIdx === activeCandidateIdx

                      return (
                        <div
                          key={cand.id}
                          onClick={() => selectParsedCandidate(cIdx)}
                          className={cn(
                            'rounded-xl border p-2.5 transition cursor-pointer flex flex-col gap-1.5',
                            cand.registered
                              ? 'border-harvest-400 bg-harvest-50/60 opacity-75'
                              : isCurrent
                              ? 'border-forest-600 bg-forest-50/50 ring-1 ring-forest-500'
                              : cand.selected
                              ? 'border-line bg-bg-card hover:border-forest-200'
                              : 'border-line bg-bg-soft opacity-60',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={cand.selected}
                                disabled={cand.registered}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  const checked = e.target.checked
                                  setParsedCandidates((prev) =>
                                    prev.map((item) => (item.id === cand.id ? { ...item, selected: checked } : item)),
                                  )
                                }}
                                className="h-4 w-4 rounded border-forest-400 text-forest-700 focus:ring-forest-500"
                              />
                              <span className="whitespace-nowrap rounded-md bg-forest-900 text-white px-2 py-0.5 text-xs font-black shrink-0">
                                {formatShortDateWithWeekday(cand.delivery_date)}
                              </span>
                              {/* 表示は常に「取引先 ＞ 納入先」（CLAUDE.md） */}
                              <span className="font-black text-sm text-ink truncate">
                                {cand.customer_name || '取引先不明'}
                                {cand.destination_name && cand.destination_name !== cand.customer_name && (
                                  <span className="font-bold text-ink-soft"> ＞ {cand.destination_name}</span>
                                )}
                              </span>
                            </div>

                            {/* ステータス・差分バッジ */}
                            <div className="flex items-center gap-1 shrink-0">
                              {cand.registered ? (
                                <span className="whitespace-nowrap rounded bg-harvest-600 text-white px-2 py-0.5 text-xs font-black">
                                  ✓ 反映済
                                </span>
                              ) : isZero ? (
                                hasExisting ? (
                                  <span className="whitespace-nowrap rounded bg-alert-bg border border-alert text-alert px-2 py-0.5 text-xs font-black">
                                    🗑️ 既存取消 ({cand.existing_quantity}P→0P)
                                  </span>
                                ) : (
                                  <span className="whitespace-nowrap rounded bg-line text-ink-soft px-2 py-0.5 text-xs font-bold">
                                    ー 注文なし (0P・スキップ)
                                  </span>
                                )
                              ) : hasExisting ? (
                                cand.existing_quantity === qNum ? (
                                  <span className="whitespace-nowrap rounded bg-harvest-100 text-forest-900 px-2 py-0.5 text-xs font-black">
                                    ✓ 登録済と同数 ({qNum}P)
                                  </span>
                                ) : (
                                  <span className="whitespace-nowrap rounded bg-warning-bg border border-warning text-ink px-2 py-0.5 text-xs font-black">
                                    🔄 変更 ({cand.existing_quantity}P ➔ {qNum}P)
                                  </span>
                                )
                              ) : (
                                <span className="whitespace-nowrap rounded bg-harvest-100 text-forest-900 px-2 py-0.5 text-xs font-black">
                                  ✨ 新規登録
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 2行目：品目名・規格・シール・赤字確認バッジ ＋ 箱数ステッパー */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-base font-black text-forest-900">
                                {cand.product_name || `明細${cIdx + 1}`}
                              </span>
                              {cand.spec && (
                                <span title={String(cand.spec)} className="inline-block align-bottom truncate max-w-[12rem] rounded bg-sand-100 border border-sand-300 px-1.5 py-0.5 text-xs font-black text-ink">
                                  {cand.spec}
                                </span>
                              )}
                              {cand.has_seal !== null && cand.has_seal !== undefined && (
                                <span
                                  className={cn(
                                    'rounded px-1.5 py-0.5 text-xs font-black border',
                                    cand.has_seal
                                      ? 'bg-harvest-50 border-harvest-400 text-forest-900'
                                      : 'bg-bg-soft border-line-strong text-ink-soft',
                                  )}
                                >
                                  {cand.has_seal ? '🏷️ シールあり' : 'シールなし'}
                                </span>
                              )}
                              {isRedModified && (
                                <span className="whitespace-nowrap rounded bg-alert-bg border border-alert text-alert px-1.5 py-0.5 text-xs font-black">
                                  🔴 赤字・変更箇所
                                </span>
                              )}
                              {cand.note && (
                                <span className="text-xs font-bold text-ink-soft truncate max-w-[210px]">
                                  📝 {cand.note}
                                </span>
                              )}
                            </div>

                            {/* 箱数・パック数のインライン微調整 */}
                            {!cand.registered && (
                              <div
                                className="flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleCandidateCasesChange(cand.id, cCases - 1)}
                                  aria-label={`${cand.product_name ?? '明細'} を1箱減らす`}
                                  className="h-10 w-10 rounded-lg border border-line bg-bg-card hover:bg-sand-100 font-black text-base text-ink flex items-center justify-center"
                                >
                                  -
                                </button>
                                <span className="num text-sm font-black text-forest-900 min-w-[96px] text-center tabular-nums">
                                  {cCases}箱 <span className="text-xs font-bold text-ink-soft">({qNum}P)</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCandidateCasesChange(cand.id, cCases + 1)}
                                  aria-label={`${cand.product_name ?? '明細'} を1箱増やす`}
                                  className="h-10 w-10 rounded-lg border border-line bg-bg-card hover:bg-sand-100 font-black text-base text-ink flex items-center justify-center"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* 🚨 未登録取引先が検出された場合、まとめ一覧内で即座に確認・新規作成できるバナー */}
                  {showNewCustomer && (
                    <div className="rounded-xl border-2 border-warning bg-warning-bg p-3 space-y-2 shadow-2xs">
                      <p className="text-xs font-black text-ink flex items-center gap-1.5">
                        <UserPlus className="h-4 w-4 text-ink shrink-0" />
                        <span>
                          未登録の取引先「{newCustomerName || parsedCandidates[0]?.customer_name}」が検出されました。新規取引先として登録しますか？
                        </span>
                      </p>
                      <p className="text-xs font-bold text-earth-900">
                        別会社の納入先に混ざらないよう自動ストップしました。下の「✨ 新規取引先のワンストップ一括登録」で取引先を作成してから反映してください。
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleCreateOneStopCustomer}
                          isLoading={creatingCustomer}
                          disabled={!newCustomerName.trim()}
                          className="bg-forest-700 hover:bg-forest-800 text-white font-black text-xs h-8 px-3.5 shadow-2xs"
                        >
                          ✨ 「{newCustomerName}」を新規取引先として即座に作成（{newPacksPerCase}P/箱・{newContainerType}）
                        </Button>
                        <button
                          type="button"
                          onClick={() => setManualFormOpen(true)}
                          className="text-xs font-bold text-forest-800 underline px-2 py-1"
                        >
                          詳細（納入先・別名）を編集してから作成
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ④ ワンタップ一括反映ボタン */}
                  {selectedCandidateCount > 0 && (
                    <button
                      type="button"
                      onClick={handleBatchRegisterAllCandidates}
                      disabled={batchRegistering}
                      className="w-full rounded-xl bg-harvest-600 hover:bg-harvest-700 disabled:opacity-50 text-white font-black text-sm py-3 px-4 flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition"
                    >
                      {batchRegistering ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>選択した明細を一括反映中...</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 stroke-[3]" />
                          <span>
                            はい、チェックした {selectedCandidateCount} 件をこの内容でまとめて登録・反映する
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* 🟢 単発入力時の【確定事項】バッジ表示 */}
              {confirmedBadges.length > 0 && parsedCandidates.length === 0 && !analyzingNatural && !analyzingPhoto && (
                <div className="rounded-xl border border-harvest-400 bg-harvest-50/80 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-forest-900 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-harvest-600 shrink-0" />
                      <span>【確定事項】以下の項目を特定し、下の入力欄へ反映しました</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => handleSaveRuleToMaster()}
                      disabled={savingAiRule}
                      className="inline-flex items-center gap-1 rounded-md border border-harvest-400 bg-bg-card px-2 py-0.5 text-xs font-black text-forest-900 hover:bg-harvest-100"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                      <span>指示書に記憶</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {confirmedBadges.map((b, i) => (
                      <span key={i} className="rounded-md bg-bg-card border border-harvest-400 px-2 py-0.5 text-xs font-bold text-forest-800 shadow-2xs">
                        ✓ {b}
                      </span>
                    ))}
                  </div>
                  {aiExplanation && (
                    <p className="text-xs text-forest-900 font-medium pt-1 border-t border-harvest-400/60">
                      💡 {aiExplanation}
                    </p>
                  )}
                </div>
              )}

              {/* 🟡 【確認・不足項目】提示カード（事前指示書で解決できない不明点のみピンポイントで質問） */}
              {uncertainItems.length > 0 && !analyzingNatural && !analyzingPhoto && (
                <div className="rounded-xl border-2 border-warning bg-warning-bg p-3.5 space-y-2.5">
                  <p className="text-xs font-black text-ink flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                    <span>【確認・不足項目】不明な点があります。以下から選択してください</span>
                  </p>
                  <div className="space-y-2">
                    {uncertainItems.map((item, idx) => (
                      <div key={idx} className="rounded-lg bg-bg-card p-2.5 border border-warning space-y-1.5">
                        <p className="text-xs font-bold text-ink">{item.question}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {item.suggestions.map((sug, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => handleSelectSuggestion(item, sug)}
                              className="rounded-lg border border-warning bg-warning-bg/70 hover:bg-warning-bg px-2.5 py-1 text-xs font-black text-ink transition-colors shadow-2xs active:scale-95"
                            >
                              👉 {sug}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ② 構造化直接入力フォーム（AI候補一覧がある時は1行に折りたたんで画面をスッキリ保ち、タップでいつでも展開可能 #18） */}
            <div className="space-y-3 pt-1 border-t border-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setManualFormOpen((prev) => !prev)}
                  aria-expanded={manualFormOpen}
                  className="inline-flex min-h-10 items-center gap-1.5 text-xs font-black text-forest-900 bg-forest-50 hover:bg-forest-100 border border-forest-200 px-3 rounded-lg transition"
                >
                  <span>{manualFormOpen ? '▲ 手入力の欄をたたむ' : '✍️ 手で入力する・数量を直す'}</span>
                </button>
                {/* 操作モード選択 */}
                <label className="flex items-center gap-1 text-xs font-bold">
                  <span className="text-ink-muted">操作:</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                    className="h-10 rounded-lg border border-line bg-bg-card px-2 text-xs font-bold text-ink"
                  >
                    <option value="create">✨ 新規追加</option>
                    <option value="increase">⚡ 既存出荷に加算（増量）</option>
                    <option value="decrease">📉 減量</option>
                    <option value="set">🔄 数量上書き</option>
                  </select>
                </label>
              </div>

              {manualFormOpen && (
              <div className="space-y-3.5">

              {/* 納品日 ＆ 時間帯指定（重複していた朝/昼ボタンとセレクトを1行ずつに整理） */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-ink">納品日 ＆ 便時間帯</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTargetDate(todayStr)}
                      className={cn(
                        'min-h-10 rounded-md px-3 text-xs font-bold transition-colors',
                        targetDate === todayStr
                          ? 'bg-forest-600 text-white shadow-2xs'
                          : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      今日 ({todayStr.slice(5)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetDate(tomorrowStr)}
                      className={cn(
                        'min-h-10 rounded-md px-3 text-xs font-bold transition-colors',
                        targetDate === tomorrowStr
                          ? 'bg-forest-600 text-white shadow-2xs'
                          : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      明日 ({tomorrowStr.slice(5)})
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    aria-label="納品日"
                    wrapperClassName="col-span-5"
                    className="h-10 px-2 text-sm"
                  />
                  <div className="col-span-7 grid grid-cols-3 rounded-lg border border-line bg-sand-50 p-0.5 text-xs font-bold">
                    {([
                      { val: '', label: '指定なし' },
                      { val: 'am', label: '🌅 午前' },
                      { val: 'pm', label: '☀️ 午後' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setShippingTime(opt.val)}
                        className={cn(
                          'min-h-9 rounded-md py-1 text-xs font-black transition',
                          shippingTime === opt.val
                            ? 'bg-bg-card text-ink shadow-2xs ring-1 ring-forest-600/20'
                            : 'text-ink-muted hover:text-ink',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 取引先セレクト（ワンタップ主要取引先チップ ＋ 全件セレクト） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-ink">取引先（ワンタップ選択）</label>
                </div>
                {customers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {customers.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          aiExplicitFieldsRef.current = {}
                          setShowNewCustomer(false)
                          setCustomerId(c.id)
                        }}
                        className={cn(
                          'min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-black transition-all active:scale-95',
                          customerId === c.id
                            ? 'border-forest-700 bg-forest-700 text-white shadow-xs ring-2 ring-forest-200'
                            : 'border-line bg-bg-card text-ink hover:bg-bg-soft',
                        )}
                      >
                        {c.name.replace(/^株式会社|^（株）|^㈱|^農事組合法人\s*/, '')}
                      </button>
                    ))}
                  </div>
                )}
                <Select
                  label="全取引先リストから選択"
                  required
                  placeholder="取引先を選択..."
                  value={customerId}
                  onChange={(e) => {
                    aiExplicitFieldsRef.current = {}
                    setShowNewCustomer(false)
                    setCustomerId(e.target.value)
                  }}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                {!showNewCustomer && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(true)}
                      className="inline-flex min-h-10 items-center gap-1 px-1 text-xs font-bold text-forest-700 hover:underline"
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden />
                      その場で取引先を追加
                    </button>
                  </div>
                )}
              </div>

              {/* 取引先ワンストップ一括作成 */}
              {showNewCustomer && (
                <div className="rounded-2xl border-2 border-forest-400 bg-gradient-to-br from-forest-50 to-sand-50 p-4 space-y-3.5 shadow-md animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-forest-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-forest-600 p-1 text-white">
                        <UserPlus className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-black text-forest-900">✨ 新規取引先のワンストップ一括登録</h4>
                        <p className="text-xs text-ink-muted">納入先・入数ルール・AI解析ルールも同時に登録し即座に適用します</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(false)}
                      className="text-xs font-bold text-ink-muted hover:text-ink px-2 py-1 rounded-md hover:bg-forest-100"
                    >
                      ✕ 閉じる
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <label className="font-black text-ink">取引先名（必須）</label>
                      <Input
                        placeholder="例: ランドローム（やなぎさわファーム）"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="h-9 text-xs"
                        autoFocus
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-black text-ink">納入先（店舗・センター・運送）</label>
                      <Input
                        placeholder="例: 小松運輸 / 本社 / 成田センター"
                        value={newDestinationName}
                        onChange={(e) => setNewDestinationName(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-black text-ink">1箱の入数（P/箱）</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={newPacksPerCase}
                          onChange={(e) => setNewPacksPerCase(Math.max(1, Number(e.target.value)))}
                          className="h-9 text-xs w-24"
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setNewPacksPerCase(10)}
                            className={cn(
                              'px-2 py-1 text-xs font-bold rounded transition-colors',
                              newPacksPerCase === 10 ? 'bg-forest-600 text-white' : 'bg-sand-200 text-ink hover:bg-sand-300',
                            )}
                          >
                            10入
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewPacksPerCase(20)}
                            className={cn(
                              'px-2 py-1 text-xs font-bold rounded transition-colors',
                              newPacksPerCase === 20 ? 'bg-forest-600 text-white' : 'bg-sand-200 text-ink hover:bg-sand-300',
                            )}
                          >
                            20入
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="font-black text-ink">荷姿・容器種別</label>
                      <select
                        value={newContainerType}
                        onChange={(e) => setNewContainerType(e.target.value)}
                        className="w-full h-9 rounded-md border border-line bg-bg-card px-2 text-xs font-bold text-ink"
                      >
                        <option value="青コン">🟦 青コン（標準コンテナ）</option>
                        <option value="茶コン">🟫 茶コン</option>
                        <option value="房総青コン">🟦 房総青コン</option>
                        <option value="農業総研専用折りたたみコンテナ">🟩 NSK専用オリコン</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="font-black text-ink">伝票上の表記・別名（AI自動認識用）</label>
                        <span className="text-xs text-ink-muted">カンマ区切りで複数指定可</span>
                      </div>
                      <Input
                        placeholder="例: やなぎさわファーム, ランドローム, 株式会社 やなぎさわファーム"
                        value={newAliases}
                        onChange={(e) => setNewAliases(e.target.value)}
                        className="h-9 text-xs"
                      />
                      <p className="text-xs text-forest-800">
                        💡 ここに入力した別名やルールは AI（ai_rules）にも即座に学習され、次回以降のFAX・注文書で自動認識されます。
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-forest-200">
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => setShowNewCustomer(false)}
                      className="h-8 text-xs"
                    >
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreateOneStopCustomer}
                      isLoading={creatingCustomer}
                      disabled={!newCustomerName.trim()}
                      className="bg-forest-700 hover:bg-forest-800 text-white font-bold h-8 text-xs px-4 shadow-sm"
                    >
                      ✨ 取引先・納入先・ルールを一括作成して適用
                    </Button>
                  </div>
                </div>
              )}

              {/* 納入先セレクト ＆ 既存取引先への新規納入先クイック追加 */}
              {customerId && !showNewCustomer && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-ink">
                      納入先・運送便{destinationRequired ? '（必須）' : '（任意）'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewDestForExisting(!showNewDestForExisting)}
                      className="text-xs font-bold text-forest-700 hover:text-forest-800 flex items-center gap-0.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {showNewDestForExisting ? '閉じる' : '新しい納入先・運送便を追加'}
                    </button>
                  </div>

                  {customerDestinations.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {customerDestinations.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              aiExplicitFieldsRef.current = {}
                              setDestinationId(d.id)
                            }}
                            className={cn(
                              'min-h-[38px] rounded-xl border px-3 py-1.5 text-xs font-black transition-all active:scale-95',
                              destinationId === d.id
                                ? 'border-harvest-700 bg-harvest-700 text-white shadow-xs ring-2 ring-harvest-400'
                                : 'border-line bg-bg-card text-ink hover:bg-bg-soft',
                            )}
                          >
                            📍 {d.label}
                          </button>
                        ))}
                      </div>
                      {customerDestinations.length > 6 && (
                        <Select
                          placeholder="リストから納入先を選択..."
                          value={destinationId}
                          onChange={(e) => {
                            aiExplicitFieldsRef.current = {}
                            setDestinationId(e.target.value)
                          }}
                          options={customerDestinations.map((d) => ({ value: d.id, label: d.label }))}
                        />
                      )}
                    </div>
                  ) : (
                    !showNewDestForExisting && (
                      <p className="text-xs text-ink-muted bg-bg-soft/60 rounded-lg px-3 py-2 border border-line">
                        登録済みの納入先はありません（直接納品、または右上の「＋新しい納入先・運送便を追加」から登録できます）
                      </p>
                    )
                  )}

                  {showNewDestForExisting && (
                    <div className="rounded-xl border-2 border-forest-200 bg-forest-50/60 p-3 space-y-2 shadow-2xs">
                      <p className="text-xs font-black text-forest-900">
                        📍 選択中の取引先に新しい納入先・運送便を追加
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="例: 5北海道 / 6関西 / 船橋センター"
                          value={newDestForExistingName}
                          onChange={(e) => setNewDestForExistingName(e.target.value)}
                          className="bg-bg-card flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleCreateDestinationForExisting}
                          isLoading={creatingDestForExisting}
                          disabled={!newDestForExistingName.trim()}
                          className="bg-forest-700 hover:bg-forest-800 text-white font-bold h-10 px-3.5 shrink-0"
                        >
                          追加して選択
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 品目選択（カテゴリ別） */}
              <div className="space-y-2">
                <label className="text-xs font-black text-ink">品目・規格</label>
                <div className="flex flex-wrap gap-1.5">
                  {categoryGroups.map((g) => (
                    <button
                      key={g.category}
                      type="button"
                      onClick={() => handleSelectCategory(g.category)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-bold transition-all',
                        selectedCategory === g.category
                          ? 'bg-forest-700 text-white shadow-xs'
                          : 'border border-line bg-bg-card text-ink-soft hover:bg-bg-soft',
                      )}
                    >
                      {g.category}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {categoryProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProductId(p.id)}
                      className={cn(
                        'rounded-xl border p-2 text-left text-xs font-bold transition-all',
                        productId === p.id
                          ? 'border-forest-600 bg-forest-50 text-forest-900 ring-2 ring-forest-600 shadow-2xs'
                          : 'border-line bg-bg-card text-ink hover:bg-bg-soft',
                      )}
                    >
                      <p className="truncate">{p.name}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* 💡 既存注文がすでにある場合のリアルタイム検知＆ワンタップ切替バナー */}
              {existingShipmentInfo && (
                <div className="rounded-2xl border-2 border-warning bg-warning-bg/90 p-3.5 space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-earth-900 flex items-center gap-1.5 flex-wrap">
                      <span>💡 この納入先・品目には現在</span>
                      <span className="rounded bg-warning text-white px-2 py-0.5 text-sm font-black tabular-nums">
                        {Math.floor(existingShipmentInfo.current_quantity / (inputPacksPerCase || 20))} 箱（{existingShipmentInfo.current_quantity.toLocaleString()} {unit}）
                      </span>
                      <span>登録されています</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMode('set')}
                      className={cn(
                        'rounded-xl py-1.5 px-2 text-xs font-black border transition-all',
                        mode === 'set'
                          ? 'border-warning bg-warning text-white shadow-2xs'
                          : 'border-warning bg-bg-card text-ink hover:bg-warning-bg',
                      )}
                    >
                      🔄 数量を上書き
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('increase')}
                      className={cn(
                        'rounded-xl py-1.5 px-2 text-xs font-black border transition-all',
                        mode === 'increase'
                          ? 'border-forest-700 bg-forest-700 text-white shadow-2xs'
                          : 'border-warning bg-bg-card text-ink hover:bg-warning-bg',
                      )}
                    >
                      ⚡ 追加（増量）
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('decrease')}
                      className={cn(
                        'rounded-xl py-1.5 px-2 text-xs font-black border transition-all',
                        mode === 'decrease'
                          ? 'border-alert bg-alert text-white shadow-2xs'
                          : 'border-warning bg-bg-card text-ink hover:bg-warning-bg',
                      )}
                    >
                      📉 減量する
                    </button>
                  </div>
                </div>
              )}

              {/* 📦 3連動数量エディタ（箱数・入数・総パック数の完全連動） */}
              <div className="rounded-2xl border-2 border-forest-200 bg-gradient-to-br from-forest-50/60 to-harvest-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-forest-900 flex items-center gap-1.5">
                    <span>📦 数量入力（箱数・入数・総パック数の連動計算）</span>
                  </label>
                  <span className="text-xs font-bold text-forest-700 bg-forest-100 px-2 py-0.5 rounded-full">
                    どの枠に入力しても自動計算
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* ① 1箱の入数 (P/箱) */}
                  <div className="rounded-xl bg-bg-card p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-ink">① 1箱の入数</span>
                      <span className="text-xs font-bold text-ink-muted">P/箱</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        value={inputPacksPerCase}
                        onChange={(e) => handlePacksPerCaseChange(Number(e.target.value))}
                        className="w-full h-10 rounded-lg border border-line bg-bg-card px-2.5 font-black text-base text-ink focus:border-forest-600 focus:outline-none"
                      />
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePacksPerCaseChange(20)}
                          className={cn(
                            'text-xs font-bold px-2 py-0.5 rounded transition-colors',
                            inputPacksPerCase === 20 ? 'bg-forest-600 text-white' : 'bg-sand-100 hover:bg-sand-200 text-ink',
                          )}
                        >
                          20入
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePacksPerCaseChange(24)}
                          className={cn(
                            'text-xs font-bold px-2 py-0.5 rounded transition-colors',
                            inputPacksPerCase === 24 ? 'bg-forest-600 text-white' : 'bg-sand-100 hover:bg-sand-200 text-ink',
                          )}
                        >
                          24入
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-ink-muted">標準: 20P（NSK: 24P）</p>
                  </div>

                  {/* ② 箱数（ケース数） */}
                  <div className="rounded-xl bg-bg-card p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-forest-900">② 箱数（ケース）</span>
                      <span className="text-xs font-bold text-forest-700">箱 / ケース</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder="例: 30"
                      value={inputCases}
                      onChange={(e) => handleCasesChange(e.target.value)}
                      className="w-full h-12 rounded-xl border-2 border-forest-500 bg-forest-50/30 px-3 font-mono tabular-nums font-black text-xl text-forest-900 focus:border-forest-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-1 pt-0.5">
                      {[5, 10, 20, 30].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            const cur = Number(inputCases) || 0
                            handleCasesChange(String(cur + n))
                          }}
                          className="flex-1 h-9 text-xs font-black rounded-lg border border-line bg-sand-100 hover:bg-forest-100 text-ink active:scale-95 transition"
                        >
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ③ 総パック数 (P) */}
                  <div className="rounded-xl bg-bg-card p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-forest-900">③ 総パック数</span>
                      <span className="text-xs font-bold text-harvest-700">{unit}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder="例: 300"
                      value={inputTotalPacks}
                      onChange={(e) => handleTotalPacksChange(e.target.value)}
                      className="w-full h-12 rounded-xl border-2 border-harvest-500 bg-harvest-50/30 px-3 font-mono tabular-nums font-black text-xl text-forest-900 focus:border-harvest-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-1 pt-0.5">
                      {[50, 100, 200].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            const cur = Number(inputTotalPacks) || 0
                            handleTotalPacksChange(String(cur + n))
                          }}
                          className="flex-1 h-9 text-xs font-black rounded-lg border border-line bg-sand-100 hover:bg-harvest-100 text-ink active:scale-95 transition"
                        >
                          +{n}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setInputCases('')
                          setInputTotalPacks('')
                          setQtyRaw('')
                        }}
                        className="text-xs font-bold px-1.5 py-0.5 rounded bg-alert-bg text-alert hover:bg-alert/10"
                      >
                        クリア
                      </button>
                    </div>
                  </div>
                </div>

                {/* 連動計算ビジュアル帯 */}
                <div className="rounded-xl border border-forest-200 bg-bg-card/95 p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-black text-forest-900">
                    <span className="text-sm">📦</span>
                    <span>{inputCases || 0} 箱</span>
                    <span className="text-ink-muted">×</span>
                    <span>{inputPacksPerCase} P/箱</span>
                    <span className="text-forest-600">＝</span>
                    <span className="text-sm text-forest-800 underline decoration-forest-400 font-black">
                      {inputTotalPacks || 0} {unit}（総数）
                    </span>
                  </div>
                  {previewText && (
                    <span
                      className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded',
                        previewText.kind === 'error' ? 'bg-alert-bg text-alert' : 'bg-forest-100 text-forest-900',
                      )}
                    >
                      {previewText.text}
                    </span>
                  )}
                </div>
              </div>

              {/* 🏷 現場荷姿設定（容器・規格・シール・品名カード有無） */}
              <div className="rounded-2xl border border-line bg-bg-soft/50 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black text-ink">🏷 容器・規格・シール・カード（自動判定）</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setHasSeal((prev) => {
                          const next = !prev
                          setSealText(next ? 'シールあり' : 'シールなし')
                          return next
                        })
                      }}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-black border transition-colors',
                        hasSeal
                          ? 'border-harvest-500 bg-harvest-50 text-forest-900'
                          : 'border-line bg-bg-card text-ink-muted',
                      )}
                    >
                      {hasSeal ? '🏷️ シールあり' : 'シールなし'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setHasCard((v) => !v)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-black border transition-colors',
                        hasCard
                          ? 'border-harvest-500 bg-harvest-50 text-forest-900'
                          : 'border-line bg-bg-card text-ink-muted',
                      )}
                    >
                      {hasCard ? '✓ 品名カードあり' : 'カードなし'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {['青コン', '茶コン', '房総青コン', '農業総研専用折りたたみコンテナ', '緑コン'].map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setContainerType(ct)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-bold border transition-all',
                        containerType === ct
                          ? 'border-forest-700 bg-forest-700 text-white shadow-2xs'
                          : 'border-line bg-bg-card text-ink hover:bg-bg-soft',
                      )}
                    >
                      {ct === '農業総研専用折りたたみコンテナ' ? 'NSK専用オリコン' : ct}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-xs font-bold text-ink-muted shrink-0">規格表記:</span>
                  <input
                    type="text"
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                    placeholder="例: 200gUP (入数24) / 200g (入数24) / 2〜3株 (入数20)"
                    className="w-full h-8 rounded-lg border border-line bg-bg-card px-2.5 text-xs font-bold text-ink focus:border-forest-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* 現場メモ */}
              <div>
                <label className="text-xs font-black text-ink">現場メモ・備考（任意 ※単価・買値は現場非表示）</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例: 内訳 ライフ近畿40箱 / サンプラザ20箱、電話口頭受付など"
                  className="mt-1 w-full rounded-xl border border-line bg-bg-card p-2.5 text-xs text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:outline-none"
                />
              </div>
              </div>
              )}
            </div>
          </div>
        )}

        {/* 📄 下からせり出すアクションシート（カメラ・メディア・ファイル・テキスト） */}
        {actionSheetOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setActionSheetOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-t-3xl bg-bg-card p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <div>
                  <h3 className="text-base font-black text-ink">注文の読み込み・取り込み</h3>
                  <p className="text-xs text-ink-muted">取り込み方法を以下から選択してください</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActionSheetOpen(false)}
                  className="p-2 rounded-full text-ink-muted hover:bg-bg-soft"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-bg-card hover:bg-harvest-50/50 hover:border-harvest-400 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-harvest-100 text-forest-800 flex items-center justify-center shrink-0">
                    <Camera className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📷 カメラで撮影</div>
                    <div className="text-xs text-ink-muted mt-0.5">FAX用紙や手書き伝票をその場で撮影して即解析</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    galleryInputRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-bg-card hover:bg-trust-50/50 hover:border-trust-400 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-trust-100 text-trust-700 flex items-center justify-center shrink-0">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">🖼 写真・画像ライブラリから選択</div>
                    <div className="text-xs text-ink-muted mt-0.5">スマホの写真フォルダや撮影済みの画像を選択</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    fileSelectorRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-bg-card hover:bg-grape-50/50 hover:border-grape-200 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-grape-100 text-grape-700 flex items-center justify-center shrink-0">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📁 ファイルを選択（PDF / Excel / CSV）</div>
                    <div className="text-xs text-ink-muted mt-0.5">電子FAX（PDF）、発注Excel表（.xlsx / .xls）、CSVデータ</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    const area = document.getElementById('shipment-natural-text-area')
                    area?.focus()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-bg-card hover:bg-warning-bg/50 hover:border-warning transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-warning-bg text-ink flex items-center justify-center shrink-0">
                    <Clipboard className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📋 テキスト貼付・手入力</div>
                    <div className="text-xs text-ink-muted mt-0.5">LINEやメールの注文指示文をそのまま貼り付けて解析</div>
                  </div>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActionSheetOpen(false)}
                className="w-full py-3 rounded-xl border border-line bg-bg-soft text-ink font-bold text-sm hover:bg-line"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </FormShell>
    </>
  )
}
