import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const BUCKET = 'deliveries'
const MAX_BYTES = 8 * 1024 * 1024 // スマホ写真1枚の上限（8MB）
const dateRe = /^\d{4}-\d{2}-\d{2}$/
const uuidRe = /^[0-9a-f-]{36}$/i

/**
 * 積込写真（配送 Phase 2）。配送単位に1枚、任意で残す（誤配送クレーム時の物証）。
 * POST: multipart/form-data（delivery_date, customer_id, destination_id?, file）
 *       → Supabase Storage に保存し deliveries.photo_url を更新、delivery_events に追記
 * GET:  ?id=<deliveryId> → 15分の署名URLへリダイレクト（認証済みのみ）
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const deliveryDate = String(form.get('delivery_date') ?? '')
  const customerId = String(form.get('customer_id') ?? '')
  const destinationId = String(form.get('destination_id') ?? '') || null
  const file = form.get('file')
  if (!dateRe.test(deliveryDate) || !uuidRe.test(customerId) || (destinationId && !uuidRe.test(destinationId))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'not_image' }, { status: 400 })

  const supabase = createClient()

  // 配送行を取得（チェック前でも写真は撮れるように、無ければ planned で作る）
  let query = supabase
    .from('deliveries')
    .select('id')
    .eq('delivery_date', deliveryDate)
    .eq('customer_id', customerId)
  query = destinationId ? query.eq('destination_id', destinationId) : query.is('destination_id', null)
  const { data: existing, error: findErr } = await query.maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  let deliveryId = existing?.id
  if (!deliveryId) {
    const { data: created, error: createErr } = await supabase
      .from('deliveries')
      .insert({ delivery_date: deliveryDate, customer_id: customerId, destination_id: destinationId })
      .select('id')
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    deliveryId = created.id
  }

  // Storage への保存は service_role（バケットは非公開。閲覧は GET の署名URL経由のみ）
  const key = `${deliveryDate}/${deliveryId}.jpg`
  const admin = createAdminClient()
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { error: updErr } = await supabase.from('deliveries').update({ photo_url: key }).eq('id', deliveryId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const { error: evErr } = await supabase.from('delivery_events').insert({
    delivery_id: deliveryId,
    actor: user.id,
    action: 'photo',
    before: null,
    after: { photo_url: key },
  })
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

  return NextResponse.json({ id: deliveryId, photo_url: key })
}

export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!uuidRe.test(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const supabase = createClient()
  const { data: row, error } = await supabase.from('deliveries').select('photo_url').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row?.photo_url) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(row.photo_url, 900)
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
