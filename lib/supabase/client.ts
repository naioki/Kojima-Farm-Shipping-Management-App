'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

/**
 * ブラウザ（Client Component）用 Supabase クライアント。
 * anon キーのみ使用。RLS によりユーザー権限の範囲しか触れない（security.md）。
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
