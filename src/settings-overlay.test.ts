import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const settingsSource = readFileSync(resolve(process.cwd(), 'src/components/ConnectionSettings.tsx'), 'utf8')
const settingsCss = readFileSync(resolve(process.cwd(), 'src/connection-settings.css'), 'utf8')
const baseCss = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const themeCss = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8')
const typeCss = readFileSync(resolve(process.cwd(), 'src/type.css'), 'utf8')
const transitionsCss = readFileSync(resolve(process.cwd(), 'src/transitions.css'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('Settings overlay sheet contract', () => {
  it('renders the root settings sheet without a title or subtitle header', () => {
    expect(settingsSource).not.toContain('title="Connection"')
    expect(settingsSource).not.toContain('subtitle="Hermes Desktop host"')
  })

  it('closes by dragging the grabber rather than a separate close button', () => {
    // The grabber pill is the only element in the grabber row. A close
    // chevron there duplicated the row chevrons and read as two different
    // ways to leave the screen.
    expect(settingsSource).toContain('settings-drag-pill')
    expect(settingsSource).not.toContain('settings-sheet-close')
    expect(settingsSource).not.toContain('ChevronDown')
  })

  it('drops the root-only isRoot header variant', () => {
    expect(settingsSource).not.toContain('isRoot')
  })

  it('removes the unused close-button styles', () => {
    expect(settingsCss).not.toContain('.settings-sheet-close')
  })

  it('removes roster-oriented padding from the sheet content', () => {
    expect(settingsCss).toMatch(/\.settings-modal-scroll\s*>\s*\.app\.panel\s*\{[^}]*padding:/s)
  })

  it('slides sub-pages over the root page instead of pushing it away', () => {
    // A sub-page lands on top of Settings; the root never moves sideways
    // (it only dims), so nothing is pushed off screen.
    expect(settingsSource).not.toContain('translateX(calc(${navOffset}px - 100%))')
    expect(settingsSource).not.toContain('translateX(${-navOffset}px)')
    // The root only ever moves vertically, with the grabber.
    expect(settingsSource).toContain('rootPageRef.current.style.transform = `translateY(${y}px)`')
    expect(settingsCss).toMatch(/\.settings-page-root\.is-covered::after\s*\{[^}]*opacity: 0\.3/s)
  })

  it('opens from the bottom without the app-wide sideways page entrance', () => {
    expect(settingsCss).toMatch(/\.settings-modal-sheet \.app\s*\{[^}]*animation:\s*none/s)
  })

  it('moves focus into the sheet without scrolling it ahead of its animation', () => {
    // A plain focus() on open scrolled the clipped page stack to the button,
    // so the sheet arrived in ~100ms while the scrim and card took 600ms.
    expect(settingsSource).toContain("?.focus({ preventScroll: true })")
    expect(settingsSource).not.toMatch(/\[tabindex="-1"\]\)'\)\?\.focus\(\)/)
  })

  it('presents like an iOS sheet: the app behind recedes into a card', () => {
    // The class is dropped the moment the sheet starts closing, so the card
    // grows back in step with the sheet sliding away.
    expect(settingsSource).toContain("root.classList.toggle('sheet-presented', !isClosing)")
    const card = transitionsCss.match(/html\.sheet-presented \.app\.roster-shell\s*\{[^}]*\}/s)
    expect(card).toBeTruthy()
    expect(card![0]).toContain('scale(')
    // The radius is fixed while the sheet is open: one that changed per frame
    // repainted the whole card on every frame of a drag.
    expect(card![0]).not.toContain('border-radius')
    expect(transitionsCss).toMatch(/html\.sheet-open \.app\.roster-shell\s*\{[^}]*border-radius: 14px[^}]*will-change: transform/s)
    // The card follows the grabber while it is dragged.
    expect(settingsSource).toContain("'--sheet-progress'")
    expect(transitionsCss).toMatch(/html\.sheet-dragging \.app\.roster-shell\s*\{[^}]*transition:\s*none/s)
  })

  it('keeps the full-screen scrim free of backdrop-filter', () => {
    // A full-screen backdrop-filter forces the browser to re-blur the whole
    // viewport on every frame the sheet moves. Measured, that halved the
    // entrance to 30fps (33.3ms/frame vs 16.7ms), which made the sheet
    // arrive in coarse chunks -- the jump.
    const rule = settingsCss.match(/\.settings-modal-backdrop\s*\{[^}]*\}/s)
    expect(rule).toBeTruthy()
    expect(rule![0]).not.toContain('backdrop-filter')
  })

  it('enters the sheet as a GPU transform, not a per-frame layout of top', () => {
    // A `top` animation is main-thread layout on every frame, so it stuttered
    // whenever the app was busy, as it is on open. It had replaced a transform
    // entrance that jumped to y=0 and back; that jump was the opening focus()
    // scrolling the page stack, fixed with preventScroll. Measured with the
    // transform: 922 -> 895 -> 849 -> ... -> 88 -> 78, no overshoot.
    const rule = settingsCss.match(/@keyframes settings-sheet-up\s*\{[^}]*\}/s)
    expect(rule).toBeTruthy()
    expect(rule![0]).toContain('translateY(100%)')
    expect(rule![0]).not.toContain('top:')
  })

  it('exits the sheet from the drag position instead of snapping back up', () => {
    // Releasing the grabber used to drop the drag offset in the same commit
    // that started the exit animation, so the sheet jumped back up by the
    // whole drag distance (measured: 285.7px -> 78.7px) and only then slid
    // down from zero. The exit now starts from the drag offset.
    expect(settingsSource).toContain('--settings-drag-offset')
    expect(settingsCss).toMatch(
      /@keyframes settings-sheet-down\s*\{\s*from\s*\{\s*transform:\s*translateY\(var\(--settings-drag-offset/s,
    )
  })

  it('runs the exit animation on the stack so the sub-page moves too', () => {
    // The exit animation used to sit on the wrapper, which only contains
    // the root page. A sub-page that was showing therefore never moved and
    // simply vanished when the overlay unmounted.
    expect(settingsCss).toMatch(/\.settings-page-stack\.is-closing\s*\{[^}]*animation:/s)
    expect(settingsSource).toContain('settings-page-stack ${isClosing')
  })
})

describe('Settings sheet motion contract', () => {
  // The old curves were hard ease-outs: measured frame by frame, the sheet's
  // visible edge jumped 102px then 81px and was done in 33ms, then crept
  // sub-pixel for the rest of the duration. That read as a blink.
  const hardEaseOut = 'cubic-bezier(0.32, 0.72, 0, 1)'

  it('enters on a curve that spreads the travel over the duration', () => {
    // (0.32, 0.6, 0.35, 1) over 0.42s still landed half the travel in 105ms
    // and read as snapping open; a plain ease lands half at ~180ms.
    const rule = settingsCss.match(/\.settings-sheet-anim\s*\{[^}]*\}/s)
    expect(rule).toBeTruthy()
    expect(rule![0]).not.toContain(hardEaseOut)
    expect(rule![0]).toContain('cubic-bezier(0.25, 0.1, 0.25, 1)')
  })

  it('keeps the drag off React and off inherited styles', () => {
    // Each touchmove used to set React state (re-rendering the whole sheet)
    // and an inherited variable on the card (restyling every row in it):
    // 8.7ms per move on a desktop CPU, 0.2ms after.
    expect(settingsSource).not.toContain('setDragY(deltaY)')
    expect(settingsSource).not.toContain('setNavOffset(offset)')
    expect(transitionsCss).toMatch(/@property --sheet-progress\s*\{[^}]*inherits: false/s)
    // A forwards-filled fade-in pinned the scrim's opacity and overrode the drag.
    expect(settingsCss).toContain('settings-backdrop-in 0.35s ease backwards')
  })

  it('gives the entrance the iOS sheet pace, with the card and scrim in step', () => {
    const rule = settingsCss.match(/\.settings-sheet-anim\s*\{[^}]*\}/s)
    expect(rule![0]).toContain('settings-sheet-up 0.35s')
    expect(settingsCss).toContain('settings-backdrop-in 0.35s')
    const card = transitionsCss.match(/html\.sheet-presented \.app\.roster-shell\s*\{[^}]*\}/s)
    expect(card![0]).toContain('transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)')
  })

  it('springs the grabber back on a curve that does not jump', () => {
    const rule = settingsCss.match(/\.settings-page-root\.is-settling\s*\{[^}]*\}/s)
    expect(rule).toBeTruthy()
    expect(rule![0]).not.toContain(hardEaseOut)
    expect(rule![0]).toContain('cubic-bezier(0.25, 0.1, 0.25, 1)')
  })

  it('disables the spring-back transition under reduced motion', () => {
    const rule = settingsCss.match(
      /\.settings-page-root\.is-settling\s*\{[^}]*transition:\s*none[^}]*\}/s,
    )
    expect(rule).toBeTruthy()
    const reduced = settingsCss.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(settingsCss.indexOf('.settings-page-root.is-settling', reduced)).toBeGreaterThan(reduced)
  })

  it('keeps the exit animation mounted long enough to finish', () => {
    const exitMs = Number(settingsCss.match(/settings-sheet-down 0\.(\d+)s/)?.[1] ?? '0') * 10
    const unmountMs = Number(
      settingsSource.match(/closeTimerRef\.current = window\.setTimeout\(\(\) => \{\s*close\(\)\s*\}, (\d+)\)/)?.[1] ?? '0',
    )
    expect(exitMs).toBeGreaterThan(0)
    expect(unmountMs).toBeGreaterThanOrEqual(exitMs)
  })
})

describe('Host card design contract', () => {
  it('uses a slim filled surface rather than an outlined nested-box card', () => {
    expect(settingsCss).toMatch(/\.connection-screen \.connection-card\s*\{[^}]*border:\s*0/s)
    expect(settingsCss).toMatch(/\.connection-screen \.connection-card\s*\{[^}]*border-radius:\s*12px/s)
    expect(settingsCss).toMatch(/\.connection-screen \.connection-card\s*\{[^}]*background:\s*var\(--surface\)/s)
  })

  it('sets the endpoint as the single statement with no separate title', () => {
    expect(settingsSource).toContain('connection-endpoint')
    expect(settingsSource).not.toContain('connection-title')
    expect(settingsSource).not.toContain('connection-identity')
  })

  it('drops the description, nested stat boxes and separate metrics row', () => {
    expect(settingsSource).not.toContain('connection-guidance')
    expect(settingsSource).not.toContain('connection-metrics')
    expect(settingsSource).not.toContain('className="stats"')
  })

  it('keeps only the button as the action', () => {
    expect(settingsSource).toContain('connection-action')
    expect(settingsCss).toMatch(/\.connection-screen \.connection-action\s*\{[^}]*justify-self:\s*start/s)
  })

  it('uses the app-wide primary button shape with a 44pt touch target', () => {
    // 44pt is the iOS minimum; the shared token converts it at the default 1.15 UI zoom.
    expect(settingsSource).toContain('className="primary connection-action"')
    expect(settingsCss).toMatch(/\.connection-screen \.connection-action\s*\{[^}]*min-height:\s*var\(--control\)/s)
    expect(typeCss).toContain('--control: calc(44px / 1.15)')
  })

  it('removes the legacy status pill and nested stat box styles', () => {
    expect(baseCss).not.toContain('.status-pill{')
    expect(baseCss).not.toContain('.stats{')
    expect(themeCss).not.toContain('.connection-card .status-pill')
  })

  it('drops the unreferenced LegacyConnectionSettings component', () => {
    expect(appSource).not.toContain('LegacyConnectionSettings')
  })

  it('sets the endpoint in the sans face, not monospace', () => {
    const endpointRule = settingsCss.match(/\.connection-screen \.connection-endpoint\s*\{[^}]*\}/s)
    expect(endpointRule).toBeTruthy()
    expect(endpointRule![0]).not.toContain('font-mono')
  })

  it('keeps the host card free of inner hairline rules', () => {
    const cardBlock = settingsCss.slice(
      settingsCss.indexOf('HOST CARD'),
      settingsCss.indexOf('Sub-pages keep their own header'),
    )
    expect(cardBlock).not.toMatch(/border-(top|bottom):\s*1px/)
    expect(cardBlock).not.toMatch(/box-shadow:/)
  })
})
