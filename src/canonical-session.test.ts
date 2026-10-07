import { describe, expect, it } from 'vitest'
import { buildCanonicalSessionParams } from './hermes'

describe('Canonical session contract', () => {
  it('builds canonical session params with title "Bot Chat" and hidden: true', () => {
    const params = buildCanonicalSessionParams('researcher')
    expect(params).toEqual({
      profile: 'researcher',
      title: 'Bot Chat',
      hidden: true,
      follow_profile_config: true,
    })
  })
})
