import { describe, expect, it } from 'vitest'
import { appearanceForTheme, readAppearance, resolveTheme, type Appearance } from './appearance'

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null })
const base: Appearance = { mode: 'dark', dark: 'charcoal', accent: 'iris', chatLayout: 'bubbles' }

describe('appearance preferences', () => {
  it('carries the old single theme setting over', () => {
    expect(readAppearance(storage({ 'hermes-mobile-theme': 'grey' }))).toMatchObject({ mode: 'dark', dark: 'charcoal' })
    expect(readAppearance(storage({ 'hermes-mobile-theme': 'dark' }))).toMatchObject({ mode: 'dark', dark: 'black' })
    expect(readAppearance(storage({}))).toEqual({ mode: 'light', dark: 'black', accent: 'iris', chatLayout: 'bubbles' })
  })

  it('ignores corrupt or unknown saved values', () => {
    expect(readAppearance(storage({ 'hermes-mobile-appearance': '{nope' })).accent).toBe('iris')
    expect(readAppearance(storage({ 'hermes-mobile-appearance': '{"accent":"neon","mode":"system"}' }))).toMatchObject({ accent: 'iris', mode: 'system' })
  })

  it('resolves System from the device and dark variants to the themes the CSS knows', () => {
    expect(resolveTheme({ ...base, mode: 'system' }, false)).toBe('light')
    expect(resolveTheme({ ...base, mode: 'system' }, true)).toBe('grey')
    expect(resolveTheme({ ...base, dark: 'graphite' }, false)).toBe('grey')
    expect(resolveTheme({ ...base, dark: 'black' }, false)).toBe('dark')
  })

  it('maps onboarding theme picks back onto the preferences', () => {
    expect(appearanceForTheme(base, 'light').mode).toBe('light')
    expect(appearanceForTheme(base, 'dark')).toMatchObject({ mode: 'dark', dark: 'black' })
    expect(appearanceForTheme({ ...base, dark: 'black' }, 'grey').dark).toBe('charcoal')
    expect(appearanceForTheme({ ...base, dark: 'graphite' }, 'grey').dark).toBe('graphite')
  })
})
