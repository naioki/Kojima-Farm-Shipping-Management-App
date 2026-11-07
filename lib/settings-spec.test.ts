import { describe, it, expect } from 'vitest'
import { resolveToggle, SETTINGS_SPEC, STAFF_FEATURE_KEYS } from './settings-spec'

describe('resolveToggle', () => {
  it('未設定・空文字は既定値を使う', () => {
    expect(resolveToggle(null, 'off')).toBe('off')
    expect(resolveToggle(undefined, 'on')).toBe('on')
    expect(resolveToggle('', 'off')).toBe('off')
    expect(resolveToggle('  ', 'on')).toBe('on')
  })
  it('on/off は大文字小文字を問わず優先される', () => {
    expect(resolveToggle('ON', 'off')).toBe('on')
    expect(resolveToggle('off', 'on')).toBe('off')
  })
  it('既定値を省略したらオフ', () => {
    expect(resolveToggle(null)).toBe('off')
  })
})

describe('現場スタッフ機能の既定は全てオフ（lib/field/features.ts は on のみ許可）', () => {
  it('toggleDefault が off', () => {
    for (const key of Object.values(STAFF_FEATURE_KEYS)) {
      const spec = SETTINGS_SPEC.find((s) => s.key === key)
      expect(spec?.toggleDefault, key).toBe('off')
    }
  })
})
