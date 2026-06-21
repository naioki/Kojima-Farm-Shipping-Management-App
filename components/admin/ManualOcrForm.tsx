'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, FileText, Upload, Sparkles, X, ChevronDown, ChevronUp, AlertTriangle, Save, FileType } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { downscaleImage } from '@/lib/image/downscale'

const SAVE_PHRASE = '変更を理解しました'
const MAX_FILE_MB = 10

interface ParsedItem {
  raw_name: string
  product_name: string | null
  quantity: string
  unit: string | null
  confidence: number
}

interface ManualOcrFormProps {
  /** 現在保存されている解析プロンプト（設定 GEMINI_PROMPT_NORMAL）。空ならデフォルト。 */
  currentPrompt: string
  /** コード埋め込みのデフォルトプロンプト。 */
  defaultPrompt: string
  /** プロンプトを開いて編集できるか（スタッフは false ＝既定プロンプトで読むだけ）。 */
  allowPromptEdit?: boolean
  /** 既定プロンプトとして恒久保存できるか（管理者のみ true）。 */
  allowPromptSave?: boolean
}

type Mode = 'image' | 'text'

/**
 * 手動OCR入力フォーム。
 * FAX画像・スキャン・PDF・メール本文を AI に読ませ、明細を確認する（プレビュー、DB保存なし）。
 * 管理者: プロンプトを「この解析だけ」編集可＋既定として保存可（フレーズ確認）。
 * スタッフ: 既定プロンプトで読むだけ（編集・保存は不可）。
 */
export function ManualOcrForm({
  currentPrompt,
  defaultPrompt,
  allowPromptEdit = true,
  allowPromptSave = true,
}: ManualOcrFormProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('image')
  const [text, setText] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const [mimeType, setMimeType] = useState<string>('image/png')
  const [fileName, setFileName] = useState<string>('')

  const basePrompt = currentPrompt || defaultPrompt
  const [prompt, setPrompt] = useState(basePrompt)
  const [promptOpen, setPromptOpen] = useState(false)

  const [analyzing, setAnalyzing] = useState(false)
  const [items, setItems] = useState<ParsedItem[] | null>(null)

  const [confirmCustomOpen, setConfirmCustomOpen] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [savePhrase, setSavePhrase] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const isCustomPrompt = prompt.trim() !== basePrompt.trim()
  const canAnalyze = (mode === 'image' ? Boolean(imageBase64) : text.trim() !== '') && !analyzing

  async function handleFile(file: File) {
    const pdf = file.type === 'application/pdf'
    if (!file.type.startsWith('image/') && !pdf) {
      toast.error('画像（JPEG/PNG等）またはPDFを選択してください')
      return
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`ファイルは${MAX_FILE_MB}MB以下にしてください`)
      return
    }
    setFileName(file.name)
    setIsPdf(pdf)

    if (pdf) {
      // PDF は縮小できないのでそのまま base64 化（プレビューはファイルカードで代替）
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setImageBase64(dataUrl.slice(dataUrl.indexOf(',') + 1))
        setMimeType(file.type)
        setImagePreview(null)
      }
      reader.readAsDataURL(file)
      return
    }

    // 画像は送信前にブラウザで縮小＋JPEG圧縮（Cloud Run 負荷・Gemini トークン課金を削減）
    try {
      const img = await downscaleImage(file)
      setImageBase64(img.base64)
      setMimeType(img.mimeType)
      setImagePreview(img.dataUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '画像の処理に失敗しました')
    }
  }

  function clearImage() {
    setImageBase64(null)
    setImagePreview(null)
    setIsPdf(false)
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function runAnalyze() {
    setAnalyzing(true)
    setItems(null)
    try {
      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: mode === 'image' ? imageBase64 : undefined,
          mimeType: mode === 'image' ? mimeType : undefined,
          text: mode === 'text' ? text : undefined,
          promptOverride: isCustomPrompt ? prompt : undefined,
        }),
      })
      const json = (await res.json()) as { items?: ParsedItem[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `解析失敗 (${res.status})`)
      setItems(json.items ?? [])
      toast.success(`${json.items?.length ?? 0}件の明細を読み取りました`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '解析に失敗しました')
    } finally {
      setAnalyzing(false)
    }
  }

  /** 実行ボタン：カスタムプロンプトなら確認を挟む。 */
  function onAnalyzeClick() {
    if (isCustomPrompt) {
      setConfirmCustomOpen(true)
    } else {
      void runAnalyze()
    }
  }

  /** 現在のプロンプトを「既定」として保存（確認フレーズ必須）。 */
  async function savePromptAsDefault() {
    if (savePhrase.trim() !== SAVE_PHRASE) return
    setSavingPrompt(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: [{ key: 'GEMINI_PROMPT_NORMAL', value: prompt }] }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存失敗 (${res.status})`)
      }
      toast.success('既定プロンプトとして保存しました')
      setSaveModalOpen(false)
      setSavePhrase('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingPrompt(false)
    }
  }

  const fieldCls =
    'w-full rounded border border-line-strong bg-bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-5">
      {/* 入力モード切替 */}
      <div className="inline-flex rounded-lg border border-line bg-bg-soft p-1">
        <button
          type="button"
          onClick={() => setMode('image')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === 'image' ? 'bg-bg-card text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
          )}
        >
          <ImageIcon className="h-4 w-4" aria-hidden />
          画像・PDF（FAX/スキャン）
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            mode === 'text' ? 'bg-bg-card text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
          )}
        >
          <FileText className="h-4 w-4" aria-hidden />
          テキスト（メール本文）
        </button>
      </div>

      {/* 入力エリア */}
      {mode === 'image' ? (
        <div>
          {imageBase64 ? (
            isPdf ? (
              <div className="relative flex items-center gap-3 rounded-lg border border-line bg-bg-soft px-4 py-4">
                <div className="rounded-lg bg-alert/10 p-3">
                  <FileType className="h-7 w-7 text-alert" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{fileName}</p>
                  <p className="text-xs text-ink-faint">PDF — AIが全ページを読み取ります</p>
                </div>
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="PDFを削除"
                  className="absolute -right-2 -top-2 rounded-full bg-alert p-1 text-white shadow-md hover:bg-alert/90"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview!}
                  alt={fileName}
                  className="max-h-80 rounded-lg border border-line"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="画像を削除"
                  className="absolute -right-2 -top-2 rounded-full bg-alert p-1 text-white shadow-md hover:bg-alert/90"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <p className="mt-1 text-xs text-ink-faint">{fileName}</p>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line py-12 text-ink-soft transition-colors hover:border-earth-400 hover:bg-bg-soft"
            >
              <Upload className="h-8 w-8" aria-hidden />
              <span className="text-sm font-medium">クリックして画像・PDFを選択</span>
              <span className="text-xs text-ink-faint">FAX・スキャン（{MAX_FILE_MB}MBまで・JPEG/PNG/PDF）</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="メール本文や、転記した注文テキストを貼り付けてください"
          className={cn(fieldCls, 'font-mono')}
        />
      )}

      {/* プロンプト（折りたたみ・管理者のみ） */}
      {allowPromptEdit && (
      <div className="rounded-lg border border-line">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkles className="h-4 w-4 text-earth-500" aria-hidden />
            解析プロンプト
            {isCustomPrompt ? (
              <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                カスタム（この解析のみ）
              </span>
            ) : (
              <span className="rounded-full bg-bg-soft px-2 py-0.5 text-xs text-ink-soft">既定を使用中</span>
            )}
          </span>
          {promptOpen ? <ChevronUp className="h-4 w-4 text-ink-faint" /> : <ChevronDown className="h-4 w-4 text-ink-faint" />}
        </button>
        {promptOpen && (
          <div className="space-y-3 border-t border-line px-4 py-3">
            <p className="text-xs text-ink-soft">
              ここでの変更は<strong className="text-ink">この解析だけ</strong>に使われ、設定は変わりません。
              恒久的に変える場合は下の「既定として保存」（確認あり）を使ってください。
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              spellCheck={false}
              className={cn(fieldCls, 'font-mono text-xs')}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPrompt(basePrompt)} disabled={!isCustomPrompt}>
                既定に戻す
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPrompt(defaultPrompt)} disabled={prompt.trim() === defaultPrompt.trim()}>
                初期値に戻す
              </Button>
              {allowPromptSave && (
                <Button variant="primary" size="sm" onClick={() => setSaveModalOpen(true)} disabled={!isCustomPrompt}>
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  既定として保存
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* 実行 */}
      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={onAnalyzeClick} disabled={!canAnalyze} isLoading={analyzing}>
          <Sparkles className="h-4 w-4" aria-hidden />
          AIで読み取る
        </Button>
      </div>

      {/* 結果 */}
      {items && (
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold text-ink">読み取り結果（{items.length}件）</h2>
          {items.length === 0 ? (
            <p className="rounded-lg border border-line bg-bg-soft px-4 py-6 text-center text-sm text-ink-soft">
              明細を検出できませんでした。画像の向き・解像度を確認するか、プロンプトを調整してください。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-xs text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">読取り原文</th>
                    <th className="px-3 py-2 text-left font-medium">商品名</th>
                    <th className="px-3 py-2 text-right font-medium">数量</th>
                    <th className="px-3 py-2 text-left font-medium">単位</th>
                    <th className="px-3 py-2 text-right font-medium">確信度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((it, i) => {
                    const low = it.confidence < 0.7
                    return (
                      <tr key={i} className={cn(low && 'bg-alert-bg/40')}>
                        <td className="px-3 py-2 text-ink-soft">{it.raw_name}</td>
                        <td className="px-3 py-2 font-medium text-ink">{it.product_name ?? '—'}</td>
                        <td className="num px-3 py-2 text-right font-bold tabular-nums text-ink">{it.quantity}</td>
                        <td className="px-3 py-2 text-ink-soft">{it.unit ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={cn('num inline-flex items-center gap-1 tabular-nums', low ? 'text-alert' : 'text-harvest-600')}>
                            {low && <AlertTriangle className="h-3 w-3" aria-hidden />}
                            {Math.round(it.confidence * 100)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-faint">
            ※ これはプレビューです（DBには保存されません）。<span className="text-alert">赤＝確信度70%未満</span>は要確認です。
          </p>
        </div>
      )}

      {/* カスタムプロンプト実行の確認 */}
      <ConfirmModal
        open={confirmCustomOpen}
        onClose={() => setConfirmCustomOpen(false)}
        onConfirm={() => {
          setConfirmCustomOpen(false)
          void runAnalyze()
        }}
        title="カスタムプロンプトで解析"
        message="既定とは違うプロンプトでこの解析を実行します（設定は変わりません）。よろしいですか？"
        confirmLabel="この内容で解析"
        danger={false}
        isLoading={analyzing}
      />

      {/* 既定として保存（フレーズ確認） */}
      {saveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.target === e.currentTarget && setSaveModalOpen(false)}
        >
          <div className="w-full max-w-md rounded-lg border border-line-strong bg-bg-card shadow-xl">
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-alert" aria-hidden />
              <div>
                <h2 className="font-display text-base font-bold text-ink">既定プロンプトを変更</h2>
                <p className="mt-0.5 text-xs text-ink-soft">
                  以後のFAX/メール自動解析すべてに影響します。誤った設定は受注の誤読・業務停止の原因になります。
                </p>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="text-xs font-medium text-ink">
                続けるには{' '}
                <code className="rounded bg-bg-soft px-1 py-0.5 font-mono text-alert">{SAVE_PHRASE}</code>{' '}
                と入力してください
              </label>
              <input
                type="text"
                value={savePhrase}
                onChange={(e) => setSavePhrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePhrase.trim() === SAVE_PHRASE && void savePromptAsDefault()}
                placeholder={SAVE_PHRASE}
                autoComplete="off"
                className={cn(
                  fieldCls,
                  savePhrase.trim() === SAVE_PHRASE && 'border-harvest-400 bg-harvest-50',
                )}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => { setSaveModalOpen(false); setSavePhrase('') }}>
                キャンセル
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={savePhrase.trim() !== SAVE_PHRASE}
                isLoading={savingPrompt}
                onClick={savePromptAsDefault}
              >
                既定として保存する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
