'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShieldCheck, AlertCircle, AlertTriangle, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { PromptEditor } from '@/components/admin/PromptEditor'
import {
  SECTION_LABELS,
  SECTION_DESCRIPTIONS,
  SECTION_ORDER,
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  LAYER_ORDER,
  type SettingSection,
  type SettingLayer,
  type SettingKind,
} from '@/lib/settings-spec'

export interface SettingItem {
  key: string
  label: string
  section: SettingSection
  layer: SettingLayer
  secret: boolean
  kind: SettingKind
  placeholder?: string
  hint?: string
  toggleDefault?: 'on' | 'off'
  options?: { value: string; label: string }[]
  selectDefault?: string
  defaultPrompt?: string
  isSet: boolean
  /** 非秘密のみ現在値を持つ。秘密は常に undefined（書き込み専用）。 */
  value?: string
  dependsOn?: { key: string; equals: string }
  danger?: boolean
  status?: 'active' | 'planned'
}

/** 折りたたみで開始するレイヤー（構築時のみ触る接続情報・移行専用項目）。 */
const COLLAPSED_BY_DEFAULT: SettingLayer[] = ['infra', 'migration']

/**
 * 設定フォーム（設定画面）。
 * 秘密情報は現在値を表示せず「設定済み/未設定」バッジ＋書き込み専用入力（空＝据え置き）。
 * 非秘密は現在値を編集できる。保存で /api/settings に一括 PUT。
 */
export function SettingsForm({ items }: { items: SettingItem[] }) {
  const router = useRouter()
  // kind==='prompt' は PromptEditor が独立して保存するのでグローバル save から除外。
  const nonPromptItems = items.filter((i) => i.kind !== 'prompt')

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const it of nonPromptItems) {
      v[it.key] = it.secret
        ? ''
        : it.kind === 'toggle'
          ? it.value ?? it.toggleDefault ?? 'on'
          : it.kind === 'select'
            ? it.value || it.selectDefault || it.options?.[0]?.value || ''
            : it.value ?? ''
    }
    return v
  })
  const [saving, setSaving] = useState(false)
  const [showPlanned, setShowPlanned] = useState(false)

  const set = (k: string, val: string) => setValues((p) => ({ ...p, [k]: val }))

  const isVisible = (it: SettingItem) => {
    if (it.status === 'planned' && !showPlanned) return false
    if (it.dependsOn && values[it.dependsOn.key] !== it.dependsOn.equals) return false
    return true
  }

  async function save() {
    setSaving(true)
    try {
      const entries = nonPromptItems.map((it) => ({ key: it.key, value: values[it.key] ?? '' }))
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      const j = (await res.json()) as { updated: number }
      toast.success(`${j.updated}件の設定を保存しました`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  function renderItem(it: SettingItem) {
    // プロンプト設定は独自エディタで描画（グローバル保存から除外）
    if (it.kind === 'prompt') {
      return (
        <div key={it.key} className="rounded border border-line bg-bg-soft px-4 py-4">
          <PromptEditor
            settingKey={it.key}
            label={it.label}
            hint={it.hint}
            currentValue={it.value ?? ''}
            defaultPrompt={it.defaultPrompt ?? ''}
            onSaved={router.refresh}
          />
        </div>
      )
    }

    return (
      <div key={it.key} className={cn('space-y-1.5', it.danger && 'border-l-2 border-warning/60 pl-3')}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`set-${it.key}`} className="text-sm font-medium text-ink">
            {it.label}
          </label>
          {it.danger && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              挙動が変わります
            </span>
          )}
          {it.status === 'planned' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-faint">
              準備中（未実装）
            </span>
          )}
          {it.secret &&
            (it.isSet ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-harvest-50 px-2 py-0.5 text-xs font-medium text-harvest-700">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                設定済み
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
                <AlertCircle className="h-3 w-3" aria-hidden />
                未設定
              </span>
            ))}
        </div>

        {it.kind === 'toggle' ? (
          <select
            id={`set-${it.key}`}
            value={values[it.key] ?? 'on'}
            onChange={(e) => set(it.key, e.target.value)}
            className={cn(inputCls, 'w-32')}
          >
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        ) : it.kind === 'select' ? (
          <select
            id={`set-${it.key}`}
            value={values[it.key] ?? it.selectDefault ?? ''}
            onChange={(e) => set(it.key, e.target.value)}
            className={cn(inputCls, 'sm:w-72')}
          >
            {(it.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : it.kind === 'textarea' ? (
          <textarea
            id={`set-${it.key}`}
            value={values[it.key] ?? ''}
            onChange={(e) => set(it.key, e.target.value)}
            placeholder={it.secret ? (it.isSet ? '••••（変更する場合のみ入力）' : it.placeholder) : it.placeholder}
            rows={3}
            className={cn(inputCls, 'h-auto py-2 font-mono text-xs')}
          />
        ) : (
          <input
            id={`set-${it.key}`}
            type="text"
            value={values[it.key] ?? ''}
            onChange={(e) => set(it.key, e.target.value)}
            placeholder={it.secret ? (it.isSet ? '••••（変更する場合のみ入力）' : it.placeholder) : it.placeholder}
            className={inputCls}
          />
        )}

        {it.hint && <p className="text-xs text-ink-faint">{it.hint}</p>}
      </div>
    )
  }

  function renderSections(layerItems: SettingItem[]) {
    const sectionsInLayer = SECTION_ORDER.filter((s) => layerItems.some((i) => i.section === s))
    return (
      <div className="space-y-6">
        {sectionsInLayer.map((section) => {
          const sectionItems = layerItems.filter((i) => i.section === section).filter(isVisible)
          if (!sectionItems.length) return null
          return (
            <div key={section} className="space-y-3">
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-ink">{SECTION_LABELS[section]}</h3>
                {SECTION_DESCRIPTIONS[section] && (
                  <p className="text-xs leading-relaxed text-ink-soft">{SECTION_DESCRIPTIONS[section]}</p>
                )}
              </div>
              <div className="space-y-6">{sectionItems.map(renderItem)}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {LAYER_ORDER.map((layer) => {
        const layerItems = items.filter((i) => i.layer === layer)
        if (!layerItems.length) return null
        if (!layerItems.some(isVisible)) return null

        const body = renderSections(layerItems)

        if (COLLAPSED_BY_DEFAULT.includes(layer)) {
          return (
            <details key={layer} className="group rounded-lg border border-line bg-bg-soft/50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
                <div>
                  <span className="font-display text-base font-bold text-ink">{LAYER_LABELS[layer]}</span>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{LAYER_DESCRIPTIONS[layer]}</p>
                </div>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-line px-4 py-4">{body}</div>
            </details>
          )
        }

        return (
          <div key={layer} className="space-y-4">
            <div className="space-y-1">
              <h2 className="font-display text-lg font-bold text-ink">{LAYER_LABELS[layer]}</h2>
              <p className="text-xs leading-relaxed text-ink-soft">{LAYER_DESCRIPTIONS[layer]}</p>
            </div>
            {body}
          </div>
        )
      })}

      <label className="flex items-center gap-2 text-xs text-ink-faint">
        <input
          type="checkbox"
          checked={showPlanned}
          onChange={(e) => setShowPlanned(e.target.checked)}
          className="h-4 w-4 accent-earth-600"
        />
        準備中の機能も表示する（LINE WORKSボット等・現時点では動作しません）
      </label>

      <div className="sticky bottom-0 flex justify-end border-t border-line bg-bg/80 py-3 backdrop-blur">
        <Button onClick={save} isLoading={saving} size="lg">
          <Check className="h-4 w-4" aria-hidden />
          設定を保存
        </Button>
      </div>
    </div>
  )
}
