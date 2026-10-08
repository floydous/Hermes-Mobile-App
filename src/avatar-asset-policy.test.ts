import { describe, expect, it } from 'vitest'

import {
  clearAvatarCache,
  getCachedAvatar,
  setCachedAvatar,
  shouldLoadAvatarAsset,
} from './components/BotAvatar'

describe('Bot avatar asset precedence', () => {
  it('does not substitute a stale raster asset for Desktop shape metadata', () => {
    expect(shouldLoadAvatarAsset({
      name: 'gaetan',
      has_avatar: true,
      ui_meta: { 'hermes-bots': { shape: 'circle', color: 'hsl(30 68% 58%)', imageKind: 'shape' } },
    })).toBe(false)
  })

  it('allows a server asset for a profile with no explicit shape metadata', () => {
    expect(shouldLoadAvatarAsset({ name: 'research-rabbit', has_avatar: true })).toBe(true)
  })

  it('allows explicitly image-backed Bot profiles', () => {
    expect(shouldLoadAvatarAsset({
      name: 'designer',
      has_avatar: true,
      ui_meta: { 'hermes-bots': { imageKind: 'photo', image: 'data:image/png;base64,AA==' } },
    })).toBe(true)
  })

  it('stores and retrieves cached avatars synchronously without blink', () => {
    clearAvatarCache('homework-manager')
    expect(getCachedAvatar('homework-manager')).toBeUndefined()

    setCachedAvatar('homework-manager', 'data:image/png;base64,sample')
    expect(getCachedAvatar('homework-manager')).toBe('data:image/png;base64,sample')

    clearAvatarCache('homework-manager')
    expect(getCachedAvatar('homework-manager')).toBeUndefined()
  })

  it('globally clears all persisted avatars from storage', () => {
    setCachedAvatar('bot1', 'data:image/png;base64,1')
    setCachedAvatar('bot2', 'data:image/png;base64,2')
    expect(getCachedAvatar('bot1')).toBe('data:image/png;base64,1')
    expect(getCachedAvatar('bot2')).toBe('data:image/png;base64,2')

    clearAvatarCache()
    expect(getCachedAvatar('bot1')).toBeUndefined()
    expect(getCachedAvatar('bot2')).toBeUndefined()
  })
})
