import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skipCoveredRender } from './page-transition'

const transitionsCss = readFileSync(resolve(process.cwd(), 'src/transitions.css'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const tasksView = readFileSync(resolve(process.cwd(), 'src/components/TasksView.tsx'), 'utf8')
const profileSheet = readFileSync(resolve(process.cwd(), 'src/components/BotProfileSheet.tsx'), 'utf8')

describe('Page transition contract', () => {
  it('slides every page in from the right', () => {
    // The page is pushed in from the right, the way iOS pushes a
    // navigation stack.
    const keyframe = transitionsCss.match(/@keyframes app-page-in\s*\{[\s\S]*?\n\}/)
    expect(keyframe).toBeTruthy()
    expect(keyframe![0]).toContain('translateX(var(--page-slide-in))')
    expect(transitionsCss).toContain('--page-slide-in: 100%')
  })

  it('slides the page out to the right on the way back', () => {
    const keyframe = transitionsCss.match(/@keyframes app-page-exit\s*\{[\s\S]*?\n\}/)
    expect(keyframe).toBeTruthy()
    expect(keyframe![0]).toContain('translateX(var(--page-slide-in))')
  })

  it('hosts a pushed page in a fixed overlay so the page underneath does not reflow', () => {
    const hostRule = transitionsCss.match(/\.page-host\s*\{[^}]*\}/s)
    expect(hostRule).toBeTruthy()
    expect(hostRule![0]).toContain('position: fixed')
    expect(hostRule![0]).toContain('inset: 0')
  })

  it('does not animate the hosted page itself, which would fight the host', () => {
    // The host carries the motion. If the page inside it also animated,
    // the two would compose and the page would travel twice as far.
    const rule = transitionsCss.match(/\.page-host > \.app\s*\{[^}]*\}/s)
    expect(rule).toBeTruthy()
    expect(rule![0]).toContain('animation: none !important')
  })

  it('keeps the pushed page mounted while it slides out', () => {
    // A page unmounted the instant it is asked to close never animates.
    expect(appSource).toContain('usePageExit')
    expect(appSource).toContain('PAGE_EXIT_STATE')
  })

  it('applies the transition to every pushed page', () => {
    // Chat, the create wizard, the bot settings sheet, the task detail
    // and the new task sheet are all pushed pages.
    expect(appSource).toContain('<PageHost state={chatExiting')
    expect(appSource).toContain('<PageHost state={wizardExiting')
    expect(appSource).toContain('<PageHost state={profileExiting')
    expect(tasksView).toContain('<PageHost state={detailExiting')
    expect(tasksView).toContain('<PageHost state={createExiting')
    expect(profileSheet).toContain('<PageHost zIndex={80}>')
  })

  it('routes every back path through the shared closer', () => {
    // The chevron, the hardware back button and the sheet's own close
    // button must all run the same exit animation.
    expect(appSource).toContain('closeChat()')
    expect(appSource).toContain('closeProfile()')
    expect(appSource).toContain('closeWizard()')
  })

  it('disables the transition under reduced motion', () => {
    const reduced = transitionsCss.slice(transitionsCss.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.page-host')
    expect(reduced).toContain('animation: none !important')
  })

  it('skips covered re-renders only while the page stays covered', () => {
    // Streaming re-renders App per token; the roster under the chat must sit
    // those out, but render again the moment the chat starts sliding away.
    expect(skipCoveredRender({ covered: true }, { covered: true })).toBe(true)
    expect(skipCoveredRender({ covered: true }, { covered: false })).toBe(false)
    expect(skipCoveredRender({ covered: false }, { covered: true })).toBe(false)
    expect(skipCoveredRender({ covered: false }, { covered: false })).toBe(false)
    expect(appSource).toContain('const rosterCovered = (Boolean(selected) && !chatExiting) || (createOpen && !wizardExiting)')
    expect(appSource).toContain('<FreezeWhileCovered covered={rosterCovered}>')
  })

  it('stacks pushed pages on top of the page they came from', () => {
    // Returning a pushed page instead of the tree unmounts the page underneath:
    // going back then shows an empty screen while it is rebuilt from scratch.
    expect(appSource).not.toMatch(/if \(createOpen\) return/)
    expect(appSource).not.toMatch(/if \(selected && profileSheet\) return/)
    // Same for Tasks: the list stays mounted under Task Details and New Task.
    expect(tasksView).not.toMatch(/if \(selected\) \{\s*return/)
    expect(tasksView).not.toMatch(/if \(isCreateOpen\) \{\s*return/)
    expect(appSource).toContain("className={chatCovered ? 'is-covered' : undefined}")
    // The page underneath only dims; it is never pushed sideways.
    // The dim is an overlay, not a filter: a filter is a full GPU pass per frame on Android.
    const covered = transitionsCss.match(/\.app\.roster-shell\.is-covered::after,\s*\.page-host\.is-covered::after\s*\{[^}]*\}/s)
    expect(covered).toBeTruthy()
    expect(covered![0]).toContain('opacity: 0.3')
    expect(covered![0]).not.toContain('transform')
    expect(transitionsCss).not.toMatch(/is-covered\s*\{[^}]*filter/s)
  })

  it('keeps the chat bundle off the startup path', () => {
    // A static import would put markdown, KaTeX and highlight.js back on launch.
    expect(appSource).not.toMatch(/^import \{ ChatView \}/m)
    expect(appSource).toContain("lazy(() => loadChatView()")
  })

  it('does not keep pages on standing GPU layers', () => {
    const pageRule = transitionsCss.match(/\n\.app\s*\{[^}]*\}/s)
    const hostRule = transitionsCss.match(/\.page-host\s*\{[^}]*\}/s)
    expect(pageRule![0]).not.toContain('will-change')
    expect(hostRule![0]).not.toContain('will-change')
  })

  it('does not use a vertical slide for page transitions', () => {
    // The old transition slid pages up from below. Every page transition
    // is horizontal now.
    const pageKeyframes = transitionsCss.match(/@keyframes app-(?:page|subpage|roster)-[a-z]+\s*\{[\s\S]*?\n\}/g) || []
    expect(pageKeyframes.length).toBeGreaterThan(0)
    for (const frame of pageKeyframes) {
      expect(frame).not.toContain('translateY')
    }
  })
})
