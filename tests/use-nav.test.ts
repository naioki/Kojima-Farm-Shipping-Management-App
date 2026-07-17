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
    expect(findActiveHref('/admin/approvals', adminHrefs)).toBe('/admin/approvals')
  })

  it('詳細ページ（サブパス）でも親メニューに一致する', () => {
    expect(findActiveHref('/admin/orders/123', adminHrefs)).toBe('/admin/orders')
    expect(findActiveHref('/admin/customers/abc/edit', adminHrefs)).toBe('/admin/customers')
  })

  it('前方一致が重なる href では長い方が勝つ（pricing vs pricing-master）', () => {
    expect(findActiveHref('/admin/pricing-master', adminHrefs)).toBe('/admin/pricing-master')
    expect(findActiveHref('/admin/pricing', adminHrefs)).toBe('/admin/pricing')
    // "-" 始まりはパス区切りでないので pricing の配下として誤マッチしないこと
    expect(findActiveHref('/admin/pricing-master/xyz', adminHrefs)).toBe('/admin/pricing-master')
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
