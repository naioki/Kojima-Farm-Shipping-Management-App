import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as tours from '@/lib/guide/tours'
import { ALL_TOURS, GUIDE_UI_LABELS, guideStorageKey, type GuideTour } from '@/lib/guide/tours'

/**
 * 操作ガイド（ツアー）の案内先が、画面の作り直しで黙って消えていないかを静的に検査する。
 * 対象が見つからないステップは実行時に自動スキップされるため、壊れても画面上は気づけない。
 *
 * 各ツアーの画面（app{tour.path}/page.tsx）から import を再帰的にたどり（app/ と components/ の中だけ）、
 * その画面で実際に描かれる部品のどこかに data-guide="<target>"（または
 * data-guide={cond ? '<target>' : undefined} の形）があることを保証する。
 * 使われていない部品や、別の画面にだけある data-guide では合格しない。
 */

const ROOT = path.resolve(__dirname, '..')
const FOLLOW_DIRS = [path.join(ROOT, 'app') + path.sep, path.join(ROOT, 'components') + path.sep]
const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts']

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // パッケージ（react 等）はたどらない
  const candidates = [base, ...EXTS.map((e) => base + e)]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** 画面ファイルから到達できる app/・components/ 内のソースを再帰的に集める */
function reachableSources(entry: string): Map<string, string> {
  const seen = new Map<string, string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    seen.set(file, text)
    const specs = [
      ...Array.from(text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), (m) => m[1]!),
      ...Array.from(text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g), (m) => m[1]!),
    ]
    for (const spec of specs) {
      const resolved = resolveImport(spec, file)
      if (resolved && FOLLOW_DIRS.some((d) => resolved.startsWith(d))) stack.push(resolved)
    }
  }
  return seen
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function declares(text: string, target: string): boolean {
  const t = escapeRe(target)
  return new RegExp(`data-guide=(?:"${t}"|'${t}'|\\{[^}]*['"\`]${t}['"\`][^}]*\\})`).test(text)
}

function pageFile(tour: GuideTour): string {
  return path.join(ROOT, 'app', ...tour.path.split('/').filter(Boolean), 'page.tsx')
}

/** ツアー定数の export 名（例: SHIPMENTS_TOUR） */
function exportNameOf(tour: GuideTour): string | undefined {
  return Object.entries(tours).find(([, v]) => v === tour)?.[0]
}

describe('操作ガイドの案内先（data-guide）', () => {
  for (const tour of ALL_TOURS) {
    describe(`ツアー「${tour.key}」(${tour.path})`, () => {
      const entry = pageFile(tour)

      it('画面ファイルが存在する', () => {
        expect(fs.existsSync(entry), `${path.relative(ROOT, entry)} が無い`).toBe(true)
      })

      const sources = fs.existsSync(entry) ? reachableSources(entry) : new Map<string, string>()

      it('4〜6ステップで、target が重複しない', () => {
        expect(tour.steps.length).toBeGreaterThanOrEqual(4)
        expect(tour.steps.length).toBeLessThanOrEqual(6)
        const targets = tour.steps.map((s) => s.target)
        expect(new Set(targets).size).toBe(targets.length)
      })

      it('画面に「使い方」ボタン（GuideTourLauncher）としてこのツアーが置かれている', () => {
        const name = exportNameOf(tour)
        expect(name, 'ツアー定数が export されていない').toBeTruthy()
        const pageText = sources.get(entry) ?? ''
        expect(pageText.includes(`<GuideTourLauncher tour={${name}}`), `${name} を使う <GuideTourLauncher> が画面に無い`).toBe(true)
      })

      for (const step of tour.steps) {
        it(`target "${step.target}" がこの画面で描かれる部品に data-guide として存在する`, () => {
          const found = Array.from(sources.entries())
            .filter(([, text]) => declares(text, step.target))
            .map(([file]) => path.relative(ROOT, file))
          expect(found, `data-guide="${step.target}" が ${tour.path} から import される部品に見つからない`).not.toEqual([])
        })

        it(`"${step.target}" に日本語とタイ語の見出し・本文がある`, () => {
          expect(step.title.trim()).not.toBe('')
          expect(step.body.trim()).not.toBe('')
          // タイ語欄にタイ文字が入っている（日本語のコピペ漏れ防止）
          expect(step.title_th).toMatch(/[฀-๿]/)
          expect(step.body_th).toMatch(/[฀-๿]/)
        })
      }
    })
  }

  it('ツアーの key は重複しない（既読キーが衝突しない）', () => {
    const keys = ALL_TOURS.map((t) => guideStorageKey(t))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ボタン文言が日本語・タイ語の両方そろっている', () => {
    for (const v of Object.values(GUIDE_UI_LABELS.ja)) expect(v.trim()).not.toBe('')
    for (const v of Object.values(GUIDE_UI_LABELS.th)) expect(v).toMatch(/[฀-๿]/)
  })

  it('import をたどる仕組み自体が働いている（別画面だけの data-guide では合格しない）', () => {
    const matrix = ALL_TOURS.find((t) => t.key === 'matrix')!
    const reach = reachableSources(pageFile(matrix))
    // 週の管理の画面からは積込カードの部品は描かれない
    const hasLoadOk = Array.from(reach.values()).some((text) => declares(text, 'load-ok'))
    expect(hasLoadOk).toBe(false)
  })
})
