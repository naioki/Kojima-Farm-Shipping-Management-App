'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { MailCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

/**
 * B2Bポータルの Magic Link ログイン（features.md §2-3：パスワードレス）。
 * メールにリンクを送り、/auth/callback で session 交換 → /portal/order へ。
 * メール = customers.channel_identifiers.email と Supabase Auth 側で紐付け前提。
 */
export function PortalLoginForm() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const supabase = createClient()
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/portal/order`
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })
      if (error) throw new Error(error.message)
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <Card variant="elevated" className="w-full max-w-sm space-y-3 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-harvest-600" aria-hidden />
        <h1 className="font-display text-xl font-bold text-ink">メールを確認してください</h1>
        <p className="text-sm text-ink-soft">
          {email} 宛にログイン用リンクを送りました。リンクを開くと発注画面に進みます。
        </p>
      </Card>
    )
  }

  return (
    <Card variant="elevated" className="w-full max-w-sm space-y-5">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-earth-700">発注ポータル</h1>
        <p className="mt-1 text-sm text-ink-soft">ご登録のメールアドレスでログイン</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Input
          type="email"
          label="メールアドレス"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" size="lg" className="w-full" isLoading={submitting} disabled={submitting}>
          ログインリンクを送る
        </Button>
      </form>
    </Card>
  )
}
