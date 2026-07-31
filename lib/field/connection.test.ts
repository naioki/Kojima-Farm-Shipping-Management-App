import { describe, it, expect } from 'vitest'
import {
  INITIAL_CONNECTION,
  reduceConnection,
  isBannerVisible,
  type ConnectionState,
  type ConnectionEvent,
} from './connection'

/** イベント列をまとめて流し、最終状態と refresh 回数を返す。 */
function run(events: ConnectionEvent[], from: ConnectionState = INITIAL_CONNECTION) {
  let state = from
  let refreshes = 0
  for (const e of events) {
    const t = reduceConnection(state, e)
    state = t.state
    if (t.shouldRefresh) refreshes++
  }
  return { state, refreshes }
}

describe('reduceConnection', () => {
  it('初期状態では帯を出さない（最初からオンラインの人の邪魔をしない）', () => {
    expect(isBannerVisible(INITIAL_CONNECTION)).toBe(false)
  })

  it('圏外になったら帯を出し、出しっぱなしにする', () => {
    const { state } = run([{ type: 'offline' }])
    expect(state.online).toBe(false)
    expect(isBannerVisible(state)).toBe(true)
  })

  it('圏外が続いてもデータは取り直さない', () => {
    const { refreshes } = run([{ type: 'offline' }, { type: 'offline' }])
    expect(refreshes).toBe(0)
  })

  it('復帰したら知らせて、1回だけ取り直す', () => {
    const { state, refreshes } = run([{ type: 'offline' }, { type: 'online' }])
    expect(state.online).toBe(true)
    expect(state.showRecovered).toBe(true)
    expect(isBannerVisible(state)).toBe(true)
    expect(refreshes).toBe(1)
  })

  it('一度も切れていないのに online が来ても「つながりました」を出さない', () => {
    // 重複イベントや初回通知で無意味な通知を出すと、本当の圏外通知が軽く見られる
    const { state, refreshes } = run([{ type: 'online' }])
    expect(state.showRecovered).toBe(false)
    expect(isBannerVisible(state)).toBe(false)
    expect(refreshes).toBe(0)
  })

  it('復帰後に online が重複して来ても、取り直しは増えない', () => {
    const { refreshes } = run([{ type: 'offline' }, { type: 'online' }, { type: 'online' }])
    expect(refreshes).toBe(1)
  })

  it('復帰通知は時間経過で消える', () => {
    const { state } = run([{ type: 'offline' }, { type: 'online' }, { type: 'recovered-timeout' }])
    expect(state.showRecovered).toBe(false)
    expect(isBannerVisible(state)).toBe(false)
  })

  it('復帰通知の途中でまた切れたら、通知を引っ込めて圏外表示に戻す', () => {
    const { state } = run([{ type: 'offline' }, { type: 'online' }, { type: 'offline' }])
    expect(state.online).toBe(false)
    expect(state.showRecovered).toBe(false)
    expect(isBannerVisible(state)).toBe(true)
  })

  it('切れる→戻るを繰り返すたびに取り直す（電波が不安定な圃場を想定）', () => {
    const { refreshes } = run([
      { type: 'offline' },
      { type: 'online' },
      { type: 'offline' },
      { type: 'online' },
      { type: 'offline' },
      { type: 'online' },
    ])
    expect(refreshes).toBe(3)
  })

  it('圏外のまま画面を開いた場合も帯が出る', () => {
    // マウント時に navigator.onLine === false なら offline を流す想定
    const { state } = run([{ type: 'offline' }])
    expect(isBannerVisible(state)).toBe(true)
  })

  it('元の state を破壊しない（React の state 更新として安全）', () => {
    const before: ConnectionState = { ...INITIAL_CONNECTION }
    reduceConnection(before, { type: 'offline' })
    expect(before).toEqual(INITIAL_CONNECTION)
  })
})
