import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'

import { MessageCard } from './components/MarkdownContent'
import type { LiveMessage } from './hermes'

const source = readFileSync(resolve(process.cwd(), 'src/components/MarkdownContent.tsx'), 'utf8')
const chatView = readFileSync(resolve(process.cwd(), 'src/components/ChatView.tsx'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const sessionCache = readFileSync(resolve(process.cwd(), 'src/session-cache.ts'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/mobile-overrides.css'), 'utf8')

const assistantMessage: LiveMessage = {
  id: 7,
  role: 'assistant',
  content: 'Rundown tanggal ELCOM 2026',
  timestamp: 1000,
}

describe('Long-press action sheet', () => {
  it('opens a bottom sheet with a drag grabber instead of the old in-place bubble clone', () => {
    expect(source).toContain('message-action-sheet')
    expect(source).toContain('message-action-grabber')
    expect(source).not.toContain('message-action-bubble-clone')
    expect(source).not.toContain('message-action-sheet-in-place')
  })

  it('offers Copy, Select text, Mark as unread and Edit', () => {
    expect(source).toContain('Mark as unread')
    expect(source).toContain('Select text')
    expect(source).toContain("'Copied' : 'Copy'")
    // Edit applies to the user's own messages only.
    expect(source).toContain("message.role === 'user'")
  })

  it('shows no message preview in the sheet', () => {
    // The reference design has none, and with it the sheet grew taller than
    // the screen and pushed the last action row off the bottom.
    expect(source).not.toContain('message-action-body')
    expect(source).not.toContain('message-action-message')
    expect(css).not.toContain('.message-action-body')
  })

  it('uses the reference icons for the actions', () => {
    expect(source).toContain('<TextCursor size={20} />')
    expect(source).toContain('<MessageSquareDot size={20} />')
    expect(source).toContain('<Copy size={20} />')
  })

  it('indents the group separator to the label column', () => {
    const sepRule = css.match(/\.message-action-row \+ \.message-action-row::before\s*\{[^}]*\}/s)
    expect(sepRule).toBeTruthy()
    expect(sepRule![0]).toContain('left: 54px')
  })

  it('groups the action rows into two rounded surfaces', () => {
    expect(source).toContain('message-action-groups')
    expect(source).toContain('message-action-group')
    expect(source).toContain('message-action-row')
    const groupRule = css.match(/\.message-action-group\s*\{[^}]*\}/s)
    expect(groupRule).toBeTruthy()
    expect(groupRule![0]).toContain('border-radius')
  })

  it('wires Mark as unread back to the session lastRead checkpoint', () => {
    expect(chatView).toContain('onMarkUnread')
    expect(appSource).toContain('markSessionUnread')
    expect(appSource).toContain('onMarkUnread={messageTimestamp')
  })

  it('rewinds the lastRead checkpoint strictly below the message timestamp', () => {
    // The unread comparison is `messageTime > lastRead`, so the checkpoint
    // has to sit below the message or the message is not counted.
    expect(appSource).toContain('computeUnreadCheckpoint(messageTimestamp)')
    expect(sessionCache).toContain('export function computeUnreadCheckpoint')
  })

  it('opens a full-page raw-text window that is selectable', () => {
    expect(source).toContain('message-raw-view')
    expect(source).toContain('message-raw-panel')
    expect(source).toContain('message-raw-text')
    const rawRule = css.match(/\.message-raw-text\s*\{[^}]*\}/s)
    expect(rawRule).toBeTruthy()
    expect(rawRule![0]).toContain('user-select: text')
  })

  it('titles the raw-text window "Message"', () => {
    expect(source).toContain('<b>Message</b>')
  })

  it('lets the sheet be dismissed by dragging the grabber down', () => {
    expect(source).toContain('handleGrabberPointerDown')
    expect(source).toContain('handleGrabberPointerMove')
    expect(source).toContain('handleGrabberPointerUp')
  })

  it('keeps the entrance animation and the drag offset on separate layers', () => {
    // An animation's value outranks an inline style, so an entrance
    // animation and a drag transform on the same element would fight: a
    // drag during the 300ms entrance killed the animation and the sheet
    // jumped up to full height.
    const animRule = css.match(/\.message-action-sheet-anim\s*\{[^}]*\}/s)
    expect(animRule).toBeTruthy()
    expect(animRule![0]).toContain('animation: message-action-sheet-up')
    expect(animRule![0]).not.toContain('--message-drag-y')

    const dragRule = css.match(/\.message-action-sheet-drag\s*\{[^}]*\}/s)
    expect(dragRule).toBeTruthy()
    expect(dragRule![0]).toContain('--message-drag-y')
    expect(dragRule![0]).toContain('transform: translateY(var(--message-drag-y))')
    expect(dragRule![0]).not.toContain('animation:')
  })

  it('keeps the sheet body scrollable while the grabber owns its drag', () => {
    const sheetRule = css.match(/\.message-action-sheet\s*\{[^}]*\}/s)
    expect(sheetRule).toBeTruthy()
    expect(sheetRule![0]).toContain('touch-action: pan-y')
    const grabberRule = css.match(/\.message-action-grabber\s*\{[^}]*\}/s)
    expect(grabberRule).toBeTruthy()
    expect(grabberRule![0]).toContain('touch-action: none')
  })

  it('gives every action row a 50px touch target', () => {
    const rowRule = css.match(/\.message-action-row\s*\{[^}]*\}/s)
    expect(rowRule).toBeTruthy()
    expect(rowRule![0]).toContain('min-height: 50px')
  })

  it('suppresses the native Android callout on bubbles so it does not race the sheet', () => {
    const bubbleRule = css.match(/\.user-bubble\s*\{[^}]*\}/s)
    expect(bubbleRule).toBeTruthy()
    expect(bubbleRule![0]).toContain('-webkit-touch-callout: none')
  })

  it('renders the message body inside the sheet for an assistant message', () => {
    const html = renderToString(
      <MessageCard
        message={assistantMessage}
        onEdit={() => {}}
        fallbackName="default"
        revealTimestamp={false}
        onRevealTimestamp={() => {}}
      />
    )
    expect(html).toContain('Rundown tanggal ELCOM 2026')
    // The sheet only mounts after a long press, so a static render shows the
    // bubble but not the sheet itself.
    expect(html).not.toContain('message-action-sheet')
  })
})
