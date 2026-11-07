import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ALL_TOURS, GUIDE_UI_LABELS, guideStorageKey } from '@/lib/guide/tours'

/**
 * 操作ガイド（ツアー）の案内先が、画面の作り直しで黙って消えていないかを静的に検査する。
 * 対象が見つからないステップは実行時に自動スキップされるため、壊れても画面上は気づけない。
 * そこで app/ と components/ のソースに data-guide="<target>"（または
 * data-guide={cond ? '<target>' : undefined} の形）が存在することをテストで保証する。
 */

const ROOT = path.resolve(__dirname, '..')

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const sources = [...collectSources(path.join(ROOT, 'app')), ...collectSources(path.join(ROOT, 'components'))]
  .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** data-guide="x" / data-guide='x' / data-guide={... 'x' ...} のいずれかで target を宣言しているファイル */
function filesDeclaring(target: string): string[] {
  const t = escapeRe(target)
  const re = new RegExp(`data-guide=(?:"${t}"|'${t}'|\\{[^}]*['"\`]${t}['"\`][^}]*\\})`)
  return sources.filter((s) => re.test(s.text)).map((s) => path.relative(ROOT, s.file))
}

describe('操作ガイドの案内先（data-guide）', () => {
  for (const tour of ALL_TOURS) {
    describe(`ツアー「${tour.key}」`, () => {
      it('4〜6ステップで、target が重複しない', () => {
        expect(tour.steps.length).toBeGreaterThanOrEqual(4)
        expect(tour.steps.length).toBeLessThanOrEqual(6)
        const targets = tour.steps.map((s) => s.target)
        expect(new Set(targets).size).toBe(targets.length)
      })

      for (const step of tour.steps) {
        it(`target "${step.target}" が画面のどこかに data-guide として存在する`, () => {
          expect(filesDeclaring(step.target), `data-guide="${step.target}" が app/ にも components/ にも見つからない`).not.toEqual([])
        })

        it(`"${step.target}" に日本語とタイ語の見出し・本文がある`, () => {
          expect(step.title.trim()).not.toBe('')
          expect(step.body.trim()).not.toBe('')
          expect(step.title_th.trim()).not.toBe('')
          expect(step.body_th.trim()).not.toBe('')
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

  it('各ツアーが画面に「使い方」ボタンとして置かれている', () => {
    const exportNames: Record<string, string> = {
      shipments: 'SHIPMENTS_TOUR',
      deliveries: 'DELIVERIES_TOUR',
      matrix: 'MATRIX_TOUR',
    }
    for (const tour of ALL_TOURS) {
      const name = exportNames[tour.key]
      expect(name, `ツアー ${tour.key} の定数名が未登録`).toBeTruthy()
      const used = sources.some((s) => s.text.includes(`<GuideTourLauncher tour={${name}}`))
      expect(used, `${name} を使う <GuideTourLauncher> が見つからない`).toBe(true)
    }
  })

  it('ボタン文言が日本語・タイ語の両方そろっている', () => {
    for (const lang of ['ja', 'th'] as const) {
      for (const v of Object.values(GUIDE_UI_LABELS[lang])) expect(v.trim()).not.toBe('')
    }
    for (const v of Object.values(GUIDE_UI_LABELS.th)) expect(v).toMatch(/[฀-๿]/)
  })
})
