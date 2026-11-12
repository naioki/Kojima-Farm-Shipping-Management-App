/**
 * 付随更新の警告（API 応答の warnings / side_effect_warnings）を画面が捨てないことを固定する。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

describe('extractWarnings', () => {
  it('warnings（文字列の配列）を重複なしで取り出す', async () => {
    const { extractWarnings } = await import('@/lib/client/show-warnings')
    expect(extractWarnings({ warnings: ['a', 'a', '', 1, 'b'] })).toEqual(['a', 'b'])
  })

  it('POST /api/orders の side_effect_warnings も読み、配列でない warnings（数量の異常値）は無視する', async () => {
    const { extractWarnings } = await import('@/lib/client/show-warnings')
    expect(
      extractWarnings({ warnings: { 'prod-1': 3.2 }, side_effect_warnings: ['収穫・パックの作業一覧の更新に失敗しました'] }),
    ).toEqual(['収穫・パックの作業一覧の更新に失敗しました'])
  })

  it('警告が無ければ空', async () => {
    const { extractWarnings } = await import('@/lib/client/show-warnings')
    expect(extractWarnings({ ok: true })).toEqual([])
    expect(extractWarnings(null)).toEqual([])
  })
})

/** 関数の本体（宣言から次の同じ深さの関数宣言まで）を切り出す */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`)
  expect(start, `${name} が見つかりません`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf('\n  async function ', start + 10)
  const next2 = src.indexOf('\n  function ', start + 10)
  const ends = [next, next2].filter((i) => i > 0)
  return src.slice(start, ends.length ? Math.min(...ends) : undefined)
}

describe('警告を返しうる API の呼び出し元が警告を表示する', () => {
  const root = join(__dirname, '..')

  it('出荷一覧のワンタップ変更（quickPatchAttributes）は PATCH の警告を表示する', () => {
    const src = readFileSync(join(root, 'components/field/ShipmentRow.tsx'), 'utf8')
    const body = functionBody(src, 'quickPatchAttributes')
    expect(body).toMatch(/fetch\(`\/api\/order-items\//)
    expect(body).toMatch(/showResponseWarnings\(json\)/)
  })

  it('追加フォームの取引先の一括作成（/api/customers/quick）は警告を表示する', () => {
    const src = readFileSync(join(root, 'components/field/ShipmentAddForm.tsx'), 'utf8')
    const at = src.indexOf("fetch('/api/customers/quick'")
    expect(at).toBeGreaterThanOrEqual(0)
    const after = src.slice(at, at + 1200)
    expect(after).toMatch(/showResponseWarnings\(json\)/)
  })

  it('POST /api/orders の side_effect_warnings は、呼ぶ画面が無いことを明記したうえでキーを残している', () => {
    const src = readFileSync(join(root, 'app/api/orders/route.ts'), 'utf8')
    expect(src).toMatch(/POST \/api\/orders を呼ぶ画面はリポジトリに無い/)
    expect(src).toMatch(/side_effect_warnings: sideEffectWarnings/)
  })
})
