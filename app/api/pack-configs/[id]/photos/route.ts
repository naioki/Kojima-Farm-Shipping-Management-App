import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const BUCKET = 'pack-photos'
const MAX_PHOTOS = 4
const MAX_BYTES = 4 * 1024 * 1024 // クライアント縮小後（長辺1280・JPEG0.75）を十分にカバー
const uuidRe = /^[0-9a-f-]{36}$/i

/**
 * 荷姿の作業写真（完成見本/注意点）。最大4枚/荷姿。
 * アップロード前提: クライアント側で縮小・JPEG圧縮済み（無料枠運用のため）。
 * GET:  荷姿の写真一覧（{id, kind, sort_order}）。画像は /api/pack-photos/[id] で署名URL閲覧。
 * POST: multipart/form-data（file, kind）→ Storage 保存 + pack_config_photos に登録。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!uuidRe.test(params.id)) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase
    .from('pack_config_photos')
    .select('id, kind, sort_order')
    .eq('pack_config_id', params.id)
    .order('sort_order')
    .order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photos: data ?? [] })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!uuidRe.test(params.id)) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者のみ操作できます' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  const kind = String(form.get('kind') ?? 'finish')
  const file = form.get('file')
  if (kind !== 'finish' && kind !== 'caution') return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'file_required' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'not_image' }, { status: 400 })

  // 荷姿の存在確認と枚数上限
  const { data: pack, error: packErr } = await supabase.from('pack_configs').select('id').eq('id', params.id).maybeSingle()
  if (packErr) return NextResponse.json({ error: packErr.message }, { status: 500 })
  if (!pack) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { count, error: cntErr } = await supabase
    .from('pack_config_photos')
    .select('id', { count: 'exact', head: true })
    .eq('pack_config_id', params.id)
  if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 })
  if ((count ?? 0) >= MAX_PHOTOS) return NextResponse.json({ error: 'too_many_photos' }, { status: 400 })

  const admin = createAdminClient()
  const key = `${params.id}/${crypto.randomUUID()}.jpg`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage.from(BUCKET).upload(key, bytes, { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: row, error: insErr } = await supabase
    .from('pack_config_photos')
    .insert({ pack_config_id: params.id, storage_path: key, kind, sort_order: count ?? 0 })
    .select('id, kind, sort_order')
    .single()
  if (insErr || !row) {
    // 行の作成に失敗したら Storage を掃除（孤児防止）
    await admin.storage.from(BUCKET).remove([key])
    return NextResponse.json({ error: insErr?.message ?? '登録に失敗しました' }, { status: 500 })
  }
  return NextResponse.json({ photo: row })
}
