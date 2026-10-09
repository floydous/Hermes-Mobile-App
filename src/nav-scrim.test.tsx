import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderToString } from 'react-dom/server'
import { NavIsland } from './App'

describe('Bottom navigation fade scrim', () => {
  const css = fs.readFileSync(path.resolve(__dirname, 'mobile-overrides.css'), 'utf-8')

  it('defines the bottom scrim behind the navigation island with pointer-events: none', () => {
    expect(css).toContain('.nav-bottom-scrim')
    expect(css).toMatch(/\.nav-bottom-scrim\s*\{[^}]*pointer-events:\s*none\s*!important/s)
    expect(css).toMatch(/\.nav-bottom-scrim\s*\{[^}]*z-index:\s*40/s)
  })

  it('binds the gradient to the theme canvas token var(--bg)', () => {
    expect(css).toMatch(/\.nav-bottom-scrim\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--bg/s)
  })

  it('provides smooth color-mix enhancement for theme transitions', () => {
    expect(css).toContain('@supports (background: color-mix(in srgb, black, white))')
    expect(css).toContain('color-mix(in srgb, var(--bg)')
  })

  it('hides the scrim when task details are open', () => {
    expect(css).toMatch(/\.roster-shell:has\(\.task-detail\)\s+\.nav-bottom-scrim[^{]*\{[^}]*display:\s*none\s*!important/s)
  })

  it('disables scrim animation when prefers-reduced-motion is active', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.nav-bottom-scrim[^{]*\{[^}]*animation:\s*none\s*!important/s)
  })

  it('renders .nav-bottom-scrim as a sibling before .nav-island in NavIsland DOM output', () => {
    const html = renderToString(<NavIsland tab="bots" setTab={vi.fn()} />)
    expect(html).toContain('class="nav-bottom-scrim"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('class="nav-island"')

    // Verify DOM sibling order: scrim appears before nav-island
    const scrimIndex = html.indexOf('class="nav-bottom-scrim"')
    const islandIndex = html.indexOf('class="nav-island"')
    expect(scrimIndex).toBeGreaterThan(-1)
    expect(islandIndex).toBeGreaterThan(-1)
    expect(scrimIndex).toBeLessThan(islandIndex)
  })
})
