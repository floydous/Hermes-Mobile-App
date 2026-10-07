import { describe, expect, it } from 'vitest'

import { attachmentSummary, buildAttachmentPrompt } from './attachment-routing'

describe('attachment routing', () => {
  const attachment = { name: 'notes.pdf', refText: '@file:attachments/notes.pdf' }

  it('sends Hermes file refs before the user text', () => {
    expect(buildAttachmentPrompt('Summarize this.', [attachment])).toBe('@file:attachments/notes.pdf\n\nSummarize this.')
  })

  it('supports attachment-only turns', () => {
    expect(buildAttachmentPrompt('', [attachment])).toBe('@file:attachments/notes.pdf')
    expect(attachmentSummary('', [attachment])).toBe('Attached: notes.pdf')
  })

  it('includes attachments alongside user prompt text', () => {
    expect(attachmentSummary('Please summarize this.', [attachment])).toBe('Please summarize this.\n\nAttached: notes.pdf')
  })

  it('does not create blank separators for empty refs', () => {
    expect(buildAttachmentPrompt('Read it.', [{ name: 'bad', refText: ' ' }])).toBe('Read it.')
  })
})
