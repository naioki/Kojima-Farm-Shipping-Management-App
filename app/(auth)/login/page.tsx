import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { LoginForm } from '@/components/auth/LoginForm'

export const dynamic = 'force-dynamic'

/** 社内ログイン。既にログイン済みなら振り分けはルート(/)に任せる。 */
export default async function LoginPage() {
  const user = await getAuthedUser()
  if (user) redirect('/')

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-soft p-4 texture-paper">
      <LoginForm />
    </main>
  )
}
