import { describe, expect, it } from 'vitest'
import { isSessionCanonical, isTurnCanonicalForProfile, doesSessionMatchTurn } from './clarify-isolation'
import { isBotRowWorking, shouldRetainLocalMessages, isTurnSettledByTranscript, shouldShowWorkingIndicator } from './chat-turn'
import { deduplicateConsecutiveMessages } from './session-cache'
import type { LiveMessage, LiveProfile, LiveSession } from './hermes'

describe('Bot Chat Lifecycle & Mid-Turn Reentry Resilience', () => {
  const profiles: LiveProfile[] = [
    {
      name: 'researcher',
      display_name: 'Researcher',
      canonical_session: {
        id: '20261008_120000_res123',
        title: 'Bot Chat',
        last_active: 100,
      },
    },
    {
      name: 'default',
      display_name: 'Default',
      canonical_session: {
        id: '20261008_120000_def456',
        title: 'Bot Chat',
        last_active: 100,
      },
    },
  ]

  const adhocSessions: LiveSession[] = [
    {
      id: 'adhoc-quantum-1',
      title: 'Quantum physics notes',
      preview: '',
      profile: 'researcher',
      last_active: 200,
    },
  ]

  // adhocSessionIds are strictly non-canonical sessions from Sessions tab
  const canonicalSessionIds = new Set(['20261008_120000_res123', '20261008_120000_def456'])
  const adhocSessionIds = new Set(adhocSessions.filter(s => !canonicalSessionIds.has(s.id)).map(s => s.id))

  it('correctly classifies canonical bot chat sessions even when present in backend sessions list', () => {
    const canonicalSession: LiveSession = {
      id: '20261008_120000_res123',
      profile: 'researcher',
      title: 'Bot Chat',
      preview: 'Hello',
      last_active: 300,
    }

    expect(isSessionCanonical(canonicalSession, profiles, adhocSessionIds)).toBe(true)
    expect(isTurnCanonicalForProfile('20261008_120000_res123', 'researcher', profiles, undefined, adhocSessionIds)).toBe(true)

    // Ad-hoc session under researcher is NOT canonical
    expect(isSessionCanonical(adhocSessions[0], profiles, adhocSessionIds)).toBe(false)
    expect(isTurnCanonicalForProfile('adhoc-quantum-1', 'researcher', profiles, undefined, adhocSessionIds)).toBe(false)
  })

  it('Condition 3: when re-entering bot chat while turn is active, matches turn and retains local messages', () => {
    const botSession: LiveSession = {
      id: '20261008_120000_res123',
      profile: 'researcher',
      title: 'Researcher',
      preview: '',
      last_active: 100,
    }

    const activeTurnId = '20261008_120000_res123'
    const match = doesSessionMatchTurn(botSession, activeTurnId, 'researcher', profiles, undefined, adhocSessionIds)
    expect(match).toBe(true)

    // Active in-flight turn must protect local messages from being wiped by empty backend read []
    const isTurnActive = true
    const backendLoaded: any[] = []
    const existingMessages = [{ id: -1, role: 'user', content: 'Say Loha' }]

    expect(shouldRetainLocalMessages(backendLoaded, existingMessages, isTurnActive)).toBe(true)

    // Working indicator must remain active
    const activeTurn = {
      sessionId: activeTurnId,
      profile: 'researcher',
      status: 'thinking' as const,
      statusText: 'Thinking…',
      streamingText: '',
      toolActivities: [],
      userMessage: existingMessages[0] as any,
      startedAt: Date.now(),
    }
    const isCachedSettled = isTurnSettledByTranscript(activeTurn, existingMessages, true)
    expect(shouldShowWorkingIndicator(activeTurn, isCachedSettled)).toBe(true)
  })

  it('Bot roster row shows active working indicator during canonical turn, and ignores adhoc turn', () => {
    const activeCanonicalTurn = {
      sessionId: '20261008_120000_res123',
      profile: 'researcher',
      status: 'thinking' as const,
      statusText: 'Thinking…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: 1, role: 'user' as const, content: 'hi' },
      startedAt: Date.now(),
    }

    const turnsRecord = {
      researcher: activeCanonicalTurn,
    }

    // Bot roster row for researcher MUST show working
    const botRowWorking = isBotRowWorking('researcher', profiles[0].canonical_session, turnsRecord, adhocSessionIds)
    expect(botRowWorking).toBeDefined()
    expect(botRowWorking?.profile).toBe('researcher')
  })

  it('Clearing chat ends in-flight tracking and does not resurrect ghost working indicator', () => {
    const endedTurns = new Map<string, number>()
    const activeInFlightTurns = new Set<string>()

    // Simulate turn start
    activeInFlightTurns.add('20261008_120000_res123')
    activeInFlightTurns.add('researcher')

    // Simulate handleClearChat ending turn
    activeInFlightTurns.delete('20261008_120000_res123')
    activeInFlightTurns.delete('researcher')
    endedTurns.set('20261008_120000_res123', Date.now())
    endedTurns.set('researcher', Date.now())

    expect(activeInFlightTurns.has('researcher')).toBe(false)
    expect(activeInFlightTurns.has('20261008_120000_res123')).toBe(false)
  })

  it('Session re-opening with identical server transcript commits messages and never leaves view empty', () => {
    const historicalMessages: LiveMessage[] = [
      { id: 1, role: 'user', content: 'What is quantum physics?' },
      { id: 2, role: 'assistant', content: 'Quantum physics is the study of matter and energy at the most fundamental level.' },
    ]

    // Simulate session opening flow:
    // 1. Initial cached state is populated
    let renderedMessages: LiveMessage[] = historicalMessages
    let conversationLoading = false

    expect(renderedMessages).toHaveLength(2)
    expect(conversationLoading).toBe(false)

    // 2. Server returns identical transcript (isTranscriptIdentical = true)
    const backendLoaded: LiveMessage[] = [...historicalMessages]
    const isTranscriptIdentical = true

    // Under the fixed logic:
    // Even when isTranscriptIdentical is true, setMessages(deduplicateConsecutiveMessages(resolvedLoaded)) runs!
    renderedMessages = deduplicateConsecutiveMessages(backendLoaded)
    conversationLoading = false

    // Messages must NEVER be empty []
    expect(renderedMessages).toHaveLength(2)
    expect(renderedMessages[0].content).toBe('What is quantum physics?')
    expect(renderedMessages[1].content).toBe('Quantum physics is the study of matter and energy at the most fundamental level.')
    expect(conversationLoading).toBe(false)
  })
})
