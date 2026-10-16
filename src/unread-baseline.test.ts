import { describe, expect, it } from 'vitest'
import {
  calculateUnreadState,
  getEndpointStorageKey,
  hasAnyUnreadBaselineMarker,
  hasInitializedUnreadBaseline,
  isExistingInstallWithReadKeys,
  normalizeTimestampToMs,
  seedUnreadBaselineIfNeeded,
  shouldSeedBaselineForEndpoint,
} from './session-cache'

function createMockStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    get length() { return store.size },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get rawStore() { return store },
  } as unknown as Storage
}

describe('Unread Baseline Seeding on First App Installation', () => {
  const endpointA = 'http://10.0.0.130:9119'
  const endpointB = 'http://localhost:9119'

  const mockSessions = [
    { id: 'sess-1', last_active: 1729000000, resolved_id: 'tip-1' }, // seconds
    { id: 'sess-2', last_active: 1729000050000 }, // milliseconds
    { id: 'sess-3', last_active: 0 }, // no activity yet
  ]

  const mockProfiles = [
    {
      name: 'homework-manager',
      canonical_session: { id: 'canon-hw', last_active: 1729000010, resolved_id: 'tip-hw' },
    },
    {
      name: 'researcher',
      canonical_session: { id: 'canon-res', last_active: 1729000020 },
      last_session: { id: 'last-res', last_active: 1729000025 },
    },
    {
      name: 'empty-bot',
      canonical_session: null,
    },
  ]

  it('normalizes seconds and milliseconds timestamps correctly', () => {
    expect(normalizeTimestampToMs(1729000000)).toBe(1729000000000)
    expect(normalizeTimestampToMs(1729000000000)).toBe(1729000000000)
    expect(normalizeTimestampToMs(0)).toBe(0)
    expect(normalizeTimestampToMs(undefined)).toBe(0)
    expect(normalizeTimestampToMs(null)).toBe(0)
  })

  it('normalizes endpoint storage keys consistently', () => {
    expect(getEndpointStorageKey('http://10.0.0.130:9119/')).toBe('http://10.0.0.130:9119')
    expect(getEndpointStorageKey('HTTP://10.0.0.130:9119')).toBe('http://10.0.0.130:9119')
  })

  it('detects fresh install when no baseline marker and no read keys exist', () => {
    const storage = createMockStorage()
    expect(hasInitializedUnreadBaseline(endpointA, storage)).toBe(false)
    expect(isExistingInstallWithReadKeys(endpointA, storage)).toBe(false)
    expect(hasAnyUnreadBaselineMarker(storage)).toBe(false)
    expect(shouldSeedBaselineForEndpoint(endpointA, storage)).toBe('seed')
  })

  it('seeds baseline on fresh install and prevents all existing sessions and bots from showing unread badges', () => {
    const storage = createMockStorage()
    const inMemoryMap = new Map<string, number>()

    const { seeded, sessionCount } = seedUnreadBaselineIfNeeded(
      endpointA,
      mockSessions,
      mockProfiles,
      inMemoryMap,
      storage
    )

    expect(seeded).toBe(true)
    expect(sessionCount).toBeGreaterThan(0)
    expect(hasInitializedUnreadBaseline(endpointA, storage)).toBe(true)

    // Checkpoints were persisted for regular sessions (including resolved_id and endpoint-scoped key)
    const epAKey = getEndpointStorageKey(endpointA)
    expect(storage.getItem(`hermes-last-read:${epAKey}:sess-1`)).toBe('1729000000000')
    expect(storage.getItem('hermes-last-read:sess-1')).toBe('1729000000000')
    expect(storage.getItem(`hermes-last-read:${epAKey}:tip-1`)).toBe('1729000000000')
    expect(storage.getItem(`hermes-last-read:${epAKey}:sess-2`)).toBe('1729000050000')
    expect(inMemoryMap.get(`${epAKey}:sess-1`)).toBe(1729000000000)
    expect(inMemoryMap.get('sess-1')).toBe(1729000000000)

    // Checkpoints were persisted for canonical bot sessions
    expect(storage.getItem(`hermes-last-read:${epAKey}:canon-hw`)).toBe('1729000010000')
    expect(storage.getItem(`hermes-last-read:${epAKey}:tip-hw`)).toBe('1729000010000')
    expect(storage.getItem(`hermes-last-read:${epAKey}:canon-res`)).toBe('1729000020000')
    expect(inMemoryMap.get(`${epAKey}:canon-hw`)).toBe(1729000010000)

    // Now calculate unread state for all sessions: EVERY ONE MUST BE UNREAD FALSE!
    for (const s of mockSessions) {
      const lastRead = inMemoryMap.get(`${epAKey}:${s.id}`) ?? inMemoryMap.get(s.id) ?? 0
      const { isUnread, unreadCount } = calculateUnreadState(
        s.id,
        s.last_active,
        undefined,
        lastRead,
        false,
        false
      )
      expect(isUnread).toBe(false)
      expect(unreadCount).toBe(0)
    }

    // Canonical bot chats must also have 0 unread
    for (const p of mockProfiles) {
      if (p.canonical_session) {
        const lastRead = inMemoryMap.get(`${epAKey}:${p.canonical_session.id}`) ?? inMemoryMap.get(p.canonical_session.id) ?? 0
        const { isUnread, unreadCount } = calculateUnreadState(
          p.canonical_session.id,
          p.canonical_session.last_active,
          undefined,
          lastRead,
          false,
          false
        )
        expect(isUnread).toBe(false)
        expect(unreadCount).toBe(0)
      }
    }
  })

  it('marks a session unread when a newer message arrives after the initial baseline', () => {
    const storage = createMockStorage()
    const inMemoryMap = new Map<string, number>()

    seedUnreadBaselineIfNeeded(endpointA, mockSessions, mockProfiles, inMemoryMap, storage)

    // A new message arrives in sess-1 with newer last_active
    const newerLastActive = 1729000099 // newer than 1729000000
    const lastRead = inMemoryMap.get('sess-1') ?? 0

    const { isUnread, unreadCount } = calculateUnreadState(
      'sess-1',
      newerLastActive,
      undefined,
      lastRead,
      false,
      false
    )
    expect(isUnread).toBe(true)
    expect(unreadCount).toBe(1)

    // sess-2 had no new messages, remains unread false
    const s2Result = calculateUnreadState(
      'sess-2',
      mockSessions[1].last_active,
      undefined,
      inMemoryMap.get('sess-2') ?? 0,
      false,
      false
    )
    expect(s2Result.isUnread).toBe(false)
    expect(s2Result.unreadCount).toBe(0)
  })

  it('marks newly discovered sessions appearing after baseline initialization as unread', () => {
    const storage = createMockStorage()
    const inMemoryMap = new Map<string, number>()

    seedUnreadBaselineIfNeeded(endpointA, mockSessions, mockProfiles, inMemoryMap, storage)

    // A brand new session appears from another device or background process
    const brandNewSession = { id: 'brand-new-sess', last_active: 1729000100 }
    const lastRead = inMemoryMap.get(brandNewSession.id) ?? 0 // 0 because not in baseline

    const { isUnread, unreadCount } = calculateUnreadState(
      brandNewSession.id,
      brandNewSession.last_active,
      undefined,
      lastRead,
      false,
      false
    )
    expect(isUnread).toBe(true)
    expect(unreadCount).toBe(1)
  })

  it('preserves existing checkpoints during upgrade without destructive reseeding', () => {
    // Existing install from older version with pre-existing last-read keys, but no baseline marker
    const storage = createMockStorage({
      'hermes-last-read:sess-1': '1729000000000',
      'hermes-last-read:sess-2': '1729000040000', // older than mockSessions[1]'s 1729000050000
    })

    expect(shouldSeedBaselineForEndpoint(endpointA, storage)).toBe('upgrade-skip')

    const inMemoryMap = new Map<string, number>()
    const { seeded } = seedUnreadBaselineIfNeeded(
      endpointA,
      mockSessions,
      mockProfiles,
      inMemoryMap,
      storage
    )

    expect(seeded).toBe(false)
    expect(hasInitializedUnreadBaseline(endpointA, storage)).toBe(true)
    // Pre-existing checkpoints were NOT overwritten
    expect(storage.getItem('hermes-last-read:sess-2')).toBe('1729000040000')
  })

  it('isolates endpoints sharing identical session IDs without cross-contamination', () => {
    const storage = createMockStorage()
    const inMemoryMap = new Map<string, number>()

    const sharedSessionId = 'canon-default'
    const epA = 'http://10.0.0.130:9119'
    const epB = 'http://localhost:9119'
    const epAKey = getEndpointStorageKey(epA)
    const epBKey = getEndpointStorageKey(epB)

    // Endpoint A has canon-default active at 1000
    seedUnreadBaselineIfNeeded(epA, [{ id: sharedSessionId, last_active: 1000 }], [], inMemoryMap, storage)
    expect(hasInitializedUnreadBaseline(epA, storage)).toBe(true)
    expect(hasInitializedUnreadBaseline(epB, storage)).toBe(false)

    // Endpoint B has canon-default active at 5000
    seedUnreadBaselineIfNeeded(epB, [{ id: sharedSessionId, last_active: 5000 }], [], inMemoryMap, storage)
    expect(hasInitializedUnreadBaseline(epB, storage)).toBe(true)

    // Storage preserves distinct endpoint-scoped checkpoints for the same session ID
    expect(storage.getItem(`hermes-last-read:${epAKey}:${sharedSessionId}`)).toBe('1000000')
    expect(storage.getItem(`hermes-last-read:${epBKey}:${sharedSessionId}`)).toBe('5000000')

    // In-memory map stores distinct keys
    expect(inMemoryMap.get(`${epAKey}:${sharedSessionId}`)).toBe(1000000)
    expect(inMemoryMap.get(`${epBKey}:${sharedSessionId}`)).toBe(5000000)
  })

  it('rolls back and does not corrupt inMemoryMap or write marker when storage throws mid-batch', () => {
    let writeCount = 0
    const store = new Map<string, string>()

    const flakyStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writeCount++
        if (writeCount >= 3) {
          throw new Error('QuotaExceededError')
        }
        store.set(k, String(v))
      },
      removeItem: (k: string) => store.delete(k),
      get length() { return store.size },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    } as unknown as Storage

    const inMemoryMap = new Map<string, number>()
    const result = seedUnreadBaselineIfNeeded(
      endpointA,
      mockSessions,
      mockProfiles,
      inMemoryMap,
      flakyStorage
    )

    // Failed mid-batch
    expect(result.seeded).toBe(false)
    expect(hasInitializedUnreadBaseline(endpointA, flakyStorage)).toBe(false)
    // InMemoryMap must NOT be populated with partial keys
    expect(inMemoryMap.size).toBe(0)

    // Rolled back items from store
    expect(store.size).toBe(0)
  })

  it('measures baseline seeding performance on 100 sessions to ensure < 15ms execution time', () => {
    const storage = createMockStorage()
    const inMemoryMap = new Map<string, number>()

    const largeSessionList = Array.from({ length: 100 }, (_, i) => ({
      id: `session-perf-${i}`,
      last_active: 1729000000 + i * 10,
      resolved_id: `tip-perf-${i}`,
    }))

    const start = performance.now()
    const { seeded, sessionCount } = seedUnreadBaselineIfNeeded(
      endpointA,
      largeSessionList,
      mockProfiles,
      inMemoryMap,
      storage
    )
    const duration = performance.now() - start

    expect(seeded).toBe(true)
    expect(sessionCount).toBeGreaterThanOrEqual(200) // 100 sessions * 2 (id + resolved_id) + profiles
    expect(duration).toBeLessThan(15) // well below 15ms
  })
})
