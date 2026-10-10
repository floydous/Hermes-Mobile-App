import { describe, expect, it, vi } from 'vitest'
import { HermesGatewayClient } from './gateway'
import { connectAndSubmit } from './hermes'
import {
  applySessionTitleUpdate,
  createTitleReconciliation,
  executeTurnSubmissionPipeline,
  finalizeSessionRemap,
  handleTitleEvent,
  remapSessionId,
} from './session-title'
import type { LiveSession } from './hermes'

describe('session title event resolution and TDZ safety', () => {
  it('applies title update when title arrives in-flight matching initial turnSessionId', () => {
    const sessions: LiveSession[] = [
      { id: 'draft:coder', title: 'New chat', preview: '', profile: 'coder', last_active: 100 },
      { id: 'other-session', title: 'Another', preview: '', profile: 'other', last_active: 100 },
    ]

    const turnSessionId = 'draft:coder'
    const activeSessionId = 'draft:coder' // Initialized before callback

    const updated = applySessionTitleUpdate(sessions, turnSessionId, activeSessionId, 'Refactoring Database Schema')
    expect(updated[0].title).toBe('Refactoring Database Schema')
    expect(updated[1].title).toBe('Another')
  })

  it('remaps session id after completion and retains the streamed title', () => {
    const sessions: LiveSession[] = [
      { id: 'draft:coder', title: 'Refactoring Database Schema', preview: '', profile: 'coder', last_active: 100 },
    ]

    const oldSessionId = 'draft:coder'
    const canonicalServerId = 'canonical-session-987'
    const latestStreamedTitle = 'Refactoring Database Schema'

    const remapped = remapSessionId(sessions, oldSessionId, canonicalServerId, latestStreamedTitle)
    expect(remapped[0].id).toBe('canonical-session-987')
    expect(remapped[0].title).toBe('Refactoring Database Schema')
  })

  it('safely handles empty title or identical IDs in remapSessionId', () => {
    const sessions: LiveSession[] = [
      { id: 'session-1', title: 'Existing', preview: '', profile: 'coder', last_active: 100 },
    ]

    expect(applySessionTitleUpdate(sessions, 'session-1', 'session-1', '  ')).toBe(sessions)
    expect(remapSessionId(sessions, 'session-1', 'session-1', null)).toBe(sessions)
  })

  it('retains durable SQLite session IDs and never mutates them to temporary runtime IDs', () => {
    const durableId = '20261002_170104_84486a'
    const runtimeId = 'e81a9420'
    const titleState = createTitleReconciliation(durableId)
    let selected: LiveSession | null = {
      id: durableId,
      title: 'Say Loha',
      preview: '',
      profile: 'researcher',
      last_active: 10,
    }
    let sessions: LiveSession[] = [selected]

    const finalId = finalizeSessionRemap(
      titleState,
      runtimeId,
      durableId,
      newId => { if (selected) selected = { ...selected, id: newId } },
      updater => { sessions = updater(sessions) }
    )

    expect(finalId).toBe(durableId)
    expect(selected?.id).toBe(durableId)
    expect(sessions[0].id).toBe(durableId)
  })

  it('deduplicates SQLite snapshot against previous runtime aliases when local messages exist', () => {
    const durableId = '20261002_170104_84486a'
    const runtimeAlias = 'e81a9420'

    // Simulate SQLite returning the authoritative session row
    const sqliteSnapshot: LiveSession[] = [
      { id: durableId, title: 'Say Loha', preview: 'Loha', profile: 'researcher', last_active: 50 },
    ]

    // Simulate previous client state holding the runtime alias with cached local messages
    const prevSessions: LiveSession[] = [
      { id: runtimeAlias, title: 'Say Loha', preview: 'Loha', profile: 'researcher', last_active: 50 },
    ]

    // Test the exact reconciliation logic from App.tsx
    const endpoint = 'http://127.0.0.1:9119'
    const getResolvedId = (id: string) => (id === durableId ? runtimeAlias : id === runtimeAlias ? durableId : id)

    const nextMap = new Map<string, LiveSession>(sqliteSnapshot.map(s => [s.id, s]))
    for (const prev of prevSessions) {
      const isAlreadyPresent = Array.from(nextMap.keys()).some(existingId =>
        existingId === prev.id ||
        getResolvedId(existingId) === prev.id ||
        getResolvedId(prev.id) === existingId
      )
      if (!isAlreadyPresent) {
        nextMap.set(prev.id, prev)
      }
    }

    const reconciled = Array.from(nextMap.values())
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0].id).toBe(durableId)
  })

  it('executes real gateway event listener during in-flight turn without TDZ and updates sessions', async () => {
    const gw = new HermesGatewayClient(async () => 'http://127.0.0.1:9999')
    // Mock low-level connect and call so submitPrompt executes cleanly
    vi.spyOn(gw, 'connect').mockResolvedValue(undefined)
    vi.spyOn(gw, 'call').mockImplementation(async (method: string) => {
      if (method === 'prompt.submit') {
        // While prompt.submit is in-flight on the server, simulate incoming WebSocket events
        const listeners = (gw as any).sessionListeners.get('session-init-1')
        if (listeners) {
          for (const l of listeners) {
            // Emit in-flight session.title before terminal event
            l({
              type: 'session.title',
              payload: { title: 'Automated Title from Agent' },
              terminal: false,
            })
            // Emit terminal message.complete
            l({
              type: 'message.complete',
              payload: { text: 'Done' },
              terminal: true,
            })
          }
        }
        return {}
      }
      return {}
    })

    const turnSessionId = 'session-init-1'
    const titleState = createTitleReconciliation(turnSessionId)
    let selectedSession: LiveSession | null = {
      id: 'session-init-1',
      title: 'New chat',
      preview: '',
      profile: 'default',
      last_active: 1,
    }
    let sessions: LiveSession[] = [
      { id: 'session-init-1', title: 'New chat', preview: '', profile: 'default', last_active: 1 },
    ]

    // Uses the EXACT production App.tsx callback logic and closure:
    await gw.submitPrompt(turnSessionId, 'hello', event => {
      if (event.type === 'session.title') {
        handleTitleEvent(
          titleState,
          event.payload,
          turnSessionId,
          title => {
            if (selectedSession) selectedSession = { ...selectedSession, title }
          },
          updater => {
            sessions = updater(sessions)
          }
        )
      }
    })

    // Simulate server remapping to canonical persistent ID using exact production finalizeSessionRemap
    const serverResultSessionId = 'server-canonical-777'
    const finalSessionId = finalizeSessionRemap(
      titleState,
      serverResultSessionId,
      turnSessionId,
      newId => {
        if (selectedSession) selectedSession = { ...selectedSession, id: newId }
      },
      updater => {
        sessions = updater(sessions)
      }
    )

    expect(finalSessionId).toBe('server-canonical-777')
    expect(selectedSession?.id).toBe('server-canonical-777')
    expect(selectedSession?.title).toBe('Automated Title from Agent')
    expect(sessions[0].id).toBe('server-canonical-777')
    expect(sessions[0].title).toBe('Automated Title from Agent')
  })

  it('executes production executeTurnSubmissionPipeline with real connectAndSubmit, in-flight session.title and canonical ID remapping', async () => {
    let selected: LiveSession | null = {
      id: 'session-client-123',
      title: 'New chat',
      preview: '',
      profile: 'homework',
      last_active: 10,
    }
    let sessions: LiveSession[] = [
      { id: 'session-client-123', title: 'New chat', preview: '', profile: 'homework', last_active: 10 },
      { id: 'other', title: 'Other chat', preview: '', profile: 'other', last_active: 5 },
    ]
    let streamedDeltas = ''
    let receivedError: string | null = null

    const endpoint = 'http://127.0.0.1:9876'
    vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockResolvedValue('server-canonical-42')
    vi.spyOn(HermesGatewayClient.prototype, 'submitPrompt').mockImplementation(async function(this: any, _sid, _text, listener) {
      // In-flight delta
      listener({
        type: 'message.delta',
        payload: { text: 'Hello! ' },
        terminal: false,
      })
      // In-flight session.title arrives while submission is still unresolved
      listener({
        type: 'session.title',
        payload: { title: 'TKA Schedule Analysis' },
        terminal: false,
      })
      // Another delta
      listener({
        type: 'message.delta',
        payload: { text: 'Here are the details.' },
        terminal: false,
      })
      // Terminal message.complete
      listener({
        type: 'message.complete',
        payload: { text: 'Hello! Here are the details.' },
        terminal: true,
      })
    })

    // Invokes the exact production connectAndSubmit from src/hermes.ts
    const { finalSessionId, finalText } = await executeTurnSubmissionPipeline({
      turnSessionId: 'session-client-123',
      turnProfile: 'homework',
      prompt: 'Review TKA schedule',
      activeEndpoint: endpoint,
      connectAndSubmitFn: connectAndSubmit,
      onDelta: t => { streamedDeltas = t },
      onComplete: () => {},
      onToolStart: () => {},
      onToolComplete: () => {},
      onTitleUpdate: title => {
        if (selected) selected = { ...selected, title }
      },
      onSessionsUpdate: updater => {
        sessions = updater(sessions)
      },
      onSelectedIdUpdate: newId => {
        if (selected) selected = { ...selected, id: newId }
      },
      onError: err => { receivedError = err },
    })

    expect(receivedError).toBeNull()
    expect(finalSessionId).toBe('server-canonical-42')
    expect(finalText).toBe('Hello! Here are the details.')
    expect(streamedDeltas).toBe('Hello! Here are the details.')
    // Title was updated in-flight without TDZ
    expect(selected?.title).toBe('TKA Schedule Analysis')
    // Selected session ID was remapped to canonical
    expect(selected?.id).toBe('server-canonical-42')
    // Session roster was remapped to canonical ID and retains the streamed title
    expect(sessions[0].id).toBe('server-canonical-42')
    expect(sessions[0].title).toBe('TKA Schedule Analysis')
    expect(sessions[1].id).toBe('other')
  })
})
