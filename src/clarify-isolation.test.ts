import { beforeEach, describe, expect, it } from 'vitest'
import {
  isSessionCanonical,
  doesSessionMatchTurn,
  resolveMatchingClarify,
  getPersistedClarify,
  persistClarify,
  clearPersistedClarify,
} from './clarify-isolation'
import type { LiveProfile, LiveSession } from './hermes'
import type { ClarifyRequest } from './components/ClarifyCard'

describe('clarify-isolation', () => {
  const mockProfiles: LiveProfile[] = [
    {
      name: 'default',
      display_name: 'Default',
      canonical_session: {
        id: 'canonical-default-id',
        resolved_id: 'canonical-default-tip',
        title: 'Bot Chat',
        last_active: 1000,
      },
    },
    {
      name: 'homework',
      display_name: 'Homework Manager',
      canonical_session: {
        id: 'canonical-hw-id',
        title: 'Bot Chat',
        last_active: 1000,
      },
    },
  ]

  const adhocSession1: LiveSession = {
    id: 'adhoc-session-123',
    profile: 'default',
    title: 'Research quantum mechanics',
    preview: '',
    last_active: 1200,
  }

  const adhocSession2: LiveSession = {
    id: 'adhoc-session-456',
    profile: 'default',
    title: 'Debug rust code',
    preview: '',
    last_active: 1300,
  }

  const canonicalDefaultSession: LiveSession = {
    id: 'canonical-default-id',
    profile: 'default',
    title: 'Bot Chat',
    preview: '',
    last_active: 1400,
  }

  const draftDefaultSession: LiveSession = {
    id: 'draft:default',
    profile: 'default',
    title: 'Default',
    preview: '',
    last_active: 1500,
  }

  describe('isSessionCanonical', () => {
    it('correctly identifies canonical vs ad-hoc sessions', () => {
      expect(isSessionCanonical(canonicalDefaultSession, mockProfiles)).toBe(true)
      expect(isSessionCanonical(draftDefaultSession, mockProfiles)).toBe(true)
      expect(isSessionCanonical(adhocSession1, mockProfiles)).toBe(false)
      expect(isSessionCanonical(adhocSession2, mockProfiles)).toBe(false)
    })
  })

  describe('doesSessionMatchTurn', () => {
    it('matches exact session ID for ad-hoc sessions', () => {
      expect(doesSessionMatchTurn(adhocSession1, 'adhoc-session-123', 'default', mockProfiles)).toBe(true)
      // Different ad-hoc session under same profile must NOT match!
      expect(doesSessionMatchTurn(adhocSession2, 'adhoc-session-123', 'default', mockProfiles)).toBe(false)
    })

    it('matches canonical bot chat for canonical turns', () => {
      expect(doesSessionMatchTurn(canonicalDefaultSession, 'canonical-default-id', 'default', mockProfiles)).toBe(true)
      expect(doesSessionMatchTurn(draftDefaultSession, 'canonical-default-id', 'default', mockProfiles)).toBe(true)
      // Ad-hoc session must NOT match canonical turn!
      expect(doesSessionMatchTurn(adhocSession1, 'canonical-default-id', 'default', mockProfiles)).toBe(false)
    })

    it('canonical bot chat never matches an ad-hoc session turn sharing the same profile', () => {
      // User creates session in Sessions tab with profile 'default' or 'researcher'
      // When opening the canonical bot, it must NOT match the ad-hoc session turn!
      expect(doesSessionMatchTurn(canonicalDefaultSession, 'adhoc-session-123', 'default', mockProfiles)).toBe(false)
      expect(doesSessionMatchTurn(draftDefaultSession, 'adhoc-session-123', 'default', mockProfiles)).toBe(false)
    })

    it('resolves alias tips when getter provided', () => {
      const getter = (id: string) => (id === 'alias-tip-123' ? 'adhoc-session-123' : id)
      expect(doesSessionMatchTurn(adhocSession1, 'alias-tip-123', 'default', mockProfiles, getter)).toBe(true)
      expect(doesSessionMatchTurn(adhocSession2, 'alias-tip-123', 'default', mockProfiles, getter)).toBe(false)
    })
  })

  describe('resolveMatchingClarify', () => {
    const clarifyForDefaultCanonical: ClarifyRequest = {
      requestId: 'srq-clarify-default',
      sessionId: 'canonical-default-id',
      questions: [{ qid: 'q1', question: 'Default question' }],
    }

    const clarifyForAdhoc1: ClarifyRequest = {
      requestId: 'srq-clarify-adhoc-1',
      sessionId: 'adhoc-session-123',
      questions: [{ qid: 'q2', question: 'Adhoc question' }],
    }

    it('returns null for ad-hoc session even if activeTurn has pending clarify for canonical session', () => {
      const canonicalClarify: ClarifyRequest = {
        requestId: 'srq-canonical',
        sessionId: 'canonical-default-id',
        questions: [{ qid: 'q1', question: 'Canonical query' }],
      }
      const result = resolveMatchingClarify({
        session: adhocSession1,
        profiles: mockProfiles,
        activeTurn: {
          sessionId: 'canonical-default-id',
          profile: 'default',
          status: 'waiting',
          statusText: 'Waiting…',
          needsInput: true,
          pendingClarify: canonicalClarify,
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 1, role: 'user', content: '' },
          startedAt: 1000,
        },
        pendingClarifyBySession: {
          'canonical-default-id': canonicalClarify,
        },
        pendingClarifyByProfile: {
          default: canonicalClarify,
        },
        getPersistedClarify: () => null,
      })
      expect(result).toBeNull()
    })

    it('resolves clarify for ad-hoc session when sessionId matches exactly', () => {
      const result = resolveMatchingClarify({
        session: adhocSession1,
        profiles: mockProfiles,
        activeTurn: {
          sessionId: 'adhoc-session-123',
          profile: 'default',
          status: 'waiting',
          statusText: 'Needs your input…',
          needsInput: true,
          pendingClarify: clarifyForAdhoc1,
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 1, role: 'user', content: '' },
          startedAt: 1000,
        },
        pendingClarifyBySession: {
          'adhoc-session-123': clarifyForAdhoc1,
        },
        pendingClarifyByProfile: {},
        getPersistedClarify: () => null,
      })

      expect(result).toEqual(clarifyForAdhoc1)
    })

    it('resolves clarify for canonical session when in canonical view', () => {
      const result = resolveMatchingClarify({
        session: canonicalDefaultSession,
        profiles: mockProfiles,
        activeTurn: {
          sessionId: 'canonical-default-id',
          profile: 'default',
          status: 'waiting',
          statusText: 'Needs your input…',
          needsInput: true,
          pendingClarify: clarifyForDefaultCanonical,
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 1, role: 'user', content: '' },
          startedAt: 1000,
        },
        pendingClarifyBySession: {
          'canonical-default-id': clarifyForDefaultCanonical,
        },
        pendingClarifyByProfile: {
          default: clarifyForDefaultCanonical,
        },
        getPersistedClarify: () => null,
      })

      expect(result).toEqual(clarifyForDefaultCanonical)
    })
  })

  describe('localStorage persistence isolation', () => {
    beforeEach(() => {
      const store: Record<string, string> = {}
      ;(globalThis as any).localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
        clear: () => { for (const k in store) delete store[k] },
      }
    })

    it('isolates persisted clarify keys between adhoc and canonical', () => {
      const sampleReq: ClarifyRequest = {
        requestId: 'srq-sample',
        sessionId: 'adhoc-session-999',
        questions: [{ qid: 'q1', question: 'Which one?' }],
      }

      // Ad-hoc session persistence (not canonical)
      persistClarify(sampleReq, 'default', false)
      expect(getPersistedClarify('adhoc-session-999', 'default', false)).toEqual(sampleReq)
      // Another adhoc session under 'default' must NOT retrieve it
      expect(getPersistedClarify('adhoc-session-888', 'default', false)).toBeNull()

      // Cleanup
      clearPersistedClarify('adhoc-session-999', 'default')
      expect(getPersistedClarify('adhoc-session-999', 'default', false)).toBeNull()
    })
  })
})
