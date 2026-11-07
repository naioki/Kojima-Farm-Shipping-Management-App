import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * メニューの未処理件数（href → 件数）。メニューの表示のために画面を壊してはいけないので、
 * 取得に失敗したらバッジなし（空）で返し、ログだけ残す。
 */
export async function getNavBadges(role: 'admin' | 'staff'): Promise<Record<string, number>> {
  try {
    const supabase = createAdminClient()
    const pending = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review')
    if (pending.error) throw new Error(pending.error.message)
    const badges: Record<string, number> = {
      '/admin/approvals': pending.count ?? 0,
      '/field/approvals': pending.count ?? 0,
    }
    if (role === 'admin') {
      const failed = await supabase
        .from('order_receipts')
        .select('id', { count: 'exact', head: true })
        .in('status', ['ai_failed', 'unmatched'])
      if (failed.error) throw new Error(failed.error.message)
      badges['/admin/inbox'] = failed.count ?? 0
      // 現場からの規格報告（未対応）。取得できなくてもほかのバッジは出す
      const specs = await supabase
        .from('spec_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (!specs.error) badges['/admin/spec-reports'] = specs.count ?? 0
    }
    return badges
  } catch (e) {
    console.error('[nav/badges] 件数の取得に失敗:', e instanceof Error ? e.message : e)
    return {}
  }
}
