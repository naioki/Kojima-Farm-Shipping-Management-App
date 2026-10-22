import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMultiChannelAlert } from '@/lib/notifications/multi-channel'

export const runtime = 'nodejs'

export interface FeedbackReport {
  id: string
  created_at: string
  created_by_name?: string
  status: 'pending' | 'in_progress' | 'resolved' | 'archived'
  admin_note?: string
  when?: string
  where?: string
  who?: string
  what: string
  why?: string
  how?: string
}

const SETTING_KEY = 'v5_feedback_reports'

/**
 * 5W1H改善要望・バグ報告の保存・取得・ステータス更新API。
 * 未適用環境やRLS制限を安全に回避するため app_settings JSON ストアを活用。
 */
export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: setting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()

  let reports: FeedbackReport[] = []
  if (setting?.value) {
    try {
      reports = JSON.parse(setting.value)
    } catch {
      reports = []
    }
  }

  // 新しい順にソート
  reports.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json({ ok: true, reports })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const what = typeof body.what === 'string' ? body.what.trim() : ''
  if (!what) {
    return NextResponse.json({ error: '「なにが起きたか・改善したいこと」は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 投稿者名の取得
  const { data: profile } = await admin
    .from('users')
    .select('email, raw_user_meta_data')
    .eq('id', user.id)
    .maybeSingle()
  const userName =
    (profile?.raw_user_meta_data as { full_name?: string })?.full_name ||
    profile?.email?.split('@')[0] ||
    '現場スタッフ'

  // 現在のレポートリストを取得
  const { data: setting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()

  let reports: FeedbackReport[] = []
  if (setting?.value) {
    try {
      reports = JSON.parse(setting.value)
    } catch {
      reports = []
    }
  }

  const newReport: FeedbackReport = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    created_by_name: userName,
    status: 'pending',
    when: typeof body.when === 'string' ? body.when.trim() || undefined : undefined,
    where: typeof body.where === 'string' ? body.where.trim() || undefined : undefined,
    who: typeof body.who === 'string' ? body.who.trim() || undefined : undefined,
    what,
    why: typeof body.why === 'string' ? body.why.trim() || undefined : undefined,
    how: typeof body.how === 'string' ? body.how.trim() || undefined : undefined,
  }

  reports.unshift(newReport)

  // app_settings にアトミック保存
  const payloadValue = JSON.stringify(reports)
  await admin.from('app_settings').upsert({
    key: SETTING_KEY,
    value: payloadValue,
    is_secret: false,
    updated_at: new Date().toISOString(),
  })

  // 管理者へ通知（LINE / Discord）
  sendMultiChannelAlert({
    title: '💬【現場からの改善要望・バグ報告】',
    message: `【投稿者】${userName}\n【内容(What)】${what}${newReport.where ? `\n【場所】${newReport.where}` : ''}${newReport.when ? `\n【いつ】${newReport.when}` : ''}`,
    urgent: false,
    url: '/admin/settings',
  }).catch((err) => console.warn('[feedback] 通知スキップ:', err))

  return NextResponse.json({ ok: true, report: newReport }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'IDが必要です' }, { status: 400 })

  const admin = createAdminClient()
  const { data: setting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()

  let reports: FeedbackReport[] = []
  if (setting?.value) {
    try {
      reports = JSON.parse(setting.value)
    } catch {
      reports = []
    }
  }

  const target = reports.find((r) => r.id === id)
  if (!target) {
    return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 })
  }

  if (body.status && ['pending', 'in_progress', 'resolved', 'archived'].includes(body.status)) {
    target.status = body.status
  }
  if (typeof body.admin_note === 'string') {
    target.admin_note = body.admin_note.trim()
  }

  const payloadValue = JSON.stringify(reports)
  await admin.from('app_settings').upsert({
    key: SETTING_KEY,
    value: payloadValue,
    is_secret: false,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, report: target })
}
