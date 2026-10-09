import { describe, expect, it } from 'vitest'
import { buildBotRows, cleanPreviewSnippet, resolveCanonicalSessionId } from './live-model'

describe('live Hermes Bot roster', () => {
  it('uses each profile canonical Bot Chat, never its newest unrelated session', () => {
    const rows = buildBotRows([
      { name: 'gaetan', canonical_session: { id: 'bot', preview: 'Current Bot reply', last_active: 500 }, last_session: { id: 'cron', preview: 'Old cron text', last_active: 900 } },
      { name: 'hermes-mobile-app', canonical_session: { id: 'mobile', preview: 'Current user turn', last_active: 1000 }, last_session: { id: 'scratch', preview: 'Old scratch turn', last_active: 300 } },
    ])
    expect(rows.map(row => row.profile.name)).toEqual(['hermes-mobile-app', 'gaetan'])
    expect(rows[1].session?.preview).toBe('Current Bot reply')
    expect(rows[1].session?.id).toBe('bot')
  })

  it('uses the resolved persisted lineage tip for compressed canonical chat navigation', () => {
    expect(resolveCanonicalSessionId({ id: 'stored-bot-chat', resolved_id: 'lineage-tip-42' })).toBe('lineage-tip-42')
  })

  it('updates bot row preview and last_active when sessions has newer activity for that bot', () => {
    const profiles = [
      { name: 'homework-manager', canonical_session: { id: 'hm-bot', preview: 'Initial welcome', last_active: 100 } },
      { name: 'default', canonical_session: { id: 'def-bot', preview: 'Initial default', last_active: 50 } },
    ]
    const liveSessions = [
      { id: 'hm-bot', profile: 'homework-manager', preview: 'Daftar tugas sekolah terbaru: Agama, PPKWU...', last_active: 500, title: 'Bot Chat' },
    ]

    const rows = buildBotRows(profiles, liveSessions)
    // homework-manager has newer activity (500 > 50), floats to top
    expect(rows[0].profile.name).toBe('homework-manager')
    // Preview is updated to the actual latest message from sessions!
    expect(rows[0].session?.preview).toBe('Daftar tugas sekolah terbaru: Agama, PPKWU...')
    expect(rows[0].session?.id).toBe('hm-bot')
    expect(rows[0].session?.last_active).toBe(500)
    // default retains its canonical session preview
    expect(rows[1].session?.preview).toBe('Initial default')
  })

  it('synchronizes session id and resolved_id when sessions contains a newer active session for the bot', () => {
    const profiles = [
      { name: 'homework-manager', canonical_session: { id: 'hm-old', preview: 'Old', last_active: 10 } },
    ]
    const liveSessions = [
      { id: 'hm-session-99', profile: 'homework-manager', preview: 'Latest query', last_active: 999, resolved_id: 'hm-tip-99', title: 'Bot Chat' },
    ]

    const rows = buildBotRows(profiles, liveSessions)
    // ID must match the active session that holds the preview so tapping opens the right chat!
    expect(rows[0].session?.id).toBe('hm-session-99')
    expect(rows[0].session?.resolved_id).toBe('hm-tip-99')
    expect(rows[0].session?.preview).toBe('Latest query')
  })

  it('never allows an unrelated session to displace the canonical Bot Chat', () => {
    const profiles = [
      { name: 'homework-manager', canonical_session: { id: 'hm-bot', preview: 'Bot Chat preview', last_active: 100 } },
    ]
    const liveSessions = [
      { id: 'hm-scratchpad', profile: 'homework-manager', title: 'Scratchpad notes', preview: 'Temporary scratchpad', last_active: 99999 },
    ]

    const rows = buildBotRows(profiles, liveSessions)
    // Unrelated session must not displace canonical Bot Chat!
    expect(rows[0].session?.id).toBe('hm-bot')
    expect(rows[0].session?.preview).toBe('Bot Chat preview')
    expect(rows[0].session?.last_active).toBe(100)
  })

  it('clears stale resolved_id when updated session does not have one', () => {
    const profiles = [
      { name: 'homework-manager', canonical_session: { id: 'hm-old', resolved_id: 'stale-tip-123', preview: 'Old', last_active: 10 } },
    ]
    const liveSessions = [
      { id: 'hm-fresh', profile: 'homework-manager', title: 'Bot Chat', preview: 'Fresh message', last_active: 200 },
    ]

    const rows = buildBotRows(profiles, liveSessions)
    expect(rows[0].session?.id).toBe('hm-fresh')
    expect(rows[0].session?.resolved_id).toBeUndefined()
  })

  it('cleans raw protocol stamps in preview snippets via cleanPreviewSnippet', () => {
    const rawStamp = 'Message from 🤖 hermes (@hermes): Hi @homework-manager, please provide the task list'
    expect(cleanPreviewSnippet(rawStamp)).toBe('@hermes: Hi @homework-manager, please provide the task list')

    const rawPlain = 'Halo! Ini rangkuman tugas kamu hari ini.'
    expect(cleanPreviewSnippet(rawPlain)).toBe('Halo! Ini rangkuman tugas kamu hari ini.')

    expect(cleanPreviewSnippet('')).toBe('')
    expect(cleanPreviewSnippet(null)).toBe('')
  })
})
