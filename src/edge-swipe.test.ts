import { describe, expect, it } from 'vitest'

import { EDGE_SWIPE_COMMIT_PX, EDGE_SWIPE_MAX_START_PX, shouldCommitEdgeSwipe } from './edge-swipe'

describe('edge swipe back', () => {
  it('restricts gesture start to the leftmost screen edge', () => {
    expect(EDGE_SWIPE_MAX_START_PX).toBe(36)
  })

  it('commits a deliberate horizontal gesture', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX, 10)).toBe(true)
  })

  it('does not steal a mostly vertical scroll', () => {
    expect(shouldCommitEdgeSwipe(120, 110)).toBe(false)
  })

  it('does not commit a short edge drag', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX - 1, 0)).toBe(false)
  })
})
