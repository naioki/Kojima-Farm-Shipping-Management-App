import { describe, it, expect } from 'vitest'
import { findActiveHref } from '@/components/layouts/use-nav'
import { ADMIN_NAV, STAFF_NAV } from '@/components/layouts/nav-items'

const adminHrefs = ADMIN_NAV.map((n) => n.href)
const staffHrefs = STAFF_NAV.map((n) => n.href)

describe('findActiveHref（最長一致・単一アクティブ）', () => {
  it('ダッシュボード直下では /admin がアクティブ', () => {
    expect(findActiveHref('/admin', adminHrefs)).toBe('/admin')
  })

  it('配下ページで /admin（ダッシュボード）を誤ってアクティブにしない', () => {
    expect(findActiveHref('/admin/inbox', adminHrefs)).toBe('/admin/inbox')
    // 受注ボックスの配下（承認待ちフィルタ等）でも受注ボックスがアクティブになる。
    expect(findActiveHref('/admin/inbox/anything', adminHrefs)).toBe('/admin/inbox')
    expect(findActiveHref('/admin/rules', adminHrefs)).toBe('/admin/rules')
  })

  it('詳細ページ（サブパス）でも親メニューに一致する', () => {
    expect(findActiveHref('/admin/orders/123', adminHrefs)).toBe('/admin/orders')
    expect(findActiveHref('/admin/invoices/abc', adminHrefs)).toBe('/admin/invoices')
  })

  it('前方一致が重なる href では長い方が勝つ', () => {
    // 例: /admin/orders vs /admin
    expect(findActiveHref('/admin/orders', adminHrefs)).toBe('/admin/orders')
    expect(findActiveHref('/admin', adminHrefs)).toBe('/admin')
    expect(findActiveHref('/admin/orders/xyz', adminHrefs)).toBe('/admin/orders')
  })

  it('メニューに無いパスは null（誤ハイライトしない）', () => {
    expect(findActiveHref('/login', adminHrefs)).toBeNull()
    expect(findActiveHref('/portal/order', adminHrefs)).toBeNull()
  })

  it('staff メニューでも同様に一意に決まる', () => {
    expect(findActiveHref('/field/shipments', staffHrefs)).toBe('/field/shipments')
    expect(findActiveHref('/field/deliveries/42', staffHrefs)).toBe('/field/deliveries')
  })
})
