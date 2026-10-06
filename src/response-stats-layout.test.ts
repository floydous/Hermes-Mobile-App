import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatCss = readFileSync(resolve(process.cwd(), 'src/chat.css'), 'utf8')
const chatView = readFileSync(resolve(process.cwd(), 'src/components/ChatView.tsx'), 'utf8')

describe('response stats layout contract', () => {
  it('reserves exactly one clipped line for terminal metadata without an animation', () => {
    expect(chatCss).toContain('.response-stats{height:16px;min-width:0;margin-top:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#757a83;font-size:10px;line-height:16px;letter-spacing:.01em}')
    expect(chatCss).not.toContain('response-stats-in')
  })

  it('keeps completed reply text aligned with its avatar by removing the stream label once text exists', () => {
    expect(chatView).toContain('{sending && !streaming &&')
    expect(chatView).not.toContain('live-label-placeholder')
  })
})
