import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Server Component（'use client' の無い app/ 配下のファイル）に onChange/onClick などのイベントハンドラを
 * 書くと、その画面を開いた瞬間にページ全体がエラーになる（週の管理で予定のない週を開くと落ちていた）。
 * 同じ失敗を静的に検出する。
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : []
  })
}

describe('Server Component にイベントハンドラを書かない', () => {
  it("app/ の 'use client' 無しファイルに onXxx={ が無い", () => {
    const bad = walk('app').filter((f) => {
      const src = readFileSync(f, 'utf8')
      if (/^\s*['"]use client['"]/m.test(src.slice(0, 200))) return false
      return /\son(Change|Click|Submit|Input|Blur|Focus|KeyDown|KeyUp)=\{/.test(src)
    })
    expect(bad).toEqual([])
  })
})
