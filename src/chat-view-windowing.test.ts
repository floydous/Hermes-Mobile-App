import { describe, expect, it } from 'vitest'
import { computeProgressiveRenderSlice, shouldAutoRevealEarlierMessages, FetchEarlierCoordinator } from './components/ChatView'

describe('Progressive Message Windowing Algorithm & Top Offset Tracking', () => {
  it('caps initial render to 25 items for a 100-message transcript with offset 75', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const initialOffset = Math.max(0, messages.length - 25) // 75
    const result = computeProgressiveRenderSlice(messages, initialOffset)

    expect(result.renderedMessages).toHaveLength(25)
    expect(result.hasEarlierInBatch).toBe(true)
    expect(result.remainingEarlier).toBe(75)

    // Oldest rendered item is item 76 (index 75)
    expect(result.renderedMessages[0].id).toBe(76)
    // Newest rendered item is item 100 (index 99)
    expect(result.renderedMessages[24].id).toBe(100)
  })

  it('progressively expands window upwards when earlier offset decreases by 25', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const expandedOffset = 75 - 25 // 50
    const expanded = computeProgressiveRenderSlice(messages, expandedOffset)

    expect(expanded.renderedMessages).toHaveLength(50)
    expect(expanded.hasEarlierInBatch).toBe(true)
    expect(expanded.remainingEarlier).toBe(50)
    expect(expanded.renderedMessages[0].id).toBe(51)
    expect(expanded.renderedMessages[49].id).toBe(100)
  })

  it('renders all items when history is smaller than 25 (offset = 0)', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const offset = Math.max(0, messages.length - 25) // 0
    const result = computeProgressiveRenderSlice(messages, offset)

    expect(result.renderedMessages).toHaveLength(15)
    expect(result.hasEarlierInBatch).toBe(false)
    expect(result.remainingEarlier).toBe(0)
    expect(result.renderedMessages[0].id).toBe(1)
  })

  it('inherently preserves top visible message when new messages arrive at tail (zero eviction)', () => {
    const initialMessages = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const offset = Math.max(0, initialMessages.length - 25) // 5
    const initial = computeProgressiveRenderSlice(initialMessages, offset)

    expect(initial.renderedMessages[0].id).toBe(6) // item 6 is at top
    expect(initial.renderedMessages).toHaveLength(25)

    // New messages arrive: messages.length becomes 32
    const updatedMessages = [
      ...initialMessages,
      { id: 31, content: 'Msg 31' },
      { id: 32, content: 'Msg 32' },
    ]

    // Top offset remains 5!
    const afterAppend = computeProgressiveRenderSlice(updatedMessages, offset)

    expect(afterAppend.renderedMessages).toHaveLength(27)
    // Top message MUST still be item 6! Zero eviction!
    expect(afterAppend.renderedMessages[0].id).toBe(6)
    expect(afterAppend.renderedMessages[26].id).toBe(32)
  })

  it('keeps initial render capped at 25 across chunked history loading (0 -> 25 -> 100)', () => {
    // Phase 1: 0 messages on mount
    let messages: any[] = []
    let offset = Math.max(0, messages.length - 25) // 0

    // Phase 2: First chunk arrives (25 messages)
    messages = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    offset = Math.max(0, messages.length - 25) // 0
    const slice1 = computeProgressiveRenderSlice(messages, offset)
    expect(slice1.renderedMessages).toHaveLength(25)

    // Phase 3: Remaining chunk arrives (100 messages total)
    messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    offset = Math.max(0, messages.length - 25) // 75
    const slice2 = computeProgressiveRenderSlice(messages, offset)
    expect(slice2.renderedMessages).toHaveLength(25)
    expect(slice2.hasEarlierInBatch).toBe(true)
    expect(slice2.remainingEarlier).toBe(75)
    expect(slice2.renderedMessages[0].id).toBe(76)
  })

  it('correctly guards auto-reveal to prevent premature expansion on mount', () => {
    // 1. Initial mount at scrollTop = 0 before layout settled: must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: false,
      initialScrolledToBottom: false,
      isFollowing: true,
      scrollTop: 0,
      loadingEarlier: false,
      pullRefreshing: false,
    })).toBe(false)

    // 2. Initial mount when initialized=true but initial bottom scroll hasn't settled: must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: false,
      isFollowing: true,
      scrollTop: 0,
      loadingEarlier: false,
      pullRefreshing: false,
    })).toBe(false)

    // 3. Settled at bottom (isFollowing = true), even if scrollTop < 140 in short transcript: must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: true,
      isFollowing: true,
      scrollTop: 50,
      loadingEarlier: false,
      pullRefreshing: false,
    })).toBe(false)

    // 4. User deliberately scrolled UP near top (isFollowing = false, scrollTop = 100 < 140): MUST auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: true,
      isFollowing: false,
      scrollTop: 100,
      loadingEarlier: false,
      pullRefreshing: false,
    })).toBe(true)

    // 5. User scrolled mid-transcript (scrollTop = 400 >= 140): must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: true,
      isFollowing: false,
      scrollTop: 400,
      loadingEarlier: false,
      pullRefreshing: false,
    })).toBe(false)

    // 6. Already loading earlier: must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: true,
      isFollowing: false,
      scrollTop: 50,
      loadingEarlier: true,
      pullRefreshing: false,
    })).toBe(false)

    // 7. Pull-refresh active: must NOT auto-reveal
    expect(shouldAutoRevealEarlierMessages({
      initialized: true,
      initialScrolledToBottom: true,
      isFollowing: false,
      scrollTop: 50,
      loadingEarlier: false,
      pullRefreshing: true,
    })).toBe(false)
  })

  it('validates complete scroll-transition lifecycle from mount to bottom to top-reveal', () => {
    // Stage 1: Container mounts at scrollTop = 0 before layout settled
    let initialized = false
    let initialScrolledToBottom = false
    let isFollowing = true
    let loadingEarlier = false
    let pullRefreshing = false
    let scrollTop = 0

    // Mount scroll event fired by browser at top
    expect(shouldAutoRevealEarlierMessages({
      initialized,
      initialScrolledToBottom,
      isFollowing,
      scrollTop,
      loadingEarlier,
      pullRefreshing,
    })).toBe(false)

    // Stage 2: Initial scrollToBottom executes and settles
    initialized = true
    initialScrolledToBottom = true
    isFollowing = true // nearEnd is true at bottom
    scrollTop = 800 // Scrolled to bottom of 1000px thread
    expect(shouldAutoRevealEarlierMessages({
      initialized,
      initialScrolledToBottom,
      isFollowing,
      scrollTop,
      loadingEarlier,
      pullRefreshing,
    })).toBe(false)

    // Stage 3: User drags/scrolls upwards towards middle
    isFollowing = false // nearEnd becomes false
    scrollTop = 450 // Still well above threshold (>= 140)
    expect(shouldAutoRevealEarlierMessages({
      initialized,
      initialScrolledToBottom,
      isFollowing,
      scrollTop,
      loadingEarlier,
      pullRefreshing,
    })).toBe(false)

    // Stage 4: User scrolls near the top (< 140)
    scrollTop = 90
    expect(shouldAutoRevealEarlierMessages({
      initialized,
      initialScrolledToBottom,
      isFollowing,
      scrollTop,
      loadingEarlier,
      pullRefreshing,
    })).toBe(true)

    // Stage 5: While fetching earlier page, auto-reveal locks to prevent duplicate calls
    loadingEarlier = true
    expect(shouldAutoRevealEarlierMessages({
      initialized,
      initialScrolledToBottom,
      isFollowing,
      scrollTop,
      loadingEarlier,
      pullRefreshing,
    })).toBe(false)
  })

  it('guarantees concurrency locking and drops stale in-flight results across session changes via FetchEarlierCoordinator', async () => {
    const coordinator = new FetchEarlierCoordinator('session-A')
    let visibleHasMore = true
    let underlyingFetchCount = 0

    // 1. Concurrency: duplicate synchronous calls initiate exactly one request
    let resolveA: (val: boolean) => void
    const promiseA = new Promise<boolean>(res => { resolveA = res })

    const callA1 = coordinator.executeFetch(
      () => {
        underlyingFetchCount++
        return promiseA
      },
      more => { visibleHasMore = more },
      () => { visibleHasMore = false }
    )
    const callA2 = coordinator.executeFetch(
      () => {
        underlyingFetchCount++
        return Promise.resolve(true)
      },
      more => { visibleHasMore = more },
      () => { visibleHasMore = false }
    )

    expect(underlyingFetchCount).toBe(1)
    expect(coordinator.isFetchLocked()).toBe(true)

    // 2. User switches to Session B while request A is in-flight
    coordinator.onSessionChange('session-B')
    expect(coordinator.isFetchLocked()).toBe(false) // Ready for session B fetch

    // 3. User initiates request B on Session B
    let resolveB: (val: boolean) => void
    const promiseB = new Promise<boolean>(res => { resolveB = res })
    const callB = coordinator.executeFetch(
      () => {
        underlyingFetchCount++
        return promiseB
      },
      more => { visibleHasMore = more },
      () => { visibleHasMore = false }
    )
    expect(underlyingFetchCount).toBe(2)
    expect(coordinator.isFetchLocked()).toBe(true)

    // 4. Stale request A resolves with hasMore=false
    resolveA!(false)
    const resA1 = await callA1
    const resA2 = await callA2
    expect(resA1).toBe(true)
    expect(resA2).toBe(false) // Locked out

    // 5. Assert stale A did NOT overwrite visible state, and B remains locked!
    expect(visibleHasMore).toBe(true)
    expect(coordinator.isFetchLocked()).toBe(true)

    // 6. Request B completes successfully with hasMore=false
    resolveB!(false)
    const resB = await callB
    expect(resB).toBe(true)
    expect(visibleHasMore).toBe(false)
    expect(coordinator.isFetchLocked()).toBe(false)
  })

  it('drops stale rejections across session changes and preserves lock on new session', async () => {
    const coordinator = new FetchEarlierCoordinator('session-A')
    let aFailed = false
    let bSuccess = false

    let rejectA: (err: Error) => void
    const promiseA = new Promise<boolean>((_, rej) => { rejectA = rej })

    const callA = coordinator.executeFetch(
      () => promiseA,
      () => {},
      () => { aFailed = true }
    )

    // Switch to Session B
    coordinator.onSessionChange('session-B')

    let resolveB: (val: boolean) => void
    const promiseB = new Promise<boolean>(res => { resolveB = res })
    const callB = coordinator.executeFetch(
      () => promiseB,
      () => { bSuccess = true },
      () => {}
    )

    // Stale A rejects
    rejectA!(new Error('Network error on session A'))
    await callA

    // A's onFailure must NOT be invoked, and B must remain locked!
    expect(aFailed).toBe(false)
    expect(coordinator.isFetchLocked()).toBe(true)

    // B completes
    resolveB!(true)
    await callB
    expect(bSuccess).toBe(true)
    expect(coordinator.isFetchLocked()).toBe(false)
  })

  it('releases lock on current-session request failure allowing subsequent retries', async () => {
    const coordinator = new FetchEarlierCoordinator('session-X')
    let failureCount = 0
    let successCount = 0

    // 1. Initial attempt fails
    const call1 = coordinator.executeFetch(
      () => Promise.reject(new Error('Transient failure')),
      () => { successCount++ },
      () => { failureCount++ }
    )
    await call1

    expect(failureCount).toBe(1)
    expect(successCount).toBe(0)
    expect(coordinator.isFetchLocked()).toBe(false) // Lock MUST be released!

    // 2. Retry succeeds
    const call2 = coordinator.executeFetch(
      () => Promise.resolve(true),
      () => { successCount++ },
      () => { failureCount++ }
    )
    await call2

    expect(failureCount).toBe(1)
    expect(successCount).toBe(1)
    expect(coordinator.isFetchLocked()).toBe(false)
  })

  it('no-ops when onSessionChange is called with the same session ID preserving active request generation', async () => {
    const coordinator = new FetchEarlierCoordinator('session-same')
    let successCount = 0

    let resolvePending: (val: boolean) => void
    const pendingPromise = new Promise<boolean>(res => { resolvePending = res })

    // Start in-flight request
    const fetchCall = coordinator.executeFetch(
      () => pendingPromise,
      () => { successCount++ },
      () => {}
    )
    expect(coordinator.isFetchLocked()).toBe(true)

    // Repeated calls with same ID must NOT unlock or advance generation
    coordinator.onSessionChange('session-same')
    coordinator.onSessionChange('session-same')
    coordinator.onSessionChange('session-same')
    expect(coordinator.isFetchLocked()).toBe(true) // Stays locked!

    // Resolve the original request: its callback MUST still execute!
    resolvePending!(true)
    await fetchCall
    expect(successCount).toBe(1)
    expect(coordinator.isFetchLocked()).toBe(false)
  })
})
