import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const BUCKET = 'pack-photos'
const uuidRe = /^[0-9a-f-]{36}$/i

/**
 * 荷姿の作業写真1枚。GET=署名URLへリダイレクト（<img src> で使える）、DELETE=削除（管理者）。
 * バケットは非公開。閲覧は必ず署名URL経由（0015 deliveries と同方針）。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!uuidRe.test(params.id)) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })

  const supabase = createClient()
  const { data: row, error } = await supabase.from('pack_config_photos').select('storage_path').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 900)
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!uuidRe.test(params.id)) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者のみ操作できます' }, { status: 403 })

  const { data: row, error: findErr } = await supabase.from('pack_config_photos').select('storage_path').eq('id', params.id).maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: delErr } = await supabase.from('pack_config_photos').delete().eq('id', params.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  // Storage 実体も削除（失敗しても行は消えているのでレスポンスは成功扱い）
  await createAdminClient().storage.from(BUCKET).remove([row.storage_path])
  return NextResponse.json({ ok: true })
}
