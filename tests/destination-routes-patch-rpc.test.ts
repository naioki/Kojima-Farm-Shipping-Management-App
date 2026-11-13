/**
 * 退避ストア（app_settings `v5_destination_routes`）の保存は、DB 関数 patch_destination_route（migrations/0033）が
 * あればキー単位の部分更新を DB 側の1文で行う（全体の読み→マージ→upsert をしない）。
 * - 関数あり: rpc がそのキー・その項目だけを送る。全体の upsert も事前の全体読み込みもしない
 * - 続けて2つ保存しても、どちらもキー単位のペイロード（同時に走っても互いの変更を消さない）
 * - 関数なし（PGRST202 / 42883）: 従来の読み→マージ→書きにフォールバック
 * - rpc のその他のエラー: 従来と同じく throw（呼び出し側が 500／警告にする）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeResult } from './support/fake-supabase'
import { saveDestinationOverride, saveRouteOverride } from '@/lib/field/destination-routes-store'
import { isMissingFunctionError } from '@/lib/supabase/missing-column'

const D1 = 'dest:11111111-1111-4111-8111-111111111111'
const D2 = 'dest:22222222-2222-4222-8222-222222222222'

function setup(rpcResult: FakeResult = {}, stored: string | null = null) {
  return createFakeSupabase(
    (c) => (c.table === 'app_settings' && c.op === 'select' ? { data: stored === null ? null : { value: stored } } : undefined),
    () => rpcResult,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('patch_destination_route がある環境', () => {
  it('saveRouteOverride はキー単位のペイロードで rpc を呼び、全体の読み込み・upsert をしない', async () => {
    const fake = setup()
    await saveRouteOverride(fake.client as never, [D1, '', 'cust:c1:default'], { departureTime: '11:30', shippingRouteName: null })
    expect(fake.rpcCalls).toEqual([
      {
        fn: 'patch_destination_route',
        args: { p_keys: [D1, 'cust:c1:default'], p_set: { departureTime: '11:30', shippingRouteName: null }, p_unset: [] },
      },
    ])
    expect(fake.calls.filter((c) => c.table === 'app_settings')).toEqual([])
  })

  it('規定コンテナだけの保存はその項目だけを送り、空にすると削除（p_unset）になる', async () => {
    const fake = setup()
    await saveDestinationOverride(fake.client as never, [D1], { defaultContainerType: ' 青コン ' })
    await saveDestinationOverride(fake.client as never, [D1], { defaultContainerType: '  ' })
    expect(fake.rpcCalls.map((c) => c.args)).toEqual([
      { p_keys: [D1], p_set: { defaultContainerType: '青コン' }, p_unset: [] },
      { p_keys: [D1], p_set: {}, p_unset: ['defaultContainerType'] },
    ])
  })

  it('2つの保存（別の納入先・同じ納入先の別項目）を同時に走らせても、どちらもそのキー・項目だけを送る', async () => {
    const fake = setup()
    await Promise.all([
      saveDestinationOverride(fake.client as never, [D1], { departureTime: '09:00' }),
      saveDestinationOverride(fake.client as never, [D2], { shippingRouteName: '2便' }),
      saveDestinationOverride(fake.client as never, [D1], { defaultContainerType: '黄コン' }),
    ])
    expect(fake.rpcCalls.map((c) => c.args)).toEqual([
      { p_keys: [D1], p_set: { departureTime: '09:00' }, p_unset: [] },
      { p_keys: [D2], p_set: { shippingRouteName: '2便' }, p_unset: [] },
      { p_keys: [D1], p_set: { defaultContainerType: '黄コン' }, p_unset: [] },
    ])
    // 全体を書き戻す経路を通らない（＝他のキー・項目を古い値で上書きしない）
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })

  it('キーが空なら何もしない', async () => {
    const fake = setup()
    await saveDestinationOverride(fake.client as never, ['', '  '], { departureTime: '09:00' })
    expect(fake.rpcCalls).toEqual([])
  })

  it('rpc のその他のエラーは throw し、フォールバックで全体を書かない', async () => {
    const fake = setup({ error: { code: '57014', message: 'statement timeout' } })
    await expect(
      saveRouteOverride(fake.client as never, [D1], { departureTime: '11:30', shippingRouteName: null }),
    ).rejects.toThrow(/退避データの保存に失敗: statement timeout/)
    expect(fake.calls.some((c) => c.table === 'app_settings')).toBe(false)
  })
})

describe('patch_destination_route が無い環境（未適用）', () => {
  it.each([
    ['PGRST202', { code: 'PGRST202', message: 'Could not find the function public.patch_destination_route(p_keys, p_set, p_unset) in the schema cache' }],
    ['42883', { code: '42883', message: 'function public.patch_destination_route(text[], jsonb, text[]) does not exist' }],
  ])('%s なら従来の読み→マージ→書きで他の納入先・項目を残して保存する', async (_l, error) => {
    const stored = JSON.stringify({ [D2]: { departureTime: '08:00' }, [D1]: { defaultContainerType: '青コン' } })
    const fake = setup({ error }, stored)
    await saveRouteOverride(fake.client as never, [D1], { departureTime: '11:30', shippingRouteName: null })
    const up = fake.calls.find((c) => c.table === 'app_settings' && c.op === 'upsert')!
    expect(JSON.parse((up.payload as { value: string }).value)).toEqual({
      [D2]: { departureTime: '08:00' },
      [D1]: { defaultContainerType: '青コン', departureTime: '11:30', shippingRouteName: null },
    })
  })

  it('フォールバックでも読み込みエラーなら上書きせず throw する', async () => {
    const fake = createFakeSupabase(
      (c) => (c.table === 'app_settings' && c.op === 'select' ? { error: { message: 'read timeout' } } : undefined),
      () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }),
    )
    await expect(saveDestinationOverride(fake.client as never, [D1], { departureTime: '09:00' })).rejects.toThrow(/read timeout/)
    expect(fake.calls.some((c) => c.op === 'upsert')).toBe(false)
  })
})

describe('isMissingFunctionError', () => {
  it('関数が無いエラーだけを真にする', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunctionError({ code: '42883' })).toBe(true)
    expect(isMissingFunctionError({ message: 'Could not find the function public.x in the schema cache' })).toBe(true)
    expect(isMissingFunctionError({ code: '42703', message: 'column "x" does not exist' })).toBe(false)
    expect(isMissingFunctionError({ code: '57014', message: 'timeout' })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
  })
})
