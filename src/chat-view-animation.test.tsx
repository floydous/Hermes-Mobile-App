import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

import { ChatView } from './components/ChatView'
import type { LiveMessage, LiveProfile, LiveSession } from './hermes'
import type { ToolActivity } from './chat-turn'

describe('ChatView live animation rendering', () => {
  const baseSession: LiveSession = {
    id: 'test-session-1',
    profile: 'homework-manager',
    title: 'Homework Chat',
    preview: 'Latest message',
    last_active: 1000,
  }

  const baseProfiles: LiveProfile[] = [
    {
      name: 'homework-manager',
      display_name: 'Homework Manager',
      has_avatar: false,
    },
  ]

  const historicalMessages: LiveMessage[] = [
    { id: 1, role: 'user', content: 'What is homework today?', timestamp: 100 },
    { id: 2, role: 'assistant', content: 'Math page 42.', timestamp: 105 },
  ]

  const defaultProps = {
    session: baseSession,
    conversationLoading: false,
    messages: historicalMessages,
    settledAssistant: null,
    profiles: baseProfiles,
    streaming: '',
    sending: false,
    toolActivities: [] as ToolActivity[],
    error: '',
    back: vi.fn(),
    refresh: vi.fn(),
    clearChat: vi.fn(),
    openProfile: vi.fn(),
    onSessionModelChange: vi.fn(),
    submit: vi.fn(),
    submitVoice: vi.fn(),
    stop: vi.fn(),
  }

  it('renders typing indicator when sending with active tools even if transcript ends with earlier assistant reply', () => {
    const runningTools: ToolActivity[] = [
      { id: 'tool-1', name: 'search_files', status: 'running' },
    ]

    const html = renderToString(
      <ChatView
        {...defaultProps}
        sending={true}
        toolActivities={runningTools}
      />
    )

    // The live typing response layout must be rendered
    expect(html).toContain('live-response')
    expect(html).toContain('typing-indicator')
    expect(html).toContain('Using search_files…')
  })

  it('renders typing wave for dispatched task when entered from Bots roster', () => {
    const delegationTools: ToolActivity[] = [
      {
        id: 'delegation-1',
        name: 'Dispatched Task',
        status: 'running',
        summary: 'Working on task from @default',
      },
    ]

    const html = renderToString(
      <ChatView
        {...defaultProps}
        sending={true}
        toolActivities={delegationTools}
      />
    )

    expect(html).toContain('live-response')
    expect(html).toContain('typing-indicator')
    expect(html).toContain('Working on task from @default…')
  })

  it('renders initial dynamic spinner phrase (Collection 1) when sending without tools', () => {
    const html = renderToString(
      <ChatView
        {...defaultProps}
        sending={true}
        toolActivities={[]}
      />
    )

    expect(html).toContain('live-response')
    expect(html).toContain('typing-indicator')
    expect(html).toMatch(/(?:Digesting|Reading prompt|Pondering|Gathering thoughts|Analyzing|Looking into it|Making sense|Formulating|Brewing|Thinking)…/)
  })

  it('suppresses live typing indicator when turn is settled (sending is false)', () => {
    const html = renderToString(
      <ChatView
        {...defaultProps}
        sending={false}
        toolActivities={[]}
      />
    )

    expect(html).not.toContain('live-response')
    expect(html).not.toContain('typing-indicator')
  })
})
