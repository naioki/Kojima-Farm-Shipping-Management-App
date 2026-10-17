import { describe, it, expect, vi } from 'vitest'
import { notify, type NotifyChannel, type NotifyMessage } from './index'
import { levelToColor } from './discord'

const msg: NotifyMessage = {
  event: 'pending_review',
  level: 'info',
  title: '承認待ち',
  body: '新規受信があります',
}

describe('notify — 並列送信・片方失敗で停止しない', () => {
  it('両方成功で両方 ok', async () => {
    const a: NotifyChannel = { name: 'discord', send: vi.fn(async () => {}) }
    const b: NotifyChannel = { name: 'line_works', send: vi.fn(async () => {}) }
    const res = await notify(msg, [a, b])
    expect(res).toEqual([
      { channel: 'discord', ok: true },
      { channel: 'line_works', ok: true },
    ])
  })

  it('片方が throw しても他方は送信され、throw しない', async () => {
    const failing: NotifyChannel = {
      name: 'discord',
      send: vi.fn(async () => {
        throw new Error('webhook 500')
      }),
    }
    const ok: NotifyChannel = { name: 'line_works', send: vi.fn(async () => {}) }
    const res = await notify(msg, [failing, ok])
    expect(res[0]).toEqual({ channel: 'discord', ok: false, error: 'webhook 500' })
    expect(res[1]).toEqual({ channel: 'line_works', ok: true })
    expect(ok.send).toHaveBeenCalledOnce()
  })

  it('送信先が無くても空配列で安全に返る', async () => {
    expect(await notify(msg, [])).toEqual([])
  })
})

describe('levelToColor', () => {
  it('alert=赤 / warning=黄 / info=緑', () => {
    expect(levelToColor('alert')).toBe(0xd92d20)
    expect(levelToColor('warning')).toBe(0xdc6803)
    expect(levelToColor('info')).toBe(0x16a34a)
  })
})
