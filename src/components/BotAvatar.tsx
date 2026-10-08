import { useEffect, useState } from 'react'

import { canonicalProfileAvatarSvg } from '../avatar-render'
import { loadProfileAvatar, type LiveProfile } from '../hermes'

export type BotAvatarVariant = 'roster' | 'session' | 'header' | 'welcome' | 'mention' | 'message' | 'dispatch'

type Props = {
  profile?: LiveProfile
  fallbackName: string
  variant?: BotAvatarVariant
}

const initials = (name: string) => name.split(/[-_ ]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()

export const shouldLoadAvatarAsset = (profile?: LiveProfile) => Boolean(profile?.has_avatar && profile.ui_meta?.['hermes-bots']?.imageKind !== 'shape')

const avatarMemoryCache = new Map<string, string | null>()
const avatarInFlight = new Map<string, Promise<string | null>>()
const STORAGE_PREFIX = 'hermes-avatar:'

export function getCachedAvatar(profileName: string): string | null | undefined {
  if (avatarMemoryCache.has(profileName)) {
    return avatarMemoryCache.get(profileName)
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${profileName}`)
      if (stored) {
        avatarMemoryCache.set(profileName, stored)
        return stored
      }
    }
  } catch {}
  return undefined
}

export function setCachedAvatar(profileName: string, dataUrl: string | null) {
  avatarMemoryCache.set(profileName, dataUrl)
  try {
    if (typeof localStorage !== 'undefined') {
      if (dataUrl) {
        localStorage.setItem(`${STORAGE_PREFIX}${profileName}`, dataUrl)
      } else {
        localStorage.removeItem(`${STORAGE_PREFIX}${profileName}`)
      }
    }
  } catch {}
}

export async function fetchProfileAvatarCached(profileName: string): Promise<string | null> {
  const cached = getCachedAvatar(profileName)
  if (cached !== undefined) return cached

  const pending = avatarInFlight.get(profileName)
  if (pending) return pending

  let promise!: Promise<string | null>
  promise = loadProfileAvatar(profileName)
    .then(data => {
      // Guard against race conditions where the cache entry or in-flight promise was superseded
      if (avatarInFlight.get(profileName) === promise) {
        avatarInFlight.delete(profileName)
        setCachedAvatar(profileName, data)
      }
      return data
    })
    .catch(() => {
      if (avatarInFlight.get(profileName) === promise) {
        avatarInFlight.delete(profileName)
      }
      return null
    })

  avatarInFlight.set(profileName, promise)
  return promise
}

export function clearAvatarCache(profileName?: string) {
  if (profileName) {
    avatarMemoryCache.delete(profileName)
    avatarInFlight.delete(profileName)
    try { localStorage.removeItem(`${STORAGE_PREFIX}${profileName}`) } catch {}
  } else {
    avatarMemoryCache.clear()
    avatarInFlight.clear()
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith(STORAGE_PREFIX)) keysToRemove.push(key)
        }
        for (const key of keysToRemove) localStorage.removeItem(key)
      }
    } catch {}
  }
}

export function BotAvatar({ profile, fallbackName, variant = 'roster' }: Props) {
  const profileName = profile?.name
  const meta = profile?.ui_meta?.['hermes-bots']
  const isAssetAllowed = shouldLoadAvatarAsset(profile)
  const explicitImage = meta?.image || null

  // Associate asset state with profileName so a profile prop change never renders previous avatar
  const [assetRecord, setAssetRecord] = useState<{ name: string; url: string | null } | null>(() => {
    if (!profileName || !isAssetAllowed) return null
    const cached = getCachedAvatar(profileName)
    return cached ? { name: profileName, url: cached } : null
  })

  // Synchronously derive asset for the current profileName to prevent cross-profile flashes
  const resolvedAsset = isAssetAllowed
    ? (assetRecord && assetRecord.name === profileName ? assetRecord.url : (profileName ? getCachedAvatar(profileName) ?? null : null))
    : null

  const svg = profile ? canonicalProfileAvatarSvg(profile.name, meta?.shape, meta?.color) : ''
  const className = `bot-avatar-slot bot-avatar-${variant}`

  useEffect(() => {
    if (!profileName || !isAssetAllowed) {
      setAssetRecord(null)
      return
    }

    if (explicitImage) {
      setAssetRecord({ name: profileName, url: explicitImage })
      return
    }

    const cached = getCachedAvatar(profileName)
    if (cached !== undefined) {
      setAssetRecord({ name: profileName, url: cached })
      return
    }

    let active = true
    void fetchProfileAvatarCached(profileName).then(value => {
      if (active) setAssetRecord({ name: profileName, url: value })
    })
    return () => { active = false }
  }, [profileName, isAssetAllowed, explicitImage])

  if (!profile) return <span className={`avatar-fallback ${className}`}>{initials(fallbackName)}</span>
  if (resolvedAsset || explicitImage) return <img className={`avatar-fallback bot-avatar bot-avatar-image ${className}`} src={resolvedAsset || explicitImage || undefined} alt=""/>
  return <span className={`avatar-fallback bot-avatar bot-avatar-svg ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }}/>
}
