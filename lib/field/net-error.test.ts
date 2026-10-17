import { describe, it, expect, afterEach, vi } from 'vitest'
import { isNetworkError, isBrowserOffline, fieldErrorMessage, OFFLINE_MESSAGE } from './net-error'

/** navigator.onLine を差し替える（jsdom 非依存。テスト後は必ず戻す）。 */
function stubOnLine(value: boolean | undefined) {
  if (value === undefined) {
    // @ts-expect-error テスト用に navigator ごと消す（SSR 相当）
    delete globalThis.navigator
    return
  }
  vi.stubGlobal('navigator', { onLine: value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isNetworkError', () => {
  it('各ブラウザの fetch 失敗メッセージを通信断と判定する', () => {
    // 現場の端末はバラバラ（Android Chrome / iPad Safari）。どれも拾えないと意味がない
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true) // Chrome
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true) // Firefox
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true) // iOS Safari
    expect(isNetworkError(new Error('The Internet connection appears to be offline.'))).toBe(true)
  })

  it('大文字小文字を問わない', () => {
    expect(isNetworkError(new Error('failed to FETCH'))).toBe(true)
  })

  it('文字列で投げられた場合も判定できる', () => {
    expect(isNetworkError('Failed to fetch')).toBe(true)
  })

  it('通信と無関係な例外は通信断にしない（バグを圏外のせいにしない）', () => {
    expect(isNetworkError(new Error('更新失敗 (409)'))).toBe(false)
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
    expect(isNetworkError({})).toBe(false)
  })
})

describe('isBrowserOffline', () => {
  it('navigator.onLine=false のとき true', () => {
    stubOnLine(false)
    expect(isBrowserOffline()).toBe(true)
  })

  it('オンラインなら false', () => {
    stubOnLine(true)
    expect(isBrowserOffline()).toBe(false)
  })

  it('navigator が無い環境（SSR）では false（サーバー描画を壊さない）', () => {
    stubOnLine(undefined)
    expect(isBrowserOffline()).toBe(false)
  })
})

describe('fieldErrorMessage', () => {
  it('通信断は現場向けの日本語に置き換える（英語の technical message を出さない）', () => {
    stubOnLine(true)
    expect(fieldErrorMessage(new TypeError('Failed to fetch'), '保存に失敗しました')).toBe(OFFLINE_MESSAGE)
  })

  it('ブラウザが圏外を検知していれば、例外の内容によらず圏外扱い', () => {
    stubOnLine(false)
    expect(fieldErrorMessage(new Error('更新失敗 (500)'), '保存に失敗しました')).toBe(OFFLINE_MESSAGE)
  })

  it('通信断でない Error は、その message をそのまま活かす（サーバーの日本語エラー）', () => {
    stubOnLine(true)
    expect(fieldErrorMessage(new Error('出荷済みの明細は削除できません'), '保存に失敗しました')).toBe(
      '出荷済みの明細は削除できません',
    )
  })

  it('message が空の Error は fallback に落とす', () => {
    stubOnLine(true)
    expect(fieldErrorMessage(new Error('   '), '保存に失敗しました')).toBe('保存に失敗しました')
  })

  it('Error でない値は fallback に落とす', () => {
    stubOnLine(true)
    expect(fieldErrorMessage({ code: 500 }, '保存に失敗しました')).toBe('保存に失敗しました')
    expect(fieldErrorMessage(null, '保存に失敗しました')).toBe('保存に失敗しました')
  })

  it('SSR（navigator 無し）でも例外を投げない', () => {
    stubOnLine(undefined)
    expect(fieldErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })
})
