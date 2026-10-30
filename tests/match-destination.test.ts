import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { matchDestinationId } from '@/lib/ingestion/process-receipt'

const dests = [
  { id: 'iwatsuki', code: 'パルシステム 岩槻', full_name: 'パルシステム 岩槻', aliases: ['岩槻', 'パルシステム岩槻'] },
  { id: 'sagami', code: 'パルシステム 相模センター', full_name: 'パルシステム 相模センター', aliases: [] },
  {
    id: 'radish',
    code: 'らでぃっしゅぼーや 岩槻ST',
    full_name: 'らでぃっしゅぼーや 岩槻ST',
    aliases: ['ラディッシュ岩槻ST'],
  },
]

describe('matchDestinationId', () => {
  it('ひらがな/カタカナ差を吸収して完全一致する', () => {
    expect(matchDestinationId('ラディッシュぼーや 岩槻ST', dests)).toBe('radish')
    expect(matchDestinationId('ラディッシュ岩槻ST', dests)).toBe('radish')
  })

  it('短い別名「岩槻」が別取引先名を含む入力を誤吸収しない', () => {
    expect(matchDestinationId('らでぃっしゅぼーや岩槻ST様', dests)).not.toBe('iwatsuki')
  })

  it('従来の岩槻・相模は引き続き一致する', () => {
    expect(matchDestinationId('岩槻', dests)).toBe('iwatsuki')
    expect(matchDestinationId('パルシステム相模センター', dests)).toBe('sagami')
  })
})
