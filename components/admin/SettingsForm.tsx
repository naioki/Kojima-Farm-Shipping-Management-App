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
  COLLAPSED_SECTIONS,
  type SettingSection,
  type SettingKind,
} from '@/lib/settings-spec'

export interface SettingItem {
  key: string
  label: string
  section: SettingSection
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
}

/**
 * 設定フォーム（大文字・高視認性デザイン）。
 * - 秘密情報は現在値を表示せず「設定済み/未設定」バッジ＋書き込み専用入力（空＝据え置き）。
 * - `kind === 'text'` かつ `options` がある項目（例: `GEMINI_MODEL`）は、自由入力＋ワンクリック候補チップ。
 * - 高度な設定（プロンプト・内部シークレット等）は折りたたみで画面をすっきり整理。
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

  const set = (k: string, val: string) => setValues((p) => ({ ...p, [k]: val }))

  const isVisible = (it: SettingItem) => {
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
    'h-12 w-full rounded-xl border border-line-strong bg-bg-card px-3.5 text-base text-ink focus:outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-100'

  function renderItem(it: SettingItem) {
    // プロンプト設定は独自エディタで描画（グローバル保存から除外）
    if (it.kind === 'prompt') {
      return (
        <div key={it.key} className="rounded-xl border border-line bg-bg-soft px-4 py-4">
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

    const hasSuggestions = it.kind === 'text' && (it.options?.length ?? 0) > 0
    const datalistId = hasSuggestions ? `datalist-${it.key}` : undefined

    return (
      <div key={it.key} className={cn('space-y-2', it.danger && 'border-l-4 border-warning/80 pl-3.5 py-0.5')}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`set-${it.key}`} className="text-base font-bold text-ink">
            {it.label}
          </label>
          {it.danger && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-bold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              動作注意
            </span>
          )}
          {it.secret &&
            (it.isSet ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                設定済み
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-300 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                <AlertCircle className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                未設定
              </span>
            ))}
        </div>

        {it.kind === 'toggle' ? (
          (() => {
            const on = (values[it.key] ?? 'on') !== 'off'
            return (
              <button
                id={`set-${it.key}`}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => set(it.key, on ? 'off' : 'on')}
                className="inline-flex min-h-[44px] items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-300 focus:ring-offset-2"
              >
                <span
                  className={cn(
                    'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
                    on ? 'bg-forest-600' : 'bg-slate-300 dark:bg-slate-600',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                      on ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </span>
                <span className={cn('text-base font-bold', on ? 'text-forest-800' : 'text-ink-soft')}>
                  {on ? 'オン' : 'オフ'}
                </span>
              </button>
            )
          })()
        ) : it.kind === 'select' ? (
          <select
            id={`set-${it.key}`}
            value={values[it.key] ?? it.selectDefault ?? ''}
            onChange={(e) => set(it.key, e.target.value)}
            className={cn(inputCls, 'sm:w-80 font-bold text-base')}
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
            className={cn(inputCls, 'h-auto py-3 font-mono text-sm leading-relaxed')}
          />
        ) : (
          <div className="space-y-2">
            <input
              id={`set-${it.key}`}
              list={datalistId}
              type="text"
              value={values[it.key] ?? ''}
              onChange={(e) => set(it.key, e.target.value)}
              placeholder={it.secret ? (it.isSet ? '••••（変更する場合のみ入力）' : it.placeholder) : it.placeholder}
              className={cn(inputCls, hasSuggestions && 'font-mono')}
            />
            {datalistId && (
              <>
                <datalist id={datalistId}>
                  {it.options!.filter((o) => o.value !== '').map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </datalist>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-xs font-bold text-ink-soft">クイック選択:</span>
                  {it.options!.map((o) => {
                    const currentVal = (values[it.key] ?? '').trim()
                    const active = currentVal === o.value
                    return (
                      <button
                        key={o.value || '__auto__'}
                        type="button"
                        onClick={() => set(it.key, o.value)}
                        className={cn(
                          'rounded-full border px-3 py-1 font-mono text-xs font-bold transition-colors active:scale-95',
                          active
                            ? 'border-forest-600 bg-forest-600 text-white'
                            : 'border-line bg-bg-soft text-ink-soft hover:border-forest-400 hover:bg-forest-50 hover:text-ink',
                        )}
                      >
                        {o.value === '' ? '自動（フォールバック）' : o.value}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {it.hint && <p className="text-sm text-ink-soft leading-relaxed">{it.hint}</p>}
      </div>
    )
  }

  // 区分ごとの「要対応」件数（未入力の自社情報・未設定のキー）。目次と見出しに出して、どこを見ればよいか分かるようにする
  const pendingCount = (section: SettingSection) =>
    items.filter(
      (i) =>
        i.section === section &&
        ((i.secret && !i.isSet) || (section === 'issuer' && i.kind !== 'select' && !(values[i.key] ?? '').trim())),
    ).length
  const sections = SECTION_ORDER.filter((sec) => items.some((i) => i.section === sec))

  const sectionHeader = (section: SettingSection, small = false) => {
    const pending = pendingCount(section)
    return (
      <div>
        <h2 className={cn('flex flex-wrap items-center gap-2 font-display font-black text-ink', small ? 'text-base' : 'text-lg')}>
          {SECTION_LABELS[section]}
          {pending > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              未設定 {pending}件
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{SECTION_DESCRIPTIONS[section]}</p>
      </div>
    )
  }

  // セクションごとに描画
  return (
    <div className="space-y-6">
      {/* 目次: 区分へジャンプ。未設定がある区分は件数を表示 */}
      <nav aria-label="設定の区分" className="flex flex-wrap gap-2">
        {sections.map((section) => {
          const pending = pendingCount(section)
          return (
            <a
              key={section}
              href={`#settings-${section}`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-bg-card px-3 text-sm font-bold text-ink hover:bg-bg-soft focus:outline-none focus:ring-2 focus:ring-trust-500"
            >
              {SECTION_LABELS[section].replace(/（.*）$/, '')}
              {pending > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-900">{pending}</span>
              )}
            </a>
          )
        })}
      </nav>

      {sections.map((section) => {
        const sectionItems = items.filter((i) => i.section === section).filter(isVisible)
        if (!sectionItems.length) return null

        // ふだん触らない区分は畳む（未設定があっても見出しに件数が出る）
        if (COLLAPSED_SECTIONS.includes(section)) {
          return (
            <details
              key={section}
              id={`settings-${section}`}
              className="group scroll-mt-20 rounded-2xl border border-line bg-bg-soft/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl p-5 select-none hover:bg-bg-soft/80">
                {sectionHeader(section, true)}
                <ChevronDown
                  className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="space-y-6 rounded-b-2xl border-t border-line/80 bg-white p-5">
                {sectionItems.map(renderItem)}
              </div>
            </details>
          )
        }

        return (
          <section
            key={section}
            id={`settings-${section}`}
            className="scroll-mt-20 space-y-5 rounded-2xl border border-line/80 bg-white p-5 shadow-xs sm:p-6"
          >
            <div className="border-b border-line/60 pb-3">{sectionHeader(section)}</div>
            <div className="space-y-6 pt-1">{sectionItems.map(renderItem)}</div>
          </section>
        )
      })}

      {/* フローティング保存バー */}
      <div className="sticky bottom-0 z-10 flex justify-end rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur">
        <Button onClick={save} isLoading={saving} size="lg" className="h-12 px-8 text-base font-black">
          <Check className="h-5 w-5" aria-hidden />
          設定を保存する
        </Button>
      </div>
    </div>
  )
}
