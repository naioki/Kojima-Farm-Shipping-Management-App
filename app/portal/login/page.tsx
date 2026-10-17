import { PortalLoginForm } from '@/components/auth/PortalLoginForm'

export const dynamic = 'force-dynamic'

/**
 * ポータルログイン（Magic Link）。portal レイアウト配下。
 * 既ログインの振り分けは /portal/order 側の認証ガードに任せる。
 */
export default function PortalLoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <PortalLoginForm />
    </div>
  )
}
