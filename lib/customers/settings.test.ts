import { describe, it, expect } from 'vitest'
import { skipsDestinationGate } from './settings'

describe('skipsDestinationGate', () => {
  it('true のときだけ飛ばす', () => {
    expect(skipsDestinationGate({ skip_destination_gate: true })).toBe(true)
    expect(skipsDestinationGate({ skip_destination_gate: false })).toBe(false)
    expect(skipsDestinationGate({ skip_destination_gate: 'true' })).toBe(false)
    expect(skipsDestinationGate({})).toBe(false)
    expect(skipsDestinationGate(null)).toBe(false)
  })
})
