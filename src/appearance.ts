/*
 * Appearance preferences: theme mode (System / Light / Dark), the dark
 * variant, the accent color and the chat layout.
 *
 * The resolved theme ('light' | 'grey' | 'dark') is still the one value the
 * stylesheets and onboarding key on (`data-theme`). Charcoal and Graphite
 * both resolve to 'grey'; Graphite only swaps a few palette colors through
 * `data-tone`. Accent and chat layout are their own attributes on <html>.
 */
export type Theme = 'dark' | 'light' | 'grey'
export type ThemeMode = 'system' | 'light' | 'dark'
export type DarkVariant = 'charcoal' | 'graphite' | 'black'
export type Accent = 'iris' | 'ocean' | 'mint' | 'sunset' | 'rose' | 'mono'
export type ChatLayout = 'bubbles' | 'compact'
export type Appearance = { mode: ThemeMode; dark: DarkVariant; accent: Accent; chatLayout: ChatLayout }

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
export const DARK_VARIANTS: DarkVariant[] = ['charcoal', 'graphite', 'black']
export const ACCENTS: Accent[] = ['iris', 'ocean', 'mint', 'sunset', 'rose', 'mono']
export const CHAT_LAYOUTS: ChatLayout[] = ['bubbles', 'compact']

const KEY = 'hermes-mobile-appearance'
// Before these settings existed the app stored a single theme here.
const LEGACY_THEME_KEY = 'hermes-mobile-theme'

export function normalizeTheme(val: string | null | undefined): Theme {
  if (val === 'dark' || val === 'grey' || val === 'light') return val
  if (val === 'aurora') return 'dark' // Graceful fallback for legacy aurora preference
  return 'light'
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? value as T : fallback

export function readAppearance(storage: Pick<Storage, 'getItem'>): Appearance {
  let saved: Partial<Appearance> = {}
  try { saved = JSON.parse(storage.getItem(KEY) || '{}') ?? {} } catch { /* corrupt value: fall back to defaults */ }
  const legacy = normalizeTheme(storage.getItem(LEGACY_THEME_KEY))
  return {
    mode: pick(saved.mode, THEME_MODES, legacy === 'light' ? 'light' : 'dark'),
    dark: pick(saved.dark, DARK_VARIANTS, legacy === 'grey' ? 'charcoal' : 'black'),
    accent: pick(saved.accent, ACCENTS, 'iris'),
    chatLayout: pick(saved.chatLayout, CHAT_LAYOUTS, 'bubbles'),
  }
}

export function saveAppearance(storage: Pick<Storage, 'setItem'>, appearance: Appearance) {
  storage.setItem(KEY, JSON.stringify(appearance))
}

export function resolveTheme(appearance: Appearance, systemDark: boolean): Theme {
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark)
  if (!dark) return 'light'
  return appearance.dark === 'black' ? 'dark' : 'grey'
}

// Onboarding cycles concrete themes; map one back onto the preferences.
export function appearanceForTheme(appearance: Appearance, theme: Theme): Appearance {
  if (theme === 'light') return { ...appearance, mode: 'light' }
  if (theme === 'dark') return { ...appearance, mode: 'dark', dark: 'black' }
  return { ...appearance, mode: 'dark', dark: appearance.dark === 'black' ? 'charcoal' : appearance.dark }
}

export function applyAppearance(root: HTMLElement, appearance: Appearance, systemDark: boolean) {
  root.dataset.theme = resolveTheme(appearance, systemDark)
  root.dataset.tone = appearance.dark
  root.dataset.accent = appearance.accent
  root.dataset.chatLayout = appearance.chatLayout
}

export const systemPrefersDark = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
