'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShieldCheck, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { SECTION_LABELS, SECTION_ORDER, type SettingSection, type SettingKind } from '@/lib/settings-spec'

export interface SettingItem {
  key: string
  label: string
  section: SettingSection
  secret: boolean
  kind: SettingKind
  placeholder?: string
  hint?: string
  toggleDefault?: 'on' | 'off'
  isSet: boolean
  /** 非秘密のみ現在値を持つ。秘密は常に undefined（書き込み専用）。 */
  value?: string
}

/**
 * 設定フォーム（設定画面）。
 * 秘密情報は現在値を表示せず「設定済み/未設定」バッジ＋書き込み専用入力（空＝据え置き）。
 * 非秘密は現在値を編集できる。保存で /api/settings に一括 PUT。
 */
export function SettingsForm({ items }: { items: SettingItem[] }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const it of items) {
      v[it.key] = it.secret ? '' : it.kind === 'toggle' ? it.value ?? it.toggleDefault ?? 'on' : it.value ?? ''
    }
    return v
  })
  const [saving, setSaving] = useState(false)

  const set = (k: string, val: string) => setValues((p) => ({ ...p, [k]: val }))

  async function save() {
    setSaving(true)
    try {
      const entries = items.map((it) => ({ key: it.key, value: values[it.key] ?? '' }))
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

  return (
    <div className="space-y-6">
      {SECTION_ORDER.map((section) => {
        const sectionItems = items.filter((i) => i.section === section)
        if (!sectionItems.length) return null
        return (
          <div key={section} className="space-y-3">
            <h2 className="font-display text-base font-bold text-ink">{SECTION_LABELS[section]}</h2>
            <div className="space-y-4">
              {sectionItems.map((it) => (
                <div key={it.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`set-${it.key}`} className="text-sm font-medium text-ink">
                      {it.label}
                    </label>
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
              ))}
            </div>
          </div>
        )
      })}

      <div className="sticky bottom-0 flex justify-end border-t border-line bg-bg/80 py-3 backdrop-blur">
        <Button onClick={save} isLoading={saving} size="lg">
          <Check className="h-4 w-4" aria-hidden />
          設定を保存
        </Button>
      </div>
    </div>
  )
}
