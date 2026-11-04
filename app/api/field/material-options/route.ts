import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting, invalidateSettingsCache } from '@/lib/settings'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const MATERIAL_OPTIONS_KEY = 'v5_field_material_options'

export interface FieldMaterialOptions {
  containers: string[]
  bags: string[]
}

const DEFAULT_OPTIONS: FieldMaterialOptions = {
  containers: [],
  bags: [],
}

function parseMaterialOptions(raw: string | null): FieldMaterialOptions {
  if (!raw) return DEFAULT_OPTIONS
  try {
    const parsed = JSON.parse(raw) as Partial<FieldMaterialOptions>
    return {
      containers: Array.isArray(parsed.containers)
        ? parsed.containers.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [],
      bags: Array.isArray(parsed.bags)
        ? parsed.bags.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [],
    }
  } catch {
    return DEFAULT_OPTIONS
  }
}

async function saveMaterialOptions(options: FieldMaterialOptions, userId: string) {
  const admin = createAdminClient()
  await admin.from('app_settings').upsert(
    {
      key: MATERIAL_OPTIONS_KEY,
      value: JSON.stringify(options),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  invalidateSettingsCache()
}

export async function GET() {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const raw = await getSetting(MATERIAL_OPTIONS_KEY)
  return NextResponse.json(parseMaterialOptions(raw))
}

export async function POST(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const body = (await req.json().catch(() => null)) as {
    category?: 'container' | 'bag'
    value?: string
  } | null
  const category = body?.category
  const value = (body?.value ?? '').trim()

  if ((category !== 'container' && category !== 'bag') || !value || value.length > 40) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  const current = parseMaterialOptions(await getSetting(MATERIAL_OPTIONS_KEY))
  if (category === 'container') {
    if (!current.containers.includes(value)) {
      current.containers.push(value)
    }
  } else {
    if (!current.bags.includes(value)) {
      current.bags.push(value)
    }
  }

  await saveMaterialOptions(current, user.id)
  return NextResponse.json(current)
}

export async function DELETE(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const body = (await req.json().catch(() => null)) as {
    category?: 'container' | 'bag'
    value?: string
  } | null
  const category = body?.category
  const value = (body?.value ?? '').trim()

  if ((category !== 'container' && category !== 'bag') || !value) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  const current = parseMaterialOptions(await getSetting(MATERIAL_OPTIONS_KEY))
  if (category === 'container') {
    current.containers = current.containers.filter((v) => v !== value)
  } else {
    current.bags = current.bags.filter((v) => v !== value)
  }

  await saveMaterialOptions(current, user.id)
  return NextResponse.json(current)
}
