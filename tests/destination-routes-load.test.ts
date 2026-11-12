/**
 * 出発時刻・便名の退避データ（app_settings `v5_destination_routes`）の画面表示用読み込み
 * loadRouteOverrides / getRouteOverrides の挙動を固定する。
 * - 通信・DBエラー → error を返す（画面は警告帯）
 * - 行なし → 空・error なし
 * - 壊れた JSON・非オブジェクト（"null"・配列・数値）→ 例外を出さず空・error なし（次の保存で作り直す方針）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeResult } from './support/fake-supabase'
import { loadRouteOverrides, getRouteOverrides } from '@/lib/field/destination-routes-store'

function clientWith(result: FakeResult) {
  return createFakeSupabase((call) => (call.table === 'app_settings' ? result : undefined)).client as never
}

afterEach(() => vi.restoreAllMocks())

describe('loadRouteOverrides', () => {
  it('正常な値はそのまま返す', async () => {
    const value = JSON.stringify({ 'dest:d1': { departureTime: '11:30', shippingRouteName: '1便' } })
    const r = await loadRouteOverrides(clientWith({ data: { value } }))
    expect(r.error).toBeNull()
    expect(r.overrides['dest:d1']).toEqual({ departureTime: '11:30', shippingRouteName: '1便' })
  })

  it('DBエラーは error を返し、空を返す', async () => {
    const r = await loadRouteOverrides(clientWith({ data: null, error: { message: 'timeout', code: '57014' } }))
    expect(r.error).toContain('timeout')
    expect(r.overrides).toEqual({})
  })

  it('通信例外（throw）も error として返す（ページを 500 にしない）', async () => {
    const client = { from: () => { throw new Error('fetch failed') } } as never
    const r = await loadRouteOverrides(client)
    expect(r.error).toContain('fetch failed')
    expect(r.overrides).toEqual({})
  })

  it('行が無いときは空・error なし', async () => {
    const r = await loadRouteOverrides(clientWith({ data: null }))
    expect(r).toEqual({ overrides: {}, containers: {}, error: null })
  })

  it.each([
    ['壊れた JSON', '{"dest:d1": {'],
    ['"null"', 'null'],
    ['配列', '[1,2]'],
    ['数値', '42'],
    ['文字列', '"abc"'],
  ])('%s は例外を出さず空・error なし（console.error には300文字以内で残す）', async (_label, value) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await loadRouteOverrides(clientWith({ data: { value } }))
    expect(r).toEqual({ overrides: {}, containers: {}, error: null })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('壊れた長い値はログで先頭300文字に切り、全体の長さを添える', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const value = '{' + 'x'.repeat(1000)
    await loadRouteOverrides(clientWith({ data: { value } }))
    const logged = spy.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('x'.repeat(301))
    expect(logged).toContain(`全${value.length}文字`)
  })
})

describe('getRouteOverrides（既存の挙動：失敗は空で返す）', () => {
  it('DBエラーは空を返しログに残す', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getRouteOverrides(clientWith({ data: null, error: { message: 'boom' } }))
    expect(r).toEqual({})
    expect(spy).toHaveBeenCalled()
  })

  it('正常な値はそのまま返す', async () => {
    const value = JSON.stringify({ 'cust:c1:default': { departureTime: '16:00', shippingRouteName: null } })
    const r = await getRouteOverrides(clientWith({ data: { value } }))
    expect(r['cust:c1:default']?.departureTime).toBe('16:00')
  })
})
