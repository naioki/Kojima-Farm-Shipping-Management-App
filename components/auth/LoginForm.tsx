'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

/**
 * 社内（admin/staff）ログイン。email + password（security.md：getUser で検証）。
 * ログイン後はルート(/)へ。role に応じた遷移はサーバー側 app/page.tsx が行う。
 */
export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      router.refresh()
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ログインに失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card variant="elevated" className="w-full max-w-sm space-y-5">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-earth-700">小島農園</h1>
        <p className="mt-1 text-sm text-ink-soft">受注・圃場管理システム</p>
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
        <Input
          type="password"
          label="パスワード"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" size="lg" className="w-full" isLoading={submitting} disabled={submitting}>
          ログイン
        </Button>
      </form>
    </Card>
  )
}
