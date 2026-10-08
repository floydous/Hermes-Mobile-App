import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

import {
  MessageCard,
  parseAgentDelegation,
  stripAttachedContextScaffolding,
  stripBackgroundProcessNotices,
} from './components/MarkdownContent'

describe('Agent Delegation & Background Process Parsing', () => {
  it('parses inter-agent delegation messages with emoji, display name and handle', () => {
    const raw = 'Message from 🤖 hermes (@hermes): Halo! Bisakah kamu memberikan ringkasan atau daftar lengkap tugas sekolah?'
    const result = parseAgentDelegation(raw)

    expect(result).not.toBeNull()
    expect(result?.senderName).toBe('hermes')
    expect(result?.handle).toBe('hermes')
    expect(result?.body).toBe('Halo! Bisakah kamu memberikan ringkasan atau daftar lengkap tugas sekolah?')
  })

  it('parses multi-agent delegation response from sub-agent', () => {
    const raw = `Message from 🤖 homework-manager (@homework-manager): Halo @hermes. Berikut ringkasan tugas sekolah aktif:
1. Item 4 - Agama
2. Item 5 - B. Bali`
    const result = parseAgentDelegation(raw)

    expect(result).not.toBeNull()
    expect(result?.senderName).toBe('homework-manager')
    expect(result?.handle).toBe('homework-manager')
    expect(result?.body).toContain('Halo @hermes. Berikut ringkasan tugas sekolah aktif:')
    expect(result?.body).toContain('1. Item 4 - Agama')
  })

  it('does not falsely classify normal human user messages as agent delegations', () => {
    expect(parseAgentDelegation('Hello hermes, can you do something for me?')).toBeNull()
    expect(parseAgentDelegation('Message from user: here is my code')).toBeNull()
  })

  it('strips background process notices cleanly from message content', () => {
    const rawWithNotice = `Berikut balasan dari **@homework-manager**:

[IMPORTANT: Background process proc_347d31e60217 completed normally (exit code 0).
Command: /home/floydyra/.hermes/tools/python3 /home/floydyra/.hermes/hermes-agent/tools/bot_mode_dm.py --run-delivery ...
Output:
Penyampaian informasi daftar tugas ke @hermes telah selesai diproses.
]`

    const { clean, notices } = stripBackgroundProcessNotices(rawWithNotice)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('proc_347d31e60217')
    expect(clean).toBe('Berikut balasan dari **@homework-manager**:')
  })

  it('strips both context scaffolding and background process blocks via stripAttachedContextScaffolding', () => {
    const mixed = `Jawaban final untuk pengguna.

--

[IMPORTANT: Background process proc_08584bc2551b completed normally (exit code 0).
Command: /home/floydyra/tools/bot_mode_dm.py
Output:
{"reply": "test", "status": "settled"}
]

--- Attached Context ---
@file:/home/floydyra/document.txt`

    const cleaned = stripAttachedContextScaffolding(mixed)
    expect(cleaned).toBe('Jawaban final untuk pengguna.')
    expect(cleaned).not.toContain('proc_08584bc2551b')
    expect(cleaned).not.toContain('--- Attached Context ---')
  })

  it('renders MessageCard with agent delegation card and suppresses Edit button for bot-to-bot messages', () => {
    const delegationMessage = {
      id: 1,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Tolong carikan tugas saya.',
    }

    const html = renderToString(
      <MessageCard
        message={delegationMessage}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Renders agent delegation structure
    expect(html).toContain('agent-delegation-card')
    expect(html).toContain('@hermes')
    expect(html).toContain('Agent Dispatch')
    expect(html).toContain('Tolong carikan tugas saya.')

    // Must NOT render human user bubble or Edit button
    expect(html).not.toContain('user-bubble')
    expect(html).not.toContain('>Edit<')
  })

  it('renders standard user bubble with Edit button for regular human messages', () => {
    const humanMessage = {
      id: 2,
      role: 'user' as const,
      content: 'Halo hermes, tolong buatkan ringkasan.',
    }

    const html = renderToString(
      <MessageCard
        message={humanMessage}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    expect(html).toContain('user-bubble')
    expect(html).toContain('>Edit<')
    expect(html).not.toContain('agent-delegation-card')
  })

  it('renders assistant message with background process notices stripped end-to-end', () => {
    const assistantMsg = {
      id: 3,
      role: 'assistant' as const,
      content: 'Ini adalah rekap tugas Anda.\n\n[IMPORTANT: Background process proc_999 completed normally (exit code 0).\nCommand: python3 test.py\nOutput:\nDone\n]',
    }

    const html = renderToString(
      <MessageCard
        message={assistantMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    expect(html).toContain('Ini adalah rekap tugas Anda.')
    expect(html).not.toContain('proc_999')
    expect(html).not.toContain('[IMPORTANT: Background process')
  })
})
