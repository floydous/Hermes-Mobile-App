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

  it('strips background process notices cleanly even with nested brackets inside command and output', () => {
    const rawWithNestedBrackets = `Hasil proses:

[IMPORTANT: Background process proc_9988 exited (exit code 0).
Command: python3 test.py --options [debug, verbose]
Output:
Agama: LKS [BELUM SELESAI]
PPKWU: Tugas [SELESAI]
]

Selesai diproses.`

    const { clean, notices } = stripBackgroundProcessNotices(rawWithNestedBrackets)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('proc_9988')
    expect(clean).toBe('Hasil proses:\n\nSelesai diproses.')
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

    // Renders agent delegation structure with clean minimal header
    expect(html).toContain('agent-dispatch-bubble')
    expect(html).toContain('@hermes')
    expect(html).toContain('Tolong carikan tugas saya.')

    // Must NOT render human user bubble or Edit button
    expect(html).not.toContain('user-bubble')
    expect(html).not.toContain('>Edit<')
  })

  it('renders sender bot profile avatar in dispatch bubble when profile is available', () => {
    const delegationMessage = {
      id: 10,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Delegated query',
    }
    // Real roster: the primary Bot's profile name is `default`, not its handle.
    const profiles = [
      {
        name: 'default',
        display_name: 'Hermes Agent',
        has_avatar: false,
        ui_meta: { 'hermes-bots': { shape: 'squircle', color: '#7170ff' } },
      },
    ]

    const html = renderToString(
      <MessageCard
        message={delegationMessage}
        onEdit={vi.fn()}
        profiles={profiles as any}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    expect(html).toContain('agent-dispatch-avatar')
    expect(html).toContain('bot-avatar-dispatch')
    expect(html).toContain('bot-avatar-svg')
    expect(html).toContain('fill="#7170ff"')
  })

  it('resolves sender profile via display_name fallback and renders initials when unknown', () => {
    const delegationMessage = {
      id: 11,
      role: 'user' as const,
      content: 'Message from 🤖 Dr. Research (@research-agent): Results are ready',
    }
    const profiles = [
      {
        name: 'researcher',
        display_name: 'Dr. Research',
        has_avatar: false,
        ui_meta: { 'hermes-bots': { shape: 'squircle', color: '#10b981' } },
      },
    ]

    // Case A: Resolves via display_name fallback
    const matchedHtml = renderToString(
      <MessageCard
        message={delegationMessage}
        onEdit={vi.fn()}
        profiles={profiles as any}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(matchedHtml).toContain('bot-avatar-dispatch')
    expect(matchedHtml).toContain('fill="#10b981"')

    // Case B: Unknown profile falls back to initials
    const unknownHtml = renderToString(
      <MessageCard
        message={delegationMessage}
        onEdit={vi.fn()}
        profiles={[]}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(unknownHtml).toContain('bot-avatar-dispatch')
    expect(unknownHtml).toContain('avatar-fallback')
    expect(unknownHtml).toContain('RA') // Initials for 'research-agent' ('R' and 'A')
  })

  it('renders the default profile avatar for a task dispatched to another Bot', () => {
    // Regression: the dispatch card rendered a black initials square because the
    // @hermes handle never matched the default profile's name.
    const delegationMessage = {
      id: 12,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Please list all of the user\u2019s current tasks/homework.',
    }
    const profiles = [
      { name: 'default', has_avatar: false, ui_meta: { 'hermes-bots': { shape: 'blobatar' } } },
      { name: 'homework-manager', display_name: 'Homework Manager', has_avatar: false },
    ]

    const html = renderToString(
      <MessageCard
        message={delegationMessage}
        onEdit={vi.fn()}
        profiles={profiles as any}
        fallbackName="homework-manager"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Resolves the sender to the default profile and renders its real avatar SVG
    expect(html).toContain('bot-avatar-svg')
    expect(html).toContain('<svg')
    // The initials fallback square is not used for a resolvable profile
    expect(html).not.toContain('avatar-fallback bot-avatar-slot')
    expect(html).not.toContain('>H<')
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
    expect(html).not.toContain('agent-dispatch-bubble')
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

  it('renders collapsible dispatched task with fade mask and toggle button for long descriptions', () => {
    const longDelegation = {
      id: 5,
      role: 'user' as const,
      content: `Message from 🤖 hermes (@hermes): Line 1: Check the task list
Line 2: Verify homework status
Line 3: Collect items for Agama
Line 4: Collect items for B. Bali
Line 5: Check presentation notes`,
    }

    const html = renderToString(
      <MessageCard
        message={longDelegation}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    expect(html).toContain('agent-dispatch-bubble')
    expect(html).toContain('is-collapsed')
    expect(html).toContain('agent-dispatch-fade')
    expect(html).toContain('agent-dispatch-toggle')
    expect(html).toContain('Show more')
  })

  it('renders tree branch for running tool status and completed task state', () => {
    const delegationMsg = {
      id: 6,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Retrieve school tasks',
    }

    // Case A: Running turn with live tool status
    const runningHtml = renderToString(
      <MessageCard
        message={delegationMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        isActiveTurn={true}
        activeToolStatus="Using search_files · 2 tool calls completed…"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(runningHtml).toContain('dispatch-child-branch')
    expect(runningHtml).toContain('dispatch-branch-stem')
    expect(runningHtml).toContain('└')
    expect(runningHtml).toContain('Using search_files · 2 tool calls completed…')

    // Case B: Completed turn (status in bottom footer)
    const completedHtml = renderToString(
      <MessageCard
        message={delegationMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        isCompleted={true}
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(completedHtml).toContain('agent-dispatch-footer')
    expect(completedHtml).toContain('agent-dispatch-status completed')
    expect(completedHtml).toContain('Completed')
    expect(completedHtml).not.toContain('dispatch-child-branch')
  })

  it('classifies task checklist delivery on Default profile as agent result instead of human user bubble', () => {
    const prevAssistantMsg = {
      id: 7,
      role: 'assistant' as const,
      content: 'I have sent a request to @homework-manager asking for the complete list of tasks.',
    }
    const incomingChecklistMsg = {
      id: 8,
      role: 'user' as const,
      content: `Agama: LKS Halaman 17 (PG dan essay) [BELUM SELESAI]
B. Bali: Latihan Presentasi Cerita Video 1 dan 2 [BELUM SELESAI]
PPKWU: Essay Akuntansi di kertas double folio [BELUM SELESAI]
PPKWU / TKA: Ulangan PPKWU (50 Soal) & Tes TKA [BELUM SELESAI]
Agama: Rangkuman Materi Moksa hal. 22-35 ke PPT [BELUM SELESAI]`,
    }

    const profiles = [
      { name: 'homework-manager', display_name: 'Homework Manager' },
    ]

    const html = renderToString(
      <MessageCard
        message={incomingChecklistMsg}
        previousMessage={prevAssistantMsg}
        profiles={profiles as any}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Must be rendered as agent delegation bubble from homework-manager
    expect(html).toContain('agent-dispatch-bubble')
    expect(html).toContain('@homework-manager')
    expect(html).toContain('Agama: LKS Halaman 17')
    expect(html).toContain('hal. 22-35 ke PPT')

    // Must NOT extract PPT or fallback agent as the sender handle
    expect(html).not.toContain('@PPT')
    expect(html).not.toContain('@agent')

    // Must NOT be rendered as a human user bubble or have Edit button
    expect(html).not.toContain('user-bubble')
    expect(html).not.toContain('>Edit<')
  })

  it('never classifies assistant message as a dispatched task even if it mentions other bots (negative test)', () => {
    const assistantReply = {
      id: 88,
      role: 'assistant' as const,
      content: `Pesan balasan sudah dikirimkan langsung ke @hermes via message_agent berisi daftar lengkap seluruh tugas sekolah yang tercatat pada /home/floydyra/Dokumen/Tugas_Sekolah/CHECKLIST_TUGAS.md.`,
    }

    const html = renderToString(
      <MessageCard
        message={assistantReply}
        onEdit={vi.fn()}
        fallbackName="homework-manager"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Must be rendered as a standard assistant message, NOT an incoming dispatched task
    expect(html).toContain('assistant-bubble')
    expect(html).not.toContain('agent-dispatch-bubble')
    expect(html).not.toContain('agent-dispatch-handle')
    expect(html).not.toContain('@PPT')
    expect(html).not.toContain('@agent')
  })

  it('preserves human user bubble for locally typed checklist messages (negative test)', () => {
    const prevAssistantMsg = {
      id: 9,
      role: 'assistant' as const,
      content: 'I have sent a request to @homework-manager asking for the complete list of tasks.',
    }
    const localHumanChecklist = {
      id: -123,
      role: 'user' as const,
      local: true, // Typed by human user in this app
      content: `Agama: LKS Halaman 17 [BELUM SELESAI]`,
    }

    const html = renderToString(
      <MessageCard
        message={localHumanChecklist}
        previousMessage={prevAssistantMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Must be rendered as regular human user bubble with Edit button
    expect(html).toContain('user-bubble')
    expect(html).toContain('>Edit<')
    expect(html).not.toContain('agent-dispatch-bubble')
  })

  it('preserves human user bubble for checklist when previous assistant message did not dispatch (negative test)', () => {
    const prevAssistantMsg = {
      id: 10,
      role: 'assistant' as const,
      content: 'Here is some general advice on managing your study habits.',
    }
    const normalHumanChecklist = {
      id: 11,
      role: 'user' as const,
      content: `Agama: LKS Halaman 17 [BELUM SELESAI]`,
    }

    const html = renderToString(
      <MessageCard
        message={normalHumanChecklist}
        previousMessage={prevAssistantMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )

    // Must be rendered as regular human user bubble with Edit button
    expect(html).toContain('user-bubble')
    expect(html).toContain('>Edit<')
    expect(html).not.toContain('agent-dispatch-bubble')
  })

  it('correctly scopes running status to the active dispatch and marks historical dispatches as completed', () => {
    const historicalDispatch = {
      id: 12,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Old task from earlier',
    }
    const currentDispatch = {
      id: 14,
      role: 'user' as const,
      content: 'Message from 🤖 hermes (@hermes): Current active task',
    }

    // Historical dispatch has an assistant reply after it -> completed status in footer
    const htmlHist = renderToString(
      <MessageCard
        message={historicalDispatch}
        onEdit={vi.fn()}
        fallbackName="default"
        isCompleted={true}
        isActiveTurn={false}
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(htmlHist).toContain('agent-dispatch-footer')
    expect(htmlHist).toContain('agent-dispatch-status completed')
    expect(htmlHist).toContain('Completed')
    expect(htmlHist).not.toContain('dispatch-child-branch')

    // Current dispatch is the active turn -> running with tool status on branch
    const htmlCurr = renderToString(
      <MessageCard
        message={currentDispatch}
        onEdit={vi.fn()}
        fallbackName="default"
        isCompleted={false}
        isActiveTurn={true}
        activeToolStatus="Using web_search · 1 tool call…"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(htmlCurr).toContain('dispatch-child-branch')
    expect(htmlCurr).toContain('Using web_search · 1 tool call…')
    expect(htmlCurr).not.toContain('agent-dispatch-status completed')
  })

  it('suppresses internal background process completion rows and hidden scaffolding from rendering', () => {
    // Case A: Row marked display_kind: process_complete
    const processCompleteMsg = {
      id: 20,
      role: 'user' as const,
      content: 'Process output text',
      display_kind: 'process_complete',
    }
    const htmlA = renderToString(
      <MessageCard
        message={processCompleteMsg as any}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(htmlA).toBe('')

    // Case B: Row containing pure [IMPORTANT: Background process ...] envelope
    const rawEnvelopeMsg = {
      id: 21,
      role: 'user' as const,
      content: `[IMPORTANT: Background process proc_347d31e60217 completed normally (exit code 0).
Command: /home/floydyra/.hermes/tools/python3 /home/floydyra/.hermes/hermes-agent/tools/bot_mode_dm.py --run-delivery ...
Output:
Penyampaian informasi daftar tugas ke @hermes telah selesai diproses.
]`,
    }
    const htmlB = renderToString(
      <MessageCard
        message={rawEnvelopeMsg}
        onEdit={vi.fn()}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={vi.fn()}
      />
    )
    expect(htmlB).toBe('')
    expect(htmlB).not.toContain('@agent')
  })
})
