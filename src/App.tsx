import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, startTransition } from 'react'
import { Bot, CalendarClock, ListTodo, MessageSquare, Plus, RefreshCw, Search, Settings as SettingsIcon, Users, X } from 'lucide-react'

import { ChatView } from './components/ChatView'
import { BotAvatar } from './components/BotAvatar'
import { BotAppearancePicker } from './components/BotAppearancePicker'
import { BotProfileSheet } from './components/BotProfileSheet'
import { TasksView, preloadTaskJobs } from './components/TasksView'
import { ConnectionSettings } from './components/ConnectionSettings'
import { OnboardingLanding } from './components/OnboardingLanding'
import { ErrorBoundary } from './components/ErrorBoundary'
import HermesHostIcon from './assets/hermes-agent-icon-transparent.svg'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@tauri-apps/api/core'
import { buildAttachmentPrompt, attachmentSummary } from './attachment-routing'
import { buildBotRows, cleanPreviewSnippet, resolveCanonicalSessionId, type RosterProfile } from './live-model'
import { getInitialSpinnerPhrase, getProgressiveSpinnerPhrase } from './spinner-phrases'
import { settleAssistantResponse, type SettledAssistantResponse as SettledAssistantState } from './settled-assistant'
import {
  InFlightSubmissionTracker,
  isActiveChatTurn,
  isBotRowWorking,
  isOptimisticUserMessageAlreadyCached,
  isSessionRowWorking,
  isTurnSettledByTranscript,
  areActiveTurnsEqual,
  reconcileActiveTurns,
  resolveDelegationTargetProfile,
  restorePersistedActiveTurns,
  shouldRetainLocalMessages,
  shouldShowWorkingIndicator,
  type ActiveBotTurn,
  type ToolActivity,
} from './chat-turn'
import { decideOnboardingBootstrapState, errorMessage, RequestEpoch, selectRestoredEndpoint } from './connection-state'
import {
  areMessageListsEqual,
  areMessageListsShallowEqual,
  areProfilesShallowEqual,
  areSessionsShallowEqual,
  calculateUnreadState,
  deduplicateConsecutiveMessages,
  getCachedSessionMessages,
  getEndpointStorageKey,
  isHumanChatSession,
  parseCachedSessionIndex,
  parseLastReadTimestamp,
  removeCachedSessionMessages,
  resolveLatestSessionPreview,
  scheduleDeferredSessionPersistence,
  flushDeferredSessionPersistence,
  seedUnreadBaselineIfNeeded,
  setCachedSessionMessages,
  MAX_CACHED_SESSIONS,
} from './session-cache'
import {
  finishPerformanceTrace,
  recordPerformanceEvent,
  recordTracePhase,
  remoteLog,
  setRemoteLoggerEndpoint,
  startPerformanceTrace,
} from './remote-logger'
import {
  executeTurnSubmissionPipeline,
} from './session-title'
import {
  clearSession,
  connectAndSubmit,
  createProfile,
  createSession,
  getResolvedSessionId,
  interruptSession,
  loadActiveSessions,
  loadMessages,
  loadSnapshot,
  onGatewayGlobalEvent,
  respondClarify,
  resumeSession,
  savedHermesEndpoint,
  setActiveHermesEndpoint,
  settleGatewayTurn,
  updateSessionTitle,
  type LiveMessage,
  type LiveProfile,
  type LiveSession,
  type LiveUsage,
} from './hermes'
import { type ClarifyRequest } from './components/ClarifyCard'
import {
  clearPersistedClarify,
  doesSessionMatchTurn,
  getPersistedClarify,
  isSessionCanonical,
  persistClarify,
  reconcileSettledSessionTurn,
  resolveMatchingClarify,
} from './clarify-isolation'

import { classifyInteractiveRowGesture, computeNextSwipeTab, isHorizontalSwipeIntent, type Tab } from './tab-swipe'
type DraftBot = { role: string; name: string; description: string; soul: string; model: string; provider: string; shape: string }
type Theme = 'dark' | 'light' | 'grey'

export function normalizeTheme(val: string | null | undefined): Theme {
  if (val === 'dark' || val === 'grey' || val === 'light') return val
  if (val === 'aurora') return 'dark' // Graceful fallback for legacy aurora preference
  return 'light'
}
type SettledAssistantResponse = { sessionId: string; profile: string; content: string; usage?: LiveUsage }

const titleize = (value?: string | null) => (value || '').split(/[-_]+/).filter(Boolean).map(part => (part[0] ? part[0].toUpperCase() + part.slice(1) : '')).join(' ') || 'Bot'

function generateSessionTitle(prompt: string): string {
  const clean = prompt.replace(/^\s*(Attached:\s*[^\n]+\n*)+/i, '').trim()
  const firstLine = clean.split('\n')[0].replace(/^#+\s*/, '').trim()
  if (!firstLine) return 'Chat'
  return firstLine.length > 36 ? `${firstLine.slice(0, 36).trim()}…` : firstLine
}

const ago = (seconds?: number) => {
  if (!seconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - seconds)
  if (delta < 75) return 'now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 604800) return `${Math.floor(delta / 86400)}d`
  return `${Math.floor(delta / 604800)}w`
}

const roles: Record<string, [string, string]> = {
  Researcher: ['research-rabbit', 'Digs into questions and returns sourced answers.'],
  Coder: ['patch', 'Writes, reviews, and ships code.'],
  Writer: ['draft', 'Turns ideas into clear, vivid writing.'],
  Analyst: ['signal', 'Finds patterns and explains what matters.'],
  Custom: ['', ''],
}

export { type ActiveBotTurn, type ToolActivity }

function resolveProfileForSessionId(
  sid: string,
  profiles: LiveProfile[],
  sessions: LiveSession[],
  activeTurns: Record<string, ActiveBotTurn | undefined>
): string | null {
  if (!sid) return null
  for (const [prof, turn] of Object.entries(activeTurns)) {
    if (turn && turn.sessionId === sid) return turn.profile || prof
  }
  for (const p of profiles) {
    if (
      p.canonical_session?.id === sid ||
      p.canonical_session?.resolved_id === sid ||
      sid === `draft:${p.name}` ||
      sid.startsWith(`dispatched:${p.name}`)
    ) {
      return p.name
    }
  }
  const foundSession = sessions.find(s => s.id === sid)
  if (foundSession?.profile) return foundSession.profile
  return null
}

let memoizedLastReadMap: Map<string, number> | null = null

export function initializeLastReadMap(): Map<string, number> {
  if (memoizedLastReadMap) return memoizedLastReadMap
  const map = new Map<string, number>()
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('hermes-last-read:')) {
          const sid = key.slice('hermes-last-read:'.length)
          const val = parseLastReadTimestamp(localStorage.getItem(key))
          if (val != null && Number.isFinite(val)) {
            map.set(sid, val)
          }
        }
      }
    }
  } catch {}
  memoizedLastReadMap = map
  return map
}

export function resetLastReadMapForTesting(): void {
  memoizedLastReadMap = null
}

// DEV OVERRIDE: forces onboarding landing page on open for iteration.
export const DEV_FORCE_LANDING_PAGE = true

export default function App() {
  const [tab, setTab] = useState<Tab>('bots')
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward')
  const switchTabRafRef = useRef<number | null>(null)

  const switchTab = useCallback((newTab: Tab) => {
    if (switchTabRafRef.current != null) {
      try { cancelAnimationFrame(switchTabRafRef.current) } catch {}
      switchTabRafRef.current = null
    }
    remoteLog('DEBUG', 'Navigation', `switchTab requested -> ${newTab}`)
    setTab(current => {
      if (newTab === current) return current
      const tabOrder: Tab[] = ['bots', 'sessions', 'tasks']
      const currentIdx = tabOrder.indexOf(current)
      const newIdx = tabOrder.indexOf(newTab)
      setSlideDirection(newIdx >= currentIdx ? 'forward' : 'backward')
      return newTab
    })
  }, [])

  useEffect(() => {
    return () => {
      if (switchTabRafRef.current != null) {
        try { cancelAnimationFrame(switchTabRafRef.current) } catch {}
        switchTabRafRef.current = null
      }
    }
  }, [])
  const [profiles, setProfiles] = useState<LiveProfile[]>([])
  const profilesRef = useRef<LiveProfile[]>(profiles)
  profilesRef.current = profiles
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const sessionsRef = useRef<LiveSession[]>(sessions)
  sessionsRef.current = sessions
  const adhocSessionIdsRef = useRef<Set<string>>(new Set())
  const [selected, setSelected] = useState<LiveSession | null>(null)
  const selectedRef = useRef<LiveSession | null>(selected)
  selectedRef.current = selected
  const messageCacheRef = useRef<Map<string, LiveMessage[]>>(new Map())
  const chatTurnGenerationRef = useRef(0)
  const [conversationLoading, setConversationLoading] = useState(false)
  const sessionLoadRef = useRef(0)
  const [profileSheet, setProfileSheet] = useState(false)
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const messagesRef = useRef<LiveMessage[]>([])
  messagesRef.current = messages
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean>(() => {
    if (DEV_FORCE_LANDING_PAGE) return true
    if (typeof localStorage === 'undefined') return false
    const dismissed = localStorage.getItem('hermes-mobile-onboarding-dismissed') === 'true'
    const stored = localStorage.getItem('hermes-mobile-active-endpoint')
    return decideOnboardingBootstrapState(null, stored, dismissed).needsOnboarding
  })
  const [activeEndpoint, setActiveEndpoint] = useState(() => {
    const initial = selectRestoredEndpoint(null, localStorage.getItem('hermes-mobile-active-endpoint'), 'http://127.0.0.1:9119')
    setActiveHermesEndpoint(initial)
    return initial
  })
  const activeEndpointRef = useRef(activeEndpoint)
  const refreshEpochRef = useRef(new RequestEpoch())
  const refreshInFlightRef = useRef(false)
  const [, setPairingBusy] = useState(false)
  const pairingBusyRef = useRef(false)
  const setPairingBusyState = (busy: boolean) => { pairingBusyRef.current = busy; setPairingBusy(busy) }
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const lastConnectionErrorRef = useRef('')
  const [streaming, setStreaming] = useState('')
  const [settledAssistant, setSettledAssistant] = useState<SettledAssistantState | null>(null)
  const settledAssistantRef = useRef<SettledAssistantState | null>(null)
  settledAssistantRef.current = settledAssistant
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  sendingRef.current = sending
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [pendingClarify, setPendingClarify] = useState<ClarifyRequest | null>(null)
  const pendingClarifyRef = useRef<Record<string, ClarifyRequest>>({})
  const pendingClarifyByProfileRef = useRef<Record<string, ClarifyRequest>>({})
  const inFlightDelegationByToolId = useRef<Map<string, string>>(new Map())
  const [activeTurns, setActiveTurns] = useState<Record<string, ActiveBotTurn>>(() => {
    return restorePersistedActiveTurns(typeof localStorage !== 'undefined' ? localStorage.getItem('hermes-mobile-active-turns') : null)
  })
  const activeTurnsRef = useRef<Record<string, ActiveBotTurn>>({})
  activeTurnsRef.current = activeTurns
  const activeInFlightTurnsRef = useRef<InFlightSubmissionTracker>(new InFlightSubmissionTracker())

  const lastPersistedTurnJsonRef = useRef<string>('')
  const turnPersistenceTimerRef = useRef<number | null>(null)

  const persistActiveTurnsSnapshot = useCallback(() => {
    if (turnPersistenceTimerRef.current != null) {
      window.clearTimeout(turnPersistenceTimerRef.current)
      turnPersistenceTimerRef.current = null
    }
    try {
      const turns = activeTurnsRef.current
      if (Object.keys(turns).length === 0) {
        if (lastPersistedTurnJsonRef.current !== '') {
          localStorage.removeItem('hermes-mobile-active-turns')
          lastPersistedTurnJsonRef.current = ''
        }
      } else {
        const json = JSON.stringify(turns)
        if (json !== lastPersistedTurnJsonRef.current) {
          lastPersistedTurnJsonRef.current = json
          localStorage.setItem('hermes-mobile-active-turns', json)
        }
      }
    } catch {}
  }, [])

  const scheduleThrottledTurnPersistence = useCallback(() => {
    if (turnPersistenceTimerRef.current != null) return
    turnPersistenceTimerRef.current = window.setTimeout(() => {
      turnPersistenceTimerRef.current = null
      persistActiveTurnsSnapshot()
    }, 1000)
  }, [persistActiveTurnsSnapshot])

  // Synchronously persist structural turn transitions, and clean up when turns clear
  useEffect(() => {
    persistActiveTurnsSnapshot()
  }, [activeTurns, persistActiveTurnsSnapshot])

  // Flush in-flight turn snapshots and deferred transcript persistence immediately on pagehide/beforeunload so backgrounding the app retains state
  useEffect(() => {
    const handleFlush = () => {
      persistActiveTurnsSnapshot()
      flushDeferredSessionPersistence()
    }
    window.addEventListener('beforeunload', handleFlush)
    window.addEventListener('pagehide', handleFlush)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistActiveTurnsSnapshot()
        flushDeferredSessionPersistence()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (turnPersistenceTimerRef.current != null) {
        window.clearTimeout(turnPersistenceTimerRef.current)
        turnPersistenceTimerRef.current = null
      }
      window.removeEventListener('beforeunload', handleFlush)
      window.removeEventListener('pagehide', handleFlush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [persistActiveTurnsSnapshot])

  const recentEndedTurnsRef = useRef<Map<string, number>>(new Map())
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [botDraft, setBotDraft] = useState<DraftBot>({
    role: 'Coder', name: 'patch', description: 'Writes, reviews, and ships code.',
    soul: 'You are a pragmatic software engineer. Read surrounding code before changing it, keep diffs focused, and verify your work by running it.',
    model: '', provider: '', shape: 'blobatar',
  })
  const [theme, setTheme] = useState<Theme>(() => normalizeTheme(localStorage.getItem('hermes-mobile-theme')))
  const [uiScale, setUiScale] = useState<number>(() => {
    const saved = localStorage.getItem('hermes-mobile-ui-scale')
    const parsed = saved ? parseFloat(saved) : 1.15
    return !isNaN(parsed) && parsed >= 0.75 && parsed <= 1.5 ? parsed : 1.15
  })

  useEffect(() => {
    document.documentElement.style.zoom = String(uiScale)
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
    localStorage.setItem('hermes-mobile-ui-scale', String(uiScale))
  }, [uiScale])
  const rosterScrollRef = useRef<HTMLDivElement | null>(null)

  const setRowRipplePoint = (event: React.PointerEvent<HTMLButtonElement>) => {
    const x = event.nativeEvent.offsetX ?? 50
    const y = event.nativeEvent.offsetY ?? 24
    event.currentTarget.style.setProperty('--ripple-x', `${x}px`)
    event.currentTarget.style.setProperty('--ripple-y', `${y}px`)
  }

  const handleRowPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    remoteLog('DEBUG', 'Action', `Row pointerdown on ${event.currentTarget.className}`)
    setRowRipplePoint(event)
  }
  const navigationRef = useRef({ selected: false, profileSheet: false, settings: false, createOpen: false, tab: 'bots' as Tab })
  navigationRef.current = { selected: Boolean(selected), profileSheet, settings, createOpen, tab }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    let unlistenAndroidBack: { unregister: () => Promise<void> } | undefined
    const handleBack = async () => {
      const backEvent = new Event('hermes-mobile-back', { cancelable: true })
      window.dispatchEvent(backEvent)
      if (backEvent.defaultPrevented) return true

      const hadPendingIntent = Boolean(openingSessionIdRef.current)
      sessionLoadRef.current++
      navigationIntentRef.current++
      openingSessionIdRef.current = null
      setOpeningSessionId(null)
      setConversationLoading(false)

      const navigation = navigationRef.current
      if (navigation.profileSheet) { setProfileSheet(false); return true }
      if (hadPendingIntent) {
        remoteLog('DEBUG', 'Navigation', `Back pressed while opening: cancelled pending open`)
        return true
      }
      if (navigation.selected) {
        remoteLog('DEBUG', 'Navigation', `Hardware back pressed: leaving session ${selectedRef.current?.id || 'unknown'}`)
        cancelPendingCachedHydration()
        setSelected(null)
        return true
      }
      if (navigation.settings) { setSettings(false); return true }
      if (navigation.createOpen) { setCreateOpen(false); return true }
      if (navigation.tab !== 'bots') { switchTab('bots'); return true }
      return false
    }
    if (isTauri()) {
      void getCurrentWindow().onCloseRequested(async event => {
        if (await handleBack()) event.preventDefault()
      }).then(remove => { if (disposed) remove(); else unlisten = remove }).catch(() => {})
      void onBackButtonPress(async () => {
        if (!(await handleBack()) && !disposed) await getCurrentWindow().close()
      }).then(listener => { if (disposed) void listener.unregister(); else unlistenAndroidBack = listener }).catch(() => {})
    }
    return () => { disposed = true; unlisten?.(); void unlistenAndroidBack?.unregister() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('hermes-mobile-theme', theme)
  }, [theme])
  const activateEndpoint = (endpoint: string) => {
    const normalized = endpoint.replace(/\/$/, '')
    activeEndpointRef.current = normalized
    setActiveHermesEndpoint(normalized)
    setActiveEndpoint(normalized)
    setRemoteLoggerEndpoint(normalized)
    return normalized
  }
  const refresh = useCallback(async (requestedEndpoint = activeEndpointRef.current, supersede = false, shouldWarmUp = false): Promise<{ profiles: LiveProfile[]; sessions: LiveSession[] } | null> => {
    if ((pairingBusyRef.current || refreshInFlightRef.current) && !supersede) return null
    const endpoint = requestedEndpoint.replace(/\/$/, '')
    const epoch = refreshEpochRef.current.begin()
    refreshInFlightRef.current = true
    if (supersede || !profilesRef.current.length) {
      setLoading(true)
    }
    if (supersede) setConnectionStatus('checking')
    try {
      const data = await loadSnapshot(endpoint)
      if (!refreshEpochRef.current.isCurrent(epoch)) return null
      if (!lastReadCacheRef.current) {
        lastReadCacheRef.current = initializeLastReadMap()
      }
      seedUnreadBaselineIfNeeded(endpoint, data.sessions, data.profiles, lastReadCacheRef.current)
      setProfiles(prevProfiles => {
        const next = data.profiles.map(p => {
          const prev = prevProfiles.find(old => old.name === p.name)
          if (!p.canonical_session && prev?.canonical_session) {
            const prevId = prev.canonical_session.id
            const isFreshOrInFlight = Boolean(
              activeInFlightTurnsRef.current.has(prevId) ||
              activeInFlightTurnsRef.current.has(p.name) ||
              selectedRef.current?.id === prevId ||
              (messageCacheRef.current.get(prevId)?.length || 0) > 0
            )
            if (isFreshOrInFlight) {
              return { ...p, canonical_session: prev.canonical_session }
            }
          }
          return p
        })
        return areProfilesShallowEqual(prevProfiles, next) ? prevProfiles : next
      })
      setSessions(prevSessions => {
        const nextMap = new Map<string, LiveSession>(data.sessions.map(s => [s.id, s]))
        // Preserve any session that is currently selected, in-flight, or has local optimistic messages
        // so a background refresh during in-flight turns (when SQLite messages count is 0) never drops it
        for (const prev of prevSessions) {
          const isAlreadyPresent = Array.from(nextMap.keys()).some(existingId =>
            existingId === prev.id ||
            getResolvedSessionId(existingId, endpoint) === prev.id ||
            getResolvedSessionId(prev.id, endpoint) === existingId
          )
          if (!isAlreadyPresent) {
            const isPrevCanonical = isSessionCanonical(prev, data.profiles, adhocSessionIdsRef.current)
            const isInFlight = Boolean(
              activeInFlightTurnsRef.current.has(prev.id) ||
              (isPrevCanonical && activeInFlightTurnsRef.current.has(prev.profile)) ||
              selectedRef.current?.id === prev.id
            )
            const hasLocalMessages = Boolean(
              (messageCacheRef.current.get(prev.id)?.length || 0) > 0
            )
            if (isInFlight || hasLocalMessages) {
              nextMap.set(prev.id, prev)
            }
          }
        }
        const next = Array.from(nextMap.values())
        return areSessionsShallowEqual(prevSessions, next) ? prevSessions : next
      })
      if (selectedRef.current) {
        const curId = selectedRef.current.id
        const matched = data.sessions.find(s => s.id === curId)
        if (matched && matched.title && matched.title !== selectedRef.current.title) {
          setSelected(current => current?.id === curId ? { ...current, title: matched.title } : current)
        }
      }
      setError('')
      lastConnectionErrorRef.current = ''
      setConnectionStatus('connected')

      // Authoritatively reconcile active turns with the gateway's live session registry
      const queryStart = Date.now()
      void loadActiveSessions(endpoint).then(activeList => {
        if (!activeList) return // Network failure: do not wipe local optimistic state
        const endedSet = new Set<string>()
        for (const [sid, timestamp] of recentEndedTurnsRef.current.entries()) {
          if (timestamp >= queryStart) {
            endedSet.add(sid)
          }
        }
        const map: Record<string, string> = {}
        for (const s of data.sessions) {
          if (s.id && s.profile) map[s.id] = s.profile
        }
        for (const p of data.profiles) {
          if (p.canonical_session?.id) {
            map[p.canonical_session.id] = p.name
            if (p.canonical_session.resolved_id) map[p.canonical_session.resolved_id] = p.name
          }
          if (p.last_session?.id) {
            map[p.last_session.id] = p.name
            if (p.last_session.resolved_id) map[p.last_session.resolved_id] = p.name
          }
        }
        remoteLog('DEBUG', 'GatewayActive', `active_list: ${activeList.map(s => `${s.id}:${s.status}`).join(', ') || 'none'}`)
        setActiveTurns(prev => {
          const next = reconcileActiveTurns(prev, activeList, map, Date.now(), endedSet, activeInFlightTurnsRef.current.toSet())
          return areActiveTurnsEqual(prev, next) ? prev : next
        })
      }).catch(() => {})

      if (shouldWarmUp) {
        // Stagger background warm-up so we don't saturate the network/tunnel
        window.setTimeout(() => {
          if (!refreshEpochRef.current.isCurrent(epoch) || selectedRef.current !== null) return
          const candidates = [
            ...data.profiles.map(p => p.canonical_session ? { id: resolveCanonicalSessionId(p.canonical_session), profile: p.name } : null).filter((item): item is { id: string; profile: string } => Boolean(item?.id)),
            ...data.sessions.slice(0, 8).map(s => ({ id: s.id, profile: s.profile })),
          ]
          candidates.forEach((candidate, idx) => {
            if (!candidate?.id || messageCacheRef.current.has(candidate.id)) return
            const delay = idx < 2 ? 0 : (idx - 1) * 200
            window.setTimeout(() => {
              if (!refreshEpochRef.current.isCurrent(epoch) || selectedRef.current !== null) return
              void loadMessages(candidate.id, candidate.profile, endpoint).then(msgs => {
                const existing = messageCacheRef.current.get(candidate.id) || []
                const isTurnActive = Boolean(activeTurnsRef.current[candidate.profile] || activeInFlightTurnsRef.current.has(candidate.profile))
                if (shouldRetainLocalMessages(msgs, existing, isTurnActive)) return
                if (areMessageListsEqual(existing, msgs)) return
                messageCacheRef.current.set(candidate.id, msgs)
                setCachedSessionMessages(candidate.id, msgs)
              }).catch(() => {})
            }, delay)
          })

          // Pre-warm scheduled tasks so swiping to Tasks is instantaneous with zero delay
          window.setTimeout(() => {
            if (!refreshEpochRef.current.isCurrent(epoch) || selectedRef.current !== null) return
            void preloadTaskJobs(endpoint, data.profiles)
          }, 80)
        }, 50)
      }

      return data
    } catch (reason) {
      if (refreshEpochRef.current.isCurrent(epoch)) {
        const message = errorMessage(reason, 'Could not connect to Hermes Desktop.')
        lastConnectionErrorRef.current = message
        // If we already have loaded cached profiles or sessions, do not flash a jarring error banner
        // on transient background poll timeouts; only set error if the screen is completely empty
        setProfiles(prevProfiles => {
          if (prevProfiles.length === 0) {
            setError(message)
          }
          return prevProfiles
        })
        setConnectionStatus('disconnected')
      }
      return null
    } finally {
      if (refreshEpochRef.current.isCurrent(epoch)) {
        refreshInFlightRef.current = false
        if (supersede || !profilesRef.current.length) {
          setLoading(false)
        }
      }
    }
  }, [])


  useEffect(() => {
    return onGatewayGlobalEvent(event => {
      if (event.type === 'gateway.ready') {
        // Gateway reconnected: re-reconcile active sessions and reload transcript in case
        // terminal completion arrived while transport was re-establishing
        void refresh()
        if (selectedRef.current) {
          if (activeInFlightTurnsRef.current.has(selectedRef.current.id) || activeInFlightTurnsRef.current.has(selectedRef.current.profile)) {
            void openSession(selectedRef.current)
          } else {
            // Pre-warm the current view's session so the next user prompt is immediately bound to a live runtime
            void resumeSession(selectedRef.current.id, selectedRef.current.profile, activeEndpointRef.current).catch(() => {})
          }
        }
      }
      if (event.type === 'message.delta') {
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
        if (sid && typeof event.payload.text === 'string') {
          // If this session is actively being driven by local turn submission pipeline,
          // submitPrompt's onDelta pipeline authoritatively manages streamingText and setStreaming.
          if (sendingRef.current && doesSessionMatchTurn(selectedRef.current, sid, prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            return
          }
          if (activeInFlightTurnsRef.current.has(sid) || (prof ? activeInFlightTurnsRef.current.has(prof) : false)) {
            return
          }

          const currentTurn = activeTurnsRef.current[sid] || (prof ? activeTurnsRef.current[prof] : undefined)
          const nextText = (currentTurn?.streamingText || '') + event.payload.text
          if (activeTurnsRef.current[sid]) {
            activeTurnsRef.current[sid].streamingText = nextText
          }
          if (prof && activeTurnsRef.current[prof]) {
            activeTurnsRef.current[prof].streamingText = nextText
          }
          scheduleThrottledTurnPersistence()
          if (doesSessionMatchTurn(selectedRef.current, sid, prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            setStreaming(nextText)
          }
        }
      }
      if (event.type === 'tool.start' || event.type === 'tool.started' || event.type === 'tool.generating') {
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
        const id = String(event.payload.tool_id || event.payload.name || event.payload.tool_name || `tool-${Date.now()}`)
        const toolName = String(event.payload.name || event.payload.tool_name || event.payload.tool || 'tool')
        const summary = typeof event.payload.context === 'string' ? event.payload.context : undefined
        if (doesSessionMatchTurn(selectedRef.current, sid, prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
          setToolActivities(items => [
            ...(Array.isArray(items) ? items : []).filter(item => item && item.id !== id),
            { id, name: toolName, status: 'running', summary },
          ])
        }
      }
      if (event.type === 'tool.complete' || event.type === 'tool.completed') {
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
        const id = String(event.payload.tool_id || event.payload.name || event.payload.tool_name || `tool-${Date.now()}`)
        const toolName = String(event.payload.name || event.payload.tool_name || event.payload.tool || 'tool')
        const duration_s = typeof event.payload.duration_s === 'number' ? event.payload.duration_s : undefined
        const summary = typeof event.payload.summary === 'string' ? event.payload.summary : undefined
        if (doesSessionMatchTurn(selectedRef.current, sid, prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
          setToolActivities(items => [
            ...(Array.isArray(items) ? items : []).filter(item => item && item.id !== id),
            { id, name: toolName, status: 'done', duration_s, summary },
          ])
        }
      }
      if (event.type === 'status.update') {
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
        const kind = String(event.payload.kind || '')
        const text = String(event.payload.text || '')
        if (doesSessionMatchTurn(selectedRef.current, sid, prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
          if (kind === 'compacting' || /compact|compress/i.test(text)) {
            setActiveTurns(prev => {
              const current = prev[sid] || (prof ? prev[prof] : undefined)
              if (!current) return prev
              const updated = { ...current, statusText: 'Compressing context…' }
              const next = { ...prev, [sid]: updated }
              if (prof) next[prof] = updated
              return next
            })
          }
        }
      }
      if (event.type === 'request.clarify') {
        const reqId = String(event.payload.requestId || event.payload.id || '')
        const rawQuestions = event.payload.questions
        const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q: any, idx: number) => ({
          qid: String(q?.qid || `q_${idx + 1}`),
          question: String(q?.question || 'Please clarify:'),
          choices: Array.isArray(q?.choices) ? q.choices.map(String) : null,
          multi_select: Boolean(q?.multi_select),
        }))
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
          || (selectedRef.current && doesSessionMatchTurn(selectedRef.current, sid, '', profilesRef.current, undefined, adhocSessionIdsRef.current) ? selectedRef.current.profile : null)

        console.log('[Hermes Debug] onGatewayGlobalEvent request.clarify:', reqId, 'sid:', sid, 'resolved profile:', prof)

        if (!prof) {
          console.warn('[Hermes Debug] request.clarify arrived for unknown profile/session:', sid)
          return
        }

        const req: ClarifyRequest = { requestId: reqId, sessionId: sid, questions }
        pendingClarifyRef.current[sid] = req
        const isCanonical = isSessionCanonical({ id: sid, profile: prof }, profilesRef.current, adhocSessionIdsRef.current)
        if (isCanonical) {
          pendingClarifyByProfileRef.current[prof] = req
        }
        persistClarify(req, prof, isCanonical)
        if (doesSessionMatchTurn(selectedRef.current, sid, prof, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
          setPendingClarify(req)
          setSending(true)
        }
        setActiveTurns(prev => {
          const current = prev[sid] || (isCanonical ? prev[prof] : undefined) || {
            sessionId: sid,
            profile: prof,
            status: 'thinking',
            statusText: 'Thinking…',
            streamingText: '',
            toolActivities: [],
            userMessage: { id: 0, role: 'user', content: '' },
            startedAt: Date.now(),
          }
          const updated = {
            ...current,
            sessionId: sid,
            status: 'waiting' as const,
            statusText: 'Needs your input…',
            needsInput: true,
            pendingClarify: req,
          }
          const next = { ...prev, [sid]: updated }
          if (isCanonical) next[prof] = updated
          return next
        })
      }
      if (event.type === 'message.complete' || event.type === 'turn.end' || event.type === 'turn.error') {
        const sid = event.sessionId || ''
        const prof = resolveProfileForSessionId(sid, profilesRef.current, sessionsRef.current, activeTurnsRef.current)
          || (selectedRef.current && doesSessionMatchTurn(selectedRef.current, sid, '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current)) ? selectedRef.current.profile : null)

        if (sid || prof) {
          if (sid) recentEndedTurnsRef.current.set(sid, Date.now())
          if (prof) recentEndedTurnsRef.current.set(prof, Date.now())
          if (sid) activeInFlightTurnsRef.current.end(sid)
          if (prof) activeInFlightTurnsRef.current.end(prof)

          const isMatchingSelected = doesSessionMatchTurn(
            selectedRef.current,
            sid,
            prof || '',
            profilesRef.current,
            id => getResolvedSessionId(id, activeEndpointRef.current),
            adhocSessionIdsRef.current
          )

          if (isMatchingSelected) {
            setSending(false)
            setStreaming('')
            setToolActivities([])
            setPendingClarify(null)
            if (typeof event.payload.text === 'string' && event.payload.text.trim()) {
              const completeMsg: LiveMessage = {
                id: -Date.now(),
                role: 'assistant',
                content: event.payload.text,
                timestamp: Math.floor(Date.now() / 1000),
              }
              setMessages(prev => deduplicateConsecutiveMessages([...prev, completeMsg]))
              const curId = selectedRef.current?.id
              if (curId) {
                const cached = messageCacheRef.current.get(curId) || []
                const nextCached = deduplicateConsecutiveMessages([...cached, completeMsg])
                messageCacheRef.current.set(curId, nextCached)
                setCachedSessionMessages(curId, nextCached)
              }
            }
          }

          // Clear any persisted clarify for this session or profile
          clearPersistedClarify(sid, prof)
          if (selectedRef.current?.id) clearPersistedClarify(selectedRef.current.id, selectedRef.current.profile)

          setActiveTurns(prev => {
            let changed = false
            const next = { ...prev }
            for (const [key, turn] of Object.entries(next)) {
              const turnMatches = Boolean(
                key === sid ||
                key === prof ||
                (turn && (
                  turn.sessionId === sid ||
                  turn.profile === prof ||
                  doesSessionMatchTurn(turn.sessionId ? { id: turn.sessionId, profile: turn.profile || prof || '', title: 'Bot Chat', preview: '' } : null, sid, turn.profile || prof || '', profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)
                ))
              )
              if (turnMatches) {
                activeInFlightTurnsRef.current.end(key)
                if (turn?.profile) activeInFlightTurnsRef.current.end(turn.profile)
                if (turn?.sessionId) activeInFlightTurnsRef.current.end(turn.sessionId)
                delete next[key]
                changed = true
              }
            }
            return changed ? next : prev
          })

          void refresh()
        }
      }
    }, activeEndpoint)
  }, [activeEndpoint, refresh])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const bootstrap = async () => {
      // Post-mount cache warmup: pre-populate in-memory caches from localStorage safely
      try {
        const index = parseCachedSessionIndex(localStorage.getItem('hermes-msgs-v1:__index__'))
        for (const sid of index.slice(0, MAX_CACHED_SESSIONS)) {
          const msgs = getCachedSessionMessages(sid)
          if (msgs) messageCacheRef.current.set(sid, msgs)
        }
      } catch {}

      if (!lastReadCacheRef.current) {
        lastReadCacheRef.current = initializeLastReadMap()
      }

      if (DEV_FORCE_LANDING_PAGE) {
        if (active) {
          setNeedsOnboarding(true)
          setLoading(false)
        }
        return
      }

      let nativeEndpoint: string | null = null
      try { nativeEndpoint = await savedHermesEndpoint() }
      catch (reason) { if (active) setError(errorMessage(reason, 'Could not restore the saved Hermes host.')) }
      if (!active) return

      const localEndpoint = typeof localStorage !== 'undefined' ? localStorage.getItem('hermes-mobile-active-endpoint') : null
      const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem('hermes-mobile-onboarding-dismissed') === 'true'

      const decision = decideOnboardingBootstrapState(nativeEndpoint, localEndpoint, dismissed)
      if (decision.needsOnboarding) {
        if (active) {
          setNeedsOnboarding(true)
          setLoading(false)
        }
        return
      }

      if (active) {
        setNeedsOnboarding(false)
      }

      const endpoint = activateEndpoint(decision.endpointToActivate)
      await refresh(endpoint, true, true)
      if (active) timer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return
        if (navigationRef.current.selected || sendingRef.current) return
        void refresh(activeEndpointRef.current, false, false)
      }, 15_000)
    }
    void bootstrap()
    return () => { active = false; if (timer) window.clearInterval(timer); refreshEpochRef.current.begin() }
  }, [])

  useEffect(() => {
    const resumeSavedConnection = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const saved = await savedHermesEndpoint()
        if (!saved) return
        const endpoint = activateEndpoint(saved)
        await refresh(endpoint, true)
      } catch (reason) {
        const message = errorMessage(reason, 'Could not restore the saved Hermes host.')
        lastConnectionErrorRef.current = message
        setError(message)
        setConnectionStatus('disconnected')
      }
    }
    document.addEventListener('visibilitychange', resumeSavedConnection)
    return () => document.removeEventListener('visibilitychange', resumeSavedConnection)
  }, [])

  const lastReadCacheRef = useRef<Map<string, number> | null>(null)

  const getLastReadTime = useCallback((sid: string): number => {
    if (!sid) return 0
    if (!lastReadCacheRef.current) {
      lastReadCacheRef.current = initializeLastReadMap()
    }
    const endpointKey = getEndpointStorageKey(activeEndpointRef.current)
    const scopedKey = `${endpointKey}:${sid}`
    return (
      lastReadCacheRef.current.get(scopedKey) ??
      lastReadCacheRef.current.get(sid) ??
      0
    )
  }, [])
  const pendingLastReadTimersRef = useRef<Map<string, number>>(new Map())
  const setLastReadTime = useCallback((sid: string, val: number) => {
    if (!sid) return
    if (!lastReadCacheRef.current) {
      lastReadCacheRef.current = initializeLastReadMap()
    }
    const endpointKey = getEndpointStorageKey(activeEndpointRef.current)
    const scopedKey = `${endpointKey}:${sid}`
    lastReadCacheRef.current.set(scopedKey, val)
    lastReadCacheRef.current.set(sid, val)

    const existing = pendingLastReadTimersRef.current.get(scopedKey)
    if (existing != null) globalThis.clearTimeout(existing)
    const timer = globalThis.setTimeout(() => {
      pendingLastReadTimersRef.current.delete(scopedKey)
      try {
        localStorage.setItem(`hermes-last-read:${scopedKey}`, String(val))
        localStorage.setItem(`hermes-last-read:${sid}`, String(val))
      } catch {}
    }, 100) as unknown as number
    pendingLastReadTimersRef.current.set(scopedKey, timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of pendingLastReadTimersRef.current.values()) {
        globalThis.clearTimeout(timer)
      }
      pendingLastReadTimersRef.current.clear()
    }
  }, [])

  const canonicalSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const p of profiles) {
      if (p.canonical_session?.id) set.add(p.canonical_session.id)
      if (p.canonical_session?.resolved_id) set.add(p.canonical_session.resolved_id)
      if (p.last_session?.id && p.last_session.title === 'Bot Chat') set.add(p.last_session.id)
    }
    return set
  }, [profiles])

  const adhocSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessions) {
      if (!canonicalSessionIds.has(s.id) && s.title !== 'Bot Chat') {
        set.add(s.id)
      }
    }
    adhocSessionIdsRef.current = set
    return set
  }, [sessions, canonicalSessionIds])

  const rows = useMemo(() => buildBotRows(profiles, sessions).map(({ profile, session }) => {
    const sid = session ? resolveCanonicalSessionId(session) : ''
    const cached = sid ? messageCacheRef.current.get(sid) : null
    const latestPreview = resolveLatestSessionPreview(sid, session?.preview, cached || undefined, session?.last_active)
    const lastRead = getLastReadTime(sid)
    const activeTurn = isBotRowWorking(profile.name, session || profile.canonical_session, activeTurns, adhocSessionIds)
    const isWaitingInput = Boolean(activeTurn && (activeTurn.status === 'waiting' || activeTurn.needsInput))
    const { isUnread, unreadCount } = calculateUnreadState(
      sid,
      session?.last_active,
      cached || undefined,
      lastRead,
      Boolean(selected?.id === sid),
      isWaitingInput
    )

    return {
      profile,
      session: session ? {
        id: sid,
        title: profile.display_name || titleize(profile.name),
        preview: latestPreview,
        profile: profile.name,
        model: profile.model,
        last_active: session.last_active,
        unread: isUnread,
        unread_count: unreadCount,
      } satisfies LiveSession : null,
    }
  }).filter(row => `${row.profile.name} ${row.profile.display_name || ''} ${row.session?.preview || ''}`.toLowerCase().includes(query.toLowerCase())), [profiles, sessions, activeTurns, selected?.id, query, adhocSessionIds])

  const visibleSessions = useMemo(() => {
    const seenIds = new Set<string>()
    const deduped: LiveSession[] = []
    for (const session of sessions) {
      const canonicalKey = getResolvedSessionId(session.id, activeEndpointRef.current) || session.id
      if (!seenIds.has(session.id) && !seenIds.has(canonicalKey)) {
        seenIds.add(session.id)
        seenIds.add(canonicalKey)
        deduped.push(session)
      }
    }

    return deduped.filter(session => isHumanChatSession(session, canonicalSessionIds) && `${session.title} ${session.profile} ${session.preview}`.toLowerCase().includes(query.toLowerCase())).map(session => {
      const cached = messageCacheRef.current.get(session.id)
      const latestPreview = resolveLatestSessionPreview(session.id, session.preview, cached || undefined, session.last_active)
      const lastRead = getLastReadTime(session.id)
      const activeTurn = isSessionRowWorking(session.id, session.profile, activeTurns)
      const isWaitingInput = Boolean(activeTurn && (activeTurn.status === 'waiting' || activeTurn.needsInput))
      const { isUnread, unreadCount } = calculateUnreadState(
        session.id,
        session.last_active,
        cached || undefined,
        lastRead,
        Boolean(selected?.id === session.id),
        isWaitingInput
      )

      return {
        ...session,
        preview: latestPreview,
        unread: isUnread,
        unread_count: unreadCount,
      }
    })
  }, [sessions, canonicalSessionIds, activeTurns, selected?.id, query])
  const profileMap = useMemo(() => new Map(profiles.map(p => [p.name, p])), [profiles])
  const sessionOpenTraceMapRef = useRef<Map<string, string>>(new Map())
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null)
  const openingSessionIdRef = useRef<string | null>(openingSessionId)
  openingSessionIdRef.current = openingSessionId
  const navigationIntentRef = useRef(0)
  const cachedHydrationRafRef = useRef<number | null>(null)
  const cachedHydrationTimerRef = useRef<number | null>(null)
  const hydrationTokenRef = useRef<number>(0)
  const networkLoadedRequestIdRef = useRef<number>(0)

  const cancelPendingCachedHydration = useCallback(() => {
    hydrationTokenRef.current++
    if (cachedHydrationRafRef.current != null) {
      try { cancelAnimationFrame(cachedHydrationRafRef.current) } catch {}
      cachedHydrationRafRef.current = null
    }
    if (cachedHydrationTimerRef.current != null) {
      try { window.clearTimeout(cachedHydrationTimerRef.current) } catch {}
      cachedHydrationTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      navigationIntentRef.current++
      cancelPendingCachedHydration()
    }
  }, [cancelPendingCachedHydration])

  const openSession = useCallback((session: LiveSession, latestUsage?: LiveUsage): Promise<void> => {
    cancelPendingCachedHydration()
    const hydrationToken = ++hydrationTokenRef.current
    const safeSession: LiveSession = {
      ...session,
      profile: session.profile || 'default',
      title: session.title || 'Untitled session',
      preview: session.preview || '',
    }
    remoteLog('DEBUG', 'OpenSession', `Opening session ${safeSession.id} (${safeSession.profile}) "${safeSession.title}"`)
    const requestId = ++sessionLoadRef.current
    const isCanonical = isSessionCanonical(safeSession, profilesRef.current, adhocSessionIdsRef.current)
    const activeTurn = Object.values(activeTurnsRef.current).find(t =>
      t && doesSessionMatchTurn(safeSession, t.sessionId || '', t.profile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)
    )

    // Candidate alias IDs across canonical and gateway runtime remappings
    const candidateIds = [
      safeSession.id,
      getResolvedSessionId(safeSession.id, activeEndpointRef.current),
      isCanonical ? `draft:${safeSession.profile}` : undefined,
      isCanonical ? profilesRef.current.find(p => p.name === safeSession.profile)?.canonical_session?.id : undefined,
      isCanonical ? profilesRef.current.find(p => p.name === safeSession.profile)?.canonical_session?.resolved_id : undefined,
    ].filter((id): id is string => Boolean(id))

    // Fast-path: check in-memory cache first across all candidate IDs (0ms)
    let cached: LiveMessage[] | undefined = undefined
    for (const cid of candidateIds) {
      const memoryFound = messageCacheRef.current.get(cid)
      if (memoryFound && memoryFound.length > 0) {
        cached = memoryFound
        break
      }
    }
    // If not in memory, check localStorage across candidate IDs until first match is found
    if (!cached) {
      for (const cid of candidateIds) {
        const diskFound = getCachedSessionMessages(cid)
        if (diskFound && diskFound.length > 0) {
          cached = diskFound
          messageCacheRef.current.set(cid, diskFound)
          break
        }
      }
    }

    const perfTraceId = startPerformanceTrace('session_open')
    sessionOpenTraceMapRef.current.set(safeSession.id, perfTraceId)
    recordTracePhase(perfTraceId, 'cache_read_end', {
      isCacheHit: Boolean(cached && cached.length > 0),
      cachedCount: cached?.length || 0,
      sessionId: safeSession.id,
      profile: safeSession.profile,
    })

    // Immediately mark session as read on Frame 0
    try {
      const nowMs = Date.now()
      setLastReadTime(safeSession.id, nowMs)
      const matchedProfile = profilesRef.current.find(p => p.name === safeSession.profile)
      if (matchedProfile?.canonical_session?.id) {
        setLastReadTime(matchedProfile.canonical_session.id, nowMs)
      }
    } catch {}

    const adhocSet = new Set(sessionsRef.current.map(s => s.id))
    const matchingClarify = resolveMatchingClarify({
      session: safeSession,
      profiles: profilesRef.current,
      activeTurn,
      pendingClarifyBySession: pendingClarifyRef.current,
      pendingClarifyByProfile: pendingClarifyByProfileRef.current,
      getPersistedClarify,
      adhocSessionIds: adhocSet,
    })
    const isTurnInFlight = Boolean(
      (isCanonical && (
        activeInFlightTurnsRef.current.has(safeSession.profile) ||
        activeInFlightTurnsRef.current.has(`draft:${safeSession.profile}`)
      )) ||
      activeInFlightTurnsRef.current.has(safeSession.id)
    )
    const isCachedSettled = isTurnSettledByTranscript(activeTurn, cached, isTurnInFlight)

    if (sessionLoadRef.current !== requestId) return Promise.resolve()
    // Mount ChatView via startTransition so the browser never blocks on the view commit
    const tDispatchStart = performance.now()
    startTransition(() => {
      if (sessionLoadRef.current !== requestId) return
      setSelected(current => (sessionLoadRef.current !== requestId ? current : safeSession))
      setOpeningSessionId(current => (sessionLoadRef.current !== requestId ? current : null))
      if (sessionLoadRef.current === requestId) {
        openingSessionIdRef.current = null
      }
      setPendingClarify(current => (sessionLoadRef.current !== requestId ? current : matchingClarify))
      setProfileSheet(current => (sessionLoadRef.current !== requestId ? current : false))
      setSettledAssistant(current => (sessionLoadRef.current !== requestId ? current : null))
      setError(current => (sessionLoadRef.current !== requestId ? current : ''))

      if (matchingClarify || shouldShowWorkingIndicator(activeTurn, isCachedSettled)) {
        setSending(current => (sessionLoadRef.current !== requestId ? current : true))
        setStreaming(current => (sessionLoadRef.current !== requestId ? current : (activeTurn?.streamingText || '')))
        setToolActivities(current => (sessionLoadRef.current !== requestId ? current : (activeTurn?.toolActivities || [])))
        setConversationLoading(current => (sessionLoadRef.current !== requestId ? current : false))
        const nextMsgs = activeTurn?.userMessage
          ? (isOptimisticUserMessageAlreadyCached(cached, activeTurn.userMessage) ? (cached || []) : (cached ? [...cached, activeTurn.userMessage] : [activeTurn.userMessage]))
          : (cached || [])
        setMessages(current => (sessionLoadRef.current !== requestId ? current : nextMsgs))
      } else {
        setSending(current => (sessionLoadRef.current !== requestId ? current : false))
        setStreaming(current => (sessionLoadRef.current !== requestId ? current : ''))
        setToolActivities(current => (sessionLoadRef.current !== requestId ? current : []))
        const hasCached = Boolean(cached && cached.length > 0)
        setConversationLoading(current => (sessionLoadRef.current !== requestId ? current : (!hasCached && !safeSession.id.startsWith('draft:'))))
        setMessages(current => (sessionLoadRef.current !== requestId ? current : (hasCached ? cached! : [])))
      }
    })
    recordTracePhase(perfTraceId, 'selection_dispatch_end', {
      dispatchMs: Math.round((performance.now() - tDispatchStart) * 100) / 100,
    })

    // Rebind session on gateway to retrieve any in-flight open_requests (e.g. clarify from background run)
    void resumeSession(safeSession.id, safeSession.profile, activeEndpointRef.current).catch(() => {})

    return (async () => {
      try {
        const loaded = await loadMessages(safeSession.id, safeSession.profile, activeEndpointRef.current)
        recordTracePhase(perfTraceId, 'network_response', { loadedCount: loaded.length })
        if (requestId !== sessionLoadRef.current) return
        networkLoadedRequestIdRef.current = requestId
        cancelPendingCachedHydration()
        const latestAssistant = latestUsage ? [...loaded].reverse().findIndex(message => message.role === 'assistant') : -1
        const resolvedLoaded = latestAssistant >= 0 ? loaded.map((message, index) => index === loaded.length - latestAssistant - 1 ? { ...message, usage: latestUsage } : message) : loaded

        const isTurnActive = Boolean(
          Object.values(activeTurnsRef.current).some(t =>
            t && doesSessionMatchTurn(safeSession, t.sessionId || '', t.profile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)
          ) ||
          activeInFlightTurnsRef.current.has(safeSession.id) ||
          (isCanonical && (
            activeInFlightTurnsRef.current.has(safeSession.profile) ||
            activeInFlightTurnsRef.current.has(`draft:${safeSession.profile}`)
          ))
        )
        const existingMessages = (() => {
          for (const cid of candidateIds) {
            const found = messageCacheRef.current.get(cid) || getCachedSessionMessages(cid)
            if (found && found.length > 0) return found
          }
          return messageCacheRef.current.get(safeSession.id) || []
        })()
        if (shouldRetainLocalMessages(resolvedLoaded, existingMessages, isTurnActive)) {
          // Do not overwrite optimistic user messages with empty array from unset SQLite backend
          if (requestId === sessionLoadRef.current) {
            setConversationLoading(false)
            if (existingMessages.length > 0) {
              setMessages(existingMessages)
            }
          }
          return
        }

        const isTranscriptIdentical = areMessageListsShallowEqual(existingMessages, resolvedLoaded)

        if (!isTranscriptIdentical) {
          const uniqueAliasIds = Array.from(new Set(candidateIds))
          for (const cid of uniqueAliasIds) {
            messageCacheRef.current.set(cid, resolvedLoaded)
          }
          // Coalesce and defer writing the canonical transcript and candidate aliases to disk in idle time
          scheduleDeferredSessionPersistence(uniqueAliasIds, resolvedLoaded)
        }

        const currentActive = Object.values(activeTurnsRef.current).find(t =>
          t && doesSessionMatchTurn(safeSession, t.sessionId || '', t.profile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)
        )
        const isTurnInFlightAsync = Boolean(
          activeInFlightTurnsRef.current.has(safeSession.id) ||
          (isCanonical && (
            activeInFlightTurnsRef.current.has(safeSession.profile) ||
            activeInFlightTurnsRef.current.has(`draft:${safeSession.profile}`)
          ))
        )
        const isTranscriptSettled = isTurnSettledByTranscript(currentActive, resolvedLoaded, isTurnInFlightAsync)

        // Session-scoped turn settlement reconciliation: cleanup active turn identity-safely
        // even if user already navigated back to roster before loadMessages completed
        remoteLog('DEBUG', 'Settlement', `Session ${safeSession.id}: isTranscriptSettled=${isTranscriptSettled}, hadActive=${Boolean(currentActive)}`)
        if (isTranscriptSettled) {
          settleGatewayTurn(safeSession.id, activeEndpointRef.current)
          if (currentActive) {
            recentEndedTurnsRef.current.set(safeSession.id, Date.now())
            setActiveTurns(prev => reconcileSettledSessionTurn(
              prev,
              safeSession,
              profilesRef.current,
              id => getResolvedSessionId(id, activeEndpointRef.current),
              adhocSessionIdsRef.current
            ))
          }
        }

        // Visible UI screen guard: do not overwrite current view if user already navigated away
        if (requestId !== sessionLoadRef.current || selectedRef.current?.id !== safeSession.id) return

        if (isTranscriptSettled) {
          // If the turn has legitimately settled, clear sending and active turn
          setSending(false)
          setStreaming('')
          setToolActivities([])
        } else if (currentActive) {
          // Turn is still active: maintain live sending and tool activity state
          setSending(true)
          setStreaming(currentActive.streamingText)
          setToolActivities(currentActive.toolActivities)
        }

        if (currentActive?.userMessage && !isTranscriptSettled) {
          const hasUserMsg = resolvedLoaded.some(m => m.id === currentActive.userMessage?.id || (m.role === 'user' && m.content === currentActive.userMessage?.content))
          const merged = hasUserMsg ? resolvedLoaded : [...resolvedLoaded, currentActive.userMessage]
          setMessages(deduplicateConsecutiveMessages(merged))
        } else if (!isTranscriptIdentical || !existingMessages.length) {
          setMessages(deduplicateConsecutiveMessages(resolvedLoaded))
        }
        recordTracePhase(perfTraceId, 'network_state_applied', { count: resolvedLoaded.length })
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            recordTracePhase(perfTraceId, 'transcript_commit', { renderedCount: resolvedLoaded.length })
            finishPerformanceTrace(perfTraceId, 'settle', { totalMessages: resolvedLoaded.length })
            sessionOpenTraceMapRef.current.delete(safeSession.id)
          })
        } else {
          finishPerformanceTrace(perfTraceId, 'settle', { totalMessages: resolvedLoaded.length })
          sessionOpenTraceMapRef.current.delete(safeSession.id)
        }
      }
      catch (reason) {
        if (requestId === sessionLoadRef.current) {
          if (!messageCacheRef.current.get(safeSession.id)?.length) {
            setError(reason instanceof Error ? reason.message : 'Could not load this Hermes conversation.')
          }
        }
      }
      finally {
        if (requestId === sessionLoadRef.current) setConversationLoading(false)
      }
    })()
  }, [])

  const loadEarlierMessages = useCallback(async (): Promise<boolean> => {
    const curSession = selectedRef.current
    if (!curSession || curSession.id.startsWith('draft:')) return false
    const currentList = messagesRef.current || []
    const offset = currentList.length
    try {
      const older = await loadMessages(curSession.id, curSession.profile, activeEndpointRef.current, offset, 80)
      if (!older || older.length === 0) return false

      // Guard: Discard stale page if user navigated away or switched session
      if (selectedRef.current?.id !== curSession.id) return false

      const existingIds = new Set(currentList.map(m => m.id))
      const novelOlder = older.filter(m => !existingIds.has(m.id))
      if (novelOlder.length === 0) return false

      const merged = deduplicateConsecutiveMessages([...novelOlder, ...currentList])
      setMessages(merged)
      messageCacheRef.current.set(curSession.id, merged)
      setCachedSessionMessages(curSession.id, merged)
      return novelOlder.length >= 80
    } catch {
      return false
    }
  }, [])

  const [creatingSession, setCreatingSession] = useState(false)

  const handleNewSession = useCallback(async (profileName?: string) => {
    if (creatingSession) return
    const targetProfile = profileName || (profiles[0]?.name ?? 'default')
    setCreatingSession(true)
    setError('')
    try {
      const newSession = await createSession(targetProfile, 'New chat', activeEndpointRef.current)
      setSessions(prev => [newSession, ...prev.filter(s => s.id !== newSession.id)])
      void openSession(newSession)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create new session.')
    } finally {
      setCreatingSession(false)
    }
  }, [creatingSession, profiles, openSession])

  const handleAnswerClarify = useCallback((requestId: string, answers: Record<string, string | null>) => {
    const currentSessionId = selectedRef.current?.id
    const currentProfile = selectedRef.current?.profile
    console.log('[Hermes Debug] handleAnswerClarify:', requestId, 'currentSessionId:', currentSessionId, 'currentProfile:', currentProfile, answers)
    
    // Construct and optimistically commit the historical Clarify tool message so the bubble renders immediately
    const questions = pendingClarify?.questions || []
    const responses = questions.map(q => {
      const ans = answers[q.qid]
      return {
        question: q.question,
        choices_offered: q.choices || [],
        status: (ans !== null && ans !== undefined && ans !== '') ? 'answered' : 'skipped',
        user_response: ans || null,
      }
    })
    const toolMsgContent = JSON.stringify({
      responses,
      outcome: 'answered',
    })
    const optimisticToolMessage: LiveMessage = {
      id: -Date.now(),
      role: 'tool',
      tool_name: 'clarify',
      content: toolMsgContent,
      timestamp: Math.floor(Date.now() / 1000),
    }

    if (currentSessionId) {
      setMessages(prev => [...prev, optimisticToolMessage])
      const cached = messageCacheRef.current.get(currentSessionId) || []
      const nextCached = [...cached, optimisticToolMessage]
      messageCacheRef.current.set(currentSessionId, nextCached)
      setCachedSessionMessages(currentSessionId, nextCached)
      delete pendingClarifyRef.current[currentSessionId]
    }
    if (currentProfile) {
      delete pendingClarifyByProfileRef.current[currentProfile]
    }
    clearPersistedClarify(currentSessionId, currentProfile)
    setPendingClarify(null)
    setSending(true)
    setToolActivities(items => (Array.isArray(items) ? items : []).map(t =>
      t && t.name === 'clarify' ? { ...t, status: 'done' as const } : t
    ))
    respondClarify(requestId, answers, activeEndpointRef.current)
    if (currentProfile) {
      activeInFlightTurnsRef.current.start(currentProfile)
    }
    if (currentSessionId) {
      activeInFlightTurnsRef.current.start(currentSessionId)
    }
    setActiveTurns(prev => {
      const next = { ...prev }
      const targetKeys = new Set([currentProfile, currentSessionId].filter(Boolean) as string[])
      for (const [k, t] of Object.entries(prev)) {
        if (t && (t.profile === currentProfile || t.sessionId === currentSessionId)) {
          targetKeys.add(k)
        }
      }
      for (const key of targetKeys) {
        const cur = next[key] || {
          sessionId: currentSessionId,
          profile: currentProfile || 'default',
          userMessage: { id: 0, role: 'user', content: '' },
          startedAt: Date.now(),
        }
        next[key] = {
          ...cur,
          status: 'thinking',
          statusText: 'Processing response…',
          needsInput: false,
          pendingClarify: null,
          toolActivities: (cur.toolActivities || []).map(t =>
            t && t.name === 'clarify' ? { ...t, status: 'done' as const } : t
          ),
        }
      }
      return next
    })
  }, [pendingClarify])

  const handleSkipClarify = useCallback((requestId: string) => {
    const currentSessionId = selectedRef.current?.id
    const currentProfile = selectedRef.current?.profile
    const emptyAnswers: Record<string, string | null> = {}
    if (pendingClarify?.questions) {
      for (const q of pendingClarify.questions) emptyAnswers[q.qid] = null
    }

    // Construct and optimistically commit the historical Clarify tool message with skipped status
    const questions = pendingClarify?.questions || []
    const responses = questions.map(q => ({
      question: q.question,
      choices_offered: q.choices || [],
      status: 'skipped',
      user_response: null,
    }))
    const toolMsgContent = JSON.stringify({
      responses,
      outcome: 'skipped',
    })
    const optimisticToolMessage: LiveMessage = {
      id: -Date.now(),
      role: 'tool',
      tool_name: 'clarify',
      content: toolMsgContent,
      timestamp: Math.floor(Date.now() / 1000),
    }

    if (currentSessionId) {
      setMessages(prev => [...prev, optimisticToolMessage])
      const cached = messageCacheRef.current.get(currentSessionId) || []
      const nextCached = [...cached, optimisticToolMessage]
      messageCacheRef.current.set(currentSessionId, nextCached)
      setCachedSessionMessages(currentSessionId, nextCached)
      delete pendingClarifyRef.current[currentSessionId]
    }
    if (currentProfile) {
      delete pendingClarifyByProfileRef.current[currentProfile]
    }
    clearPersistedClarify(currentSessionId, currentProfile)
    setPendingClarify(null)
    setSending(true)
    respondClarify(requestId, emptyAnswers, activeEndpointRef.current)
    if (currentProfile) {
      activeInFlightTurnsRef.current.start(currentProfile)
    }
    if (currentSessionId) {
      activeInFlightTurnsRef.current.start(currentSessionId)
    }
    setActiveTurns(prev => {
      const next = { ...prev }
      const targetKeys = new Set([currentProfile, currentSessionId].filter(Boolean) as string[])
      for (const [k, t] of Object.entries(prev)) {
        if (t && (t.profile === currentProfile || t.sessionId === currentSessionId)) {
          targetKeys.add(k)
        }
      }
      for (const key of targetKeys) {
        const cur = next[key] || {
          sessionId: currentSessionId,
          profile: currentProfile || 'default',
          userMessage: { id: 0, role: 'user', content: '' },
          startedAt: Date.now(),
        }
        next[key] = {
          ...cur,
          status: 'thinking',
          statusText: 'Continuing without clarification…',
          needsInput: false,
          pendingClarify: null,
          toolActivities: (cur.toolActivities || []).map(t =>
            t && t.name === 'clarify' ? { ...t, status: 'done' as const } : t
          ),
        }
      }
      return next
    })
  }, [pendingClarify])

  const submit = useCallback(async (
    attachmentRefs: { name: string; refText: string }[] = [],
    rawText = '',
    options?: { editMessageId?: number }
  ): Promise<boolean> => {
    const turnSession = selectedRef.current
    if (!turnSession || sendingRef.current) return false
    const turnProfile = turnSession.profile
    const turnSessionId = turnSession.id
    const text = rawText.trim()
    if (!text && !attachmentRefs.length) return false
    const prompt = buildAttachmentPrompt(text, attachmentRefs)
    const perfTraceId = startPerformanceTrace('prompt_submit')
    recordTracePhase(perfTraceId, 'input_handler', { promptLength: prompt.length })
    remoteLog('INFO', 'PromptSubmit', `Submit prompt in ${turnSessionId} (${turnProfile}): length=${prompt.length}`)
    let completionUsage: LiveUsage | undefined
    let finalText = ''
    const settledSnapshot = settledAssistantRef.current
    const priorSettled = settledSnapshot?.sessionId === turnSession.id && settledSnapshot.profile === turnSession.profile ? settledSnapshot : null
    const priorAssistantMessage = priorSettled ? { id: -(Date.now() + 1), role: 'assistant' as const, content: priorSettled.content, usage: priorSettled.usage } : null
    const nowSec = Math.floor(Date.now() / 1000)
    const nowMs = Date.now()
    try {
      setLastReadTime(turnSessionId, nowMs)
      setLastReadTime(turnSession.id, nowMs)
      const matchedProfile = profiles.find(p => p.name === turnProfile)
      if (matchedProfile?.canonical_session?.id) {
        setLastReadTime(matchedProfile.canonical_session.id, nowMs)
      }
    } catch {}
    const localUserMessage: LiveMessage = { id: -Date.now(), role: 'user' as const, content: attachmentSummary(text, attachmentRefs), timestamp: nowSec, local: true }

    const isCanonical = isSessionCanonical(turnSession, profiles, adhocSessionIds)

    const initialTurn: ActiveBotTurn = {
      sessionId: turnSessionId,
      profile: turnProfile,
      status: 'thinking',
      statusText: getInitialSpinnerPhrase(),
      streamingText: '',
      toolActivities: [],
      userMessage: localUserMessage,
      startedAt: Date.now(),
    }
    recentEndedTurnsRef.current.delete(turnSessionId)
    recentEndedTurnsRef.current.delete(turnSession.id)
    if (isCanonical) {
      recentEndedTurnsRef.current.delete(turnProfile)
    }

    setActiveTurns(prev => {
      const next = { ...prev, [turnSessionId]: initialTurn }
      if (isCanonical) {
        next[turnProfile] = initialTurn
      }
      return next
    })
    activeInFlightTurnsRef.current.start(turnSessionId)
    if (isCanonical) {
      activeInFlightTurnsRef.current.start(turnProfile)
    }

    setSettledAssistant(null)
    setError('')
    setSending(true)
    setStreaming('')
    setToolActivities([])

    let baseItems = messagesRef.current
    if (options?.editMessageId != null) {
      const idx = baseItems.findIndex(m => m.id === options.editMessageId)
      if (idx >= 0) baseItems = baseItems.slice(0, idx)
    }
    const lastItem = baseItems[baseItems.length - 1]
    const hasExistingAssistantAtTail = Boolean(
      lastItem &&
      lastItem.role === 'assistant' &&
      (!priorSettled || lastItem.content === priorSettled.content)
    )
    const assistantToInject = (!hasExistingAssistantAtTail && priorAssistantMessage)
      ? [priorAssistantMessage]
      : []
    const rawNext = [...baseItems, ...assistantToInject, localUserMessage]
    const nextMessages = deduplicateConsecutiveMessages(rawNext)

    setMessages(nextMessages)

    const aliasIds = new Set<string>([
      turnSessionId,
      turnSession.id,
      getResolvedSessionId(turnSessionId, activeEndpointRef.current),
    ].filter(Boolean))
    for (const aid of aliasIds) {
      messageCacheRef.current.set(aid, nextMessages)
      setCachedSessionMessages(aid, nextMessages)
    }

    const editMsgId = options?.editMessageId
    let truncateRowId: number | undefined
    let truncateOrdinal: number | undefined

    if (editMsgId != null) {
      const currentList = messagesRef.current
      const targetIndex = currentList.findIndex(m => m.id === editMsgId)
      if (targetIndex >= 0) {
        const targetMsg = currentList[targetIndex]
        if (targetMsg) {
          if (typeof targetMsg.row_id === 'number') {
            truncateRowId = targetMsg.row_id
          } else if (targetMsg.id > 0 && !targetMsg.local) {
            truncateRowId = targetMsg.id
          }
        }
        truncateOrdinal = currentList.slice(0, targetIndex).filter(m => m.role === 'user').length
      } else if (editMsgId > 0) {
        truncateRowId = editMsgId
      }
    }

    let hasRecordedFirstDelta = false
    try {
      const { finalSessionId, finalText: finalOutput, completionUsage: usage } = await executeTurnSubmissionPipeline({
        turnSessionId,
        turnProfile,
        prompt,
        activeEndpoint: activeEndpointRef.current,
        options: {
          editMessageId: editMsgId,
          truncateRowId,
          truncateOrdinal,
        },
        connectAndSubmitFn: connectAndSubmit,
        onDelta: text => {
          if (!hasRecordedFirstDelta) {
            hasRecordedFirstDelta = true
            recordTracePhase(perfTraceId, 'first_delta', { textLength: text.length })
          }
          finalText = text
          if (activeTurnsRef.current[turnSessionId]) {
            activeTurnsRef.current[turnSessionId].streamingText = text
          }
          if (isCanonical && activeTurnsRef.current[turnProfile]) {
            activeTurnsRef.current[turnProfile].streamingText = text
          }
          if (activeTurnsRef.current[turnSessionId]?.status !== 'streaming') {
            setActiveTurns(prev => {
              const current = prev[turnSessionId] || (isCanonical ? prev[turnProfile] : undefined)
              if (!current || current.status === 'streaming') return prev
              const updated = {
                ...current,
                status: 'streaming' as const,
                statusText: 'Replying…',
                streamingText: text,
              }
              const next = { ...prev, [turnSessionId]: updated }
              if (isCanonical) next[turnProfile] = updated
              return next
            })
          }
          scheduleThrottledTurnPersistence()
          if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            setStreaming(text)
          }
        },
        onComplete: (text, compUsage) => {
          finalText = text
          completionUsage = compUsage
          if (activeTurnsRef.current[turnSessionId]) {
            activeTurnsRef.current[turnSessionId].streamingText = text
          }
          if (isCanonical && activeTurnsRef.current[turnProfile]) {
            activeTurnsRef.current[turnProfile].streamingText = text
          }
          setActiveTurns(prev => {
            const current = prev[turnSessionId] || (isCanonical ? prev[turnProfile] : undefined)
            if (!current) return prev
            const updated = {
              ...current,
              streamingText: text,
            }
            const next = { ...prev, [turnSessionId]: updated }
            if (isCanonical) next[turnProfile] = updated
            return next
          })
          persistActiveTurnsSnapshot()
          if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            setStreaming(text)
          }
        },
        onToolStart: (id, toolName, summary, params) => {
          setActiveTurns(prev => {
            const current = prev[turnSessionId] || (isCanonical ? prev[turnProfile] : undefined)
            if (!current) return prev
            const safeCurrentTools = Array.isArray(current.toolActivities) ? current.toolActivities : []
            const nextTools = [
              ...safeCurrentTools.filter(t => t && t.id !== id),
              { id, name: toolName, status: 'running' as const, summary },
            ]
            const activeCount = nextTools.length
            const statusText = activeCount > 1 ? `Using ${toolName} · ${activeCount} tool calls…` : `Using ${toolName}…`
            const updated = {
              ...current,
              status: 'tool' as const,
              statusText,
              toolActivities: nextTools,
            }
            const next = { ...prev, [turnSessionId]: updated }
            if (isCanonical) next[turnProfile] = updated
            return next
          })
          if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profiles, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIds)) {
            setToolActivities(items => [
              ...(Array.isArray(items) ? items : []).filter(item => item && item.id !== id),
              { id, name: toolName, status: 'running', summary },
            ])
          }

          // Multi-agent task delegation: immediately activate working status on the receiving bot
          const targetProf = resolveDelegationTargetProfile(toolName, params, profilesRef.current)
          if (targetProf) {
            inFlightDelegationByToolId.current.set(id, targetProf)
            const matchedTarget = profilesRef.current.find(p => p.name === targetProf)
            const targetSid = matchedTarget?.canonical_session?.id || `dispatched:${targetProf}`
            setActiveTurns(prev => ({
              ...prev,
              [targetProf]: {
                sessionId: targetSid,
                profile: targetProf,
                status: 'tool',
                statusText: `Working on task from @${turnProfile}…`,
                streamingText: '',
                toolActivities: [{
                  id: `delegation-${id}`,
                  name: 'Dispatched Task',
                  status: 'running',
                  summary: `Task from @${turnProfile}`,
                }],
                userMessage: { id: -Date.now(), role: 'user', content: '' },
                startedAt: Date.now(),
              },
            }))
            activeInFlightTurnsRef.current.start(targetProf)
            activeInFlightTurnsRef.current.start(targetSid)
          }
        },
        onToolComplete: (id, toolName, duration_s, summary) => {
          setActiveTurns(prev => {
            const current = prev[turnSessionId] || (isCanonical ? prev[turnProfile] : undefined)
            if (!current) return prev
            const safeCurrentTools = Array.isArray(current.toolActivities) ? current.toolActivities : []
            const nextTools = [
              ...safeCurrentTools.filter(t => t && t.id !== id),
              { id, name: toolName, status: 'done' as const, duration_s, summary },
            ]
            const progressiveStatus = getProgressiveSpinnerPhrase(current.statusText)
            const updated = {
              ...current,
              status: 'thinking' as const,
              statusText: progressiveStatus,
              toolActivities: nextTools,
            }
            const next = { ...prev, [turnSessionId]: updated }
            if (isCanonical) next[turnProfile] = updated
            return next
          })
          if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            setToolActivities(items => [
              ...(Array.isArray(items) ? items : []).filter(item => item && item.id !== id),
              { id, name: toolName, status: 'done', duration_s, summary },
            ])
          }

          // Complete delegated turn and refresh roster
          const targetProf = inFlightDelegationByToolId.current.get(id) || resolveDelegationTargetProfile(toolName, undefined, profilesRef.current)
          if (targetProf) {
            inFlightDelegationByToolId.current.delete(id)
            const matchedTarget = profilesRef.current.find(p => p.name === targetProf)
            const targetSid = matchedTarget?.canonical_session?.id || `dispatched:${targetProf}`
            activeInFlightTurnsRef.current.end(targetProf)
            activeInFlightTurnsRef.current.end(targetSid)
            recentEndedTurnsRef.current.set(targetProf, Date.now())
            recentEndedTurnsRef.current.set(targetSid, Date.now())
            setActiveTurns(prev => {
              if (!prev[targetProf]) return prev
              const next = { ...prev }
              delete next[targetProf]
              return next
            })
            void refresh()
          }
        },
        onClarifyRequest: (requestId, rawQuestions) => {
          const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q: any, idx: number) => ({
            qid: String(q?.qid || `q_${idx + 1}`),
            question: String(q?.question || 'Please clarify:'),
            choices: Array.isArray(q?.choices) ? q.choices.map(String) : null,
            multi_select: Boolean(q?.multi_select),
          }))
          const req: ClarifyRequest = { requestId, sessionId: turnSessionId, questions }
          pendingClarifyRef.current[turnSessionId] = req
          if (isCanonical) {
            pendingClarifyByProfileRef.current[turnProfile] = req
          }
          persistClarify(req, turnProfile, isCanonical)
          if (
            doesSessionMatchTurn(
              selectedRef.current,
              turnSessionId,
              turnProfile,
              profilesRef.current,
              id => getResolvedSessionId(id, activeEndpointRef.current),
              adhocSessionIdsRef.current
            )
          ) {
            setPendingClarify(req)
          }
          setActiveTurns(prev => {
            const current = prev[turnSessionId] || (isCanonical ? prev[turnProfile] : undefined) || {
              sessionId: turnSessionId,
              profile: turnProfile,
              status: 'thinking',
              statusText: 'Thinking…',
              streamingText: '',
              toolActivities: [],
              userMessage: { id: 0, role: 'user', content: '' },
              startedAt: Date.now(),
            }
            const updated = {
              ...current,
              sessionId: turnSessionId,
              status: 'waiting' as const,
              statusText: 'Needs your input…',
              needsInput: true,
              pendingClarify: req,
            }
            const next = { ...prev, [turnSessionId]: updated }
            if (isCanonical) next[turnProfile] = updated
            return next
          })
        },
        onTitleUpdate: title => {
          setSelected(current => current ? { ...current, title } : current)
        },
        onSessionsUpdate: setSessions,
        onSelectedIdUpdate: newId => {
          setSelected(current => current?.id === turnSessionId ? { ...current, id: newId } : current)
          const req = pendingClarifyRef.current[turnSessionId]
          if (req) {
            pendingClarifyRef.current[newId] = { ...req, sessionId: newId }
          }
          // Atomically link message cache to newId so remapped IDs never load blank
          const cached = messageCacheRef.current.get(turnSessionId)
          if (cached && cached.length > 0) {
            messageCacheRef.current.set(newId, cached)
            setCachedSessionMessages(newId, cached)
          }
        },
        onError: msg => {
          if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
            setError(msg)
          }
        },
      })
      finalText = finalOutput
      completionUsage = usage
      recordTracePhase(perfTraceId, 'stream_generation', {
        totalTokens: completionUsage?.total,
        completionLength: finalText.length,
      })
      recentEndedTurnsRef.current.set(finalSessionId, Date.now())
      recentEndedTurnsRef.current.set(turnSessionId, Date.now())
      if (isCanonical) {
        recentEndedTurnsRef.current.set(turnProfile, Date.now())
      }

      delete pendingClarifyRef.current[turnSessionId]
      delete pendingClarifyRef.current[finalSessionId]
      if (isCanonical) {
        delete pendingClarifyByProfileRef.current[turnProfile]
      }
      clearPersistedClarify(turnSessionId, turnProfile)
      clearPersistedClarify(finalSessionId, turnProfile)
      if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
        setPendingClarify(null)
      }

      setActiveTurns(prev => {
        const next = { ...prev }
        delete next[turnSessionId]
        delete next[finalSessionId]
        if (isCanonical) {
          delete next[turnProfile]
        }
        return next
      })
      if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
        setToolActivities([])
      }

      // Commit finalized assistant message to timeline and cache so it never vanishes
      if (finalText.trim()) {
        const nowSec = Math.floor(Date.now() / 1000)
        const terminalMessage: LiveMessage = {
          id: -Date.now(),
          role: 'assistant',
          content: finalText,
          usage: completionUsage,
          timestamp: nowSec,
        }
        if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last && (last.id === terminalMessage.id || (last.role === 'assistant' && last.content === terminalMessage.content))) {
              return prev
            }
            return [...prev, terminalMessage]
          })
        }
        const sids = new Set([finalSessionId, turnSessionId].filter(Boolean))
        for (const sid of sids) {
          const cached = messageCacheRef.current.get(sid) || []
          const last = cached[cached.length - 1]
          const nextCached = (last && (last.id === terminalMessage.id || (last.role === 'assistant' && last.content === terminalMessage.content)))
            ? cached
            : [...cached, terminalMessage]
          messageCacheRef.current.set(sid, nextCached)
          setCachedSessionMessages(sid, nextCached)
        }
      }

      const terminalAssistant = settleAssistantResponse(finalSessionId, turnProfile, finalText, completionUsage)
      if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
        if (terminalAssistant) {
          setSettledAssistant(terminalAssistant)
          setSending(false)
          setStreaming('')
        } else {
          await openSession(turnSession, completionUsage)
        }
      }

      // Auto-title session if it was newly created and untitled
      const currentTitle = selectedRef.current?.title || turnSession.title || ''
      if (!currentTitle || currentTitle === 'New chat' || currentTitle === 'Untitled session') {
        const derivedTitle = generateSessionTitle(prompt)
        if (derivedTitle) {
          setSelected(current => current ? { ...current, title: derivedTitle } : current)
          setSessions(items => items.map(s => s.id === finalSessionId ? { ...s, title: derivedTitle } : s))
          void updateSessionTitle(finalSessionId, derivedTitle, activeEndpointRef.current).catch(() => {})
        }
      }

      // Mark the current session as read ONLY if the user is still actively viewing this session!
      if (selectedRef.current?.id === finalSessionId || selectedRef.current?.id === turnSessionId) {
        try {
          const nowMs = Date.now()
          localStorage.setItem(`hermes-last-read:${finalSessionId}`, String(nowMs))
          localStorage.setItem(`hermes-last-read:${turnSessionId}`, String(nowMs))
          const matchedProfile = profilesRef.current.find(p => p.name === turnProfile)
          if (matchedProfile?.canonical_session?.id) {
            localStorage.setItem(`hermes-last-read:${matchedProfile.canonical_session.id}`, String(nowMs))
          }
        } catch {}
      }

      await refresh()
      finishPerformanceTrace(perfTraceId, 'final_settle', { totalTextLength: finalText.length })
      return true
    } catch (reason) {
      for (const [_, prof] of inFlightDelegationByToolId.current.entries()) {
        activeInFlightTurnsRef.current.end(prof)
        setActiveTurns(prev => {
          if (!prev[prof]) return prev
          const next = { ...prev }
          delete next[prof]
          return next
        })
      }
      inFlightDelegationByToolId.current.clear()
      recentEndedTurnsRef.current.set(turnSessionId, Date.now())
      setActiveTurns(prev => {
        const next = { ...prev }
        delete next[turnSessionId]
        if (isCanonical) {
          delete next[turnProfile]
        }
        return next
      })
      setToolActivities([])
      if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
        setError(reason instanceof Error ? reason.message : 'Could not send to Hermes.')
        setSending(false)
        setStreaming('')
      }
      return false
    } finally {
      activeInFlightTurnsRef.current.end(turnSessionId)
      if (isCanonical) {
        activeInFlightTurnsRef.current.end(turnProfile)
      }
      setToolActivities([])
      if (doesSessionMatchTurn(selectedRef.current, turnSessionId, turnProfile, profilesRef.current, id => getResolvedSessionId(id, activeEndpointRef.current), adhocSessionIdsRef.current)) {
        setSending(false)
        setStreaming('')
      }
    }
  }, [openSession, refresh])

  const stop = useCallback(async () => {
    const turnSession = selectedRef.current
    if (!turnSession || !sendingRef.current) return
    recentEndedTurnsRef.current.set(turnSession.id, Date.now())
    setActiveTurns(prev => {
      const next = { ...prev }
      delete next[turnSession.profile]
      return next
    })
    setToolActivities([])
    setSending(false)
    setStreaming('')
    try { await interruptSession(turnSession.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop this Hermes turn.') }
  }, [])

  const submitVoice = useCallback((text: string) => submit([], text), [submit])

  const handleSessionModelChange = useCallback((model: string) => {
    setSelected(current => current ? { ...current, model } : current)
  }, [])

  const handleClearChat = useCallback(async (session: LiveSession): Promise<void> => {
    console.log('[Hermes Debug] handleClearChat invoked for:', session.id, session.profile)

    const botProfile = profiles.find(p => p.name === session.profile)
    const isCanonical = Boolean(
      botProfile && (
        (botProfile.canonical_session && (
          session.id === resolveCanonicalSessionId(botProfile.canonical_session) ||
          session.id === botProfile.canonical_session.id
        )) ||
        session.id === `draft:${botProfile.name}` ||
        session.title === 'Bot Chat' ||
        session.title === (botProfile.display_name || titleize(botProfile.name)) ||
        !sessions.some(s => s.id === session.id && s.title !== 'Bot Chat')
      )
    )

    const extraIds: string[] = []
    if (botProfile?.canonical_session?.id) extraIds.push(botProfile.canonical_session.id)
    if (botProfile?.canonical_session?.resolved_id) extraIds.push(botProfile.canonical_session.resolved_id)
    const allSessionIds = new Set<string>([session.id, ...extraIds, `draft:${session.profile}`].filter(Boolean))

    for (const sid of allSessionIds) {
      activeInFlightTurnsRef.current.end(sid)
      recentEndedTurnsRef.current.set(sid, Date.now())
      delete pendingClarifyRef.current[sid]
      clearPersistedClarify(sid)
      messageCacheRef.current.delete(sid)
      removeCachedSessionMessages(sid)
    }
    if (session.profile) {
      activeInFlightTurnsRef.current.end(session.profile)
      recentEndedTurnsRef.current.set(session.profile, Date.now())
      delete pendingClarifyByProfileRef.current[session.profile]
      clearPersistedClarify(session.profile)
    }

    setActiveTurns(prev => {
      const next = { ...prev }
      delete next[session.profile]
      for (const sid of allSessionIds) {
        delete next[sid]
      }
      return next
    })
    setMessages([])
    setSending(false)
    setStreaming('')
    setToolActivities([])
    setSettledAssistant(null)
    setPendingClarify(null)
    setError('')

    try {
      const fresh = await clearSession(session.id, session.profile, {
        canonical: Boolean(isCanonical),
        title: isCanonical ? 'Bot Chat' : session.title,
        additionalDeleteIds: extraIds,
      })
      setSelected({
        ...fresh,
        title: isCanonical && botProfile ? (botProfile.display_name || titleize(botProfile.name)) : fresh.title,
      })
      messageCacheRef.current.set(fresh.id, [])
      setCachedSessionMessages(fresh.id, [])
      if (isCanonical) {
        setProfiles(prev => prev.map(p => p.name === session.profile ? {
          ...p,
          canonical_session: fresh,
        } : p))
      }
      setSessions(prev => [fresh, ...prev.filter(s => s.id !== session.id && !extraIds.includes(s.id))])
      setLastReadTime(fresh.id, Date.now())
      if (isCanonical && botProfile?.canonical_session?.id) {
        setLastReadTime(botProfile.canonical_session.id, Date.now())
      }
      void refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not clear chat history.')
    }
  }, [profiles, sessions, refresh])

  const openBot = useCallback(async (profile: RosterProfile, existingSession: LiveSession | null) => {
    remoteLog('DEBUG', 'Action', `openBot tapped: profile=${profile.name}, hasExistingSession=${Boolean(existingSession)}`)
    if (existingSession) {
      void openSession(existingSession)
      return
    }

    // Check if canonical session exists in profilesRef or sessionsRef before minting new
    const canonicalSession = profile.canonical_session
      || profilesRef.current.find(p => p.name === profile.name)?.canonical_session
    if (canonicalSession) {
      const canonicalId = resolveCanonicalSessionId(canonicalSession)
      void openSession({
        id: canonicalId,
        title: profile.display_name || titleize(profile.name),
        preview: canonicalSession.preview || '',
        profile: profile.name,
        model: profile.model,
        last_active: canonicalSession.last_active,
      })
      return
    }

    const fallbackSession = sessionsRef.current.find(s =>
      s.profile === profile.name &&
      (s.title === 'Bot Chat' || s.title === profile.display_name || s.title === profile.name || isSessionCanonical(s, profilesRef.current, adhocSessionIdsRef.current))
    )
    if (fallbackSession) {
      void openSession(fallbackSession)
      return
    }

    // Optimistically open an instant draft session so the UI transitions in 0ms
    const draftSession: LiveSession = {
      id: `draft:${profile.name}`,
      profile: profile.name,
      title: profile.display_name || titleize(profile.name),
      preview: '',
      last_active: Date.now(),
    }
    void openSession(draftSession)
    try {
      const fresh = await createSession(profile.name, 'Bot Chat', { canonical: true, hidden: true })
      setProfiles(prev => prev.map(p => p.name === profile.name ? {
        ...p,
        canonical_session: fresh,
      } : p))
      setSelected(current => current?.id === draftSession.id ? {
        ...fresh,
        title: profile.display_name || titleize(profile.name),
      } : current)
      void refresh()
    } catch {
      // Background resolution will fallback to on-the-fly resolution on first submit
    }
  }, [openSession, refresh])

  const finishCreate = async () => {
    setCreating(true)
    setError('')
    try {
      await createProfile(botDraft)
      setCreateOpen(false)
      setCreateStep(0)
      const data = await refresh()
      const createdProfile = data?.profiles.find(profile => profile.name === botDraft.name)
      const canonical = createdProfile?.canonical_session
      if (createdProfile && canonical) {
        await openSession({
          id: resolveCanonicalSessionId(canonical),
          title: createdProfile.display_name || titleize(createdProfile.name),
          preview: canonical.preview || '',
          profile: createdProfile.name,
          model: createdProfile.model,
          last_active: canonical.last_active,
          unread: false,
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this Bot.')
    } finally { setCreating(false) }
  }

  const swipeStartXRef = useRef<number | null>(null)
  const swipeStartYRef = useRef<number | null>(null)
  const swipeTrackingRef = useRef(false)
  const swipeIntentConfirmedRef = useRef(false)
  const swipeStartedOnInteractiveRef = useRef(false)

  const handleRosterTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [type="range"], .task-detail, .task-create-sheet, .task-modal-backdrop, .roster-nav, .roster-pinned, .nav-island')) return

    swipeStartedOnInteractiveRef.current = Boolean(target?.closest('.bot-row, button, a'))
    swipeStartXRef.current = event.touches[0].clientX
    swipeStartYRef.current = event.touches[0].clientY
    swipeTrackingRef.current = true
    swipeIntentConfirmedRef.current = false
    remoteLog('DEBUG', 'Gesture', `TouchStart on roster at x=${Math.round(event.touches[0].clientX)} y=${Math.round(event.touches[0].clientY)} target=${target?.tagName}.${target?.className} isInteractive=${swipeStartedOnInteractiveRef.current}`)
  }

  const handleRosterTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (!swipeTrackingRef.current || swipeStartXRef.current == null || swipeStartYRef.current == null) return
    const currentX = event.touches[0].clientX
    const currentY = event.touches[0].clientY
    const deltaX = currentX - swipeStartXRef.current
    const deltaY = currentY - swipeStartYRef.current

    if (swipeStartedOnInteractiveRef.current) {
      const intent = classifyInteractiveRowGesture(deltaX, deltaY)
      if (intent === 'vertical_scroll') {
        swipeTrackingRef.current = false
        return
      }
      if (intent === 'horizontal_swipe') {
        swipeIntentConfirmedRef.current = true
        remoteLog('DEBUG', 'Gesture', `Interactive row horizontal swipe confirmed: deltaX=${Math.round(deltaX)} deltaY=${Math.round(deltaY)}`)
      } else {
        return
      }
    } else if (!swipeIntentConfirmedRef.current) {
      if (isHorizontalSwipeIntent(deltaX, deltaY, 20)) {
        swipeIntentConfirmedRef.current = true
        remoteLog('DEBUG', 'Gesture', `Swipe intent confirmed: deltaX=${Math.round(deltaX)} deltaY=${Math.round(deltaY)}`)
      } else if (Math.hypot(deltaX, deltaY) >= 20) {
        // Vertical or diagonal movement: immediately yield to vertical scrolling
        swipeTrackingRef.current = false
        return
      }
    }

    // Once horizontal swipe intent is confirmed, prevent Android WebView native scroll/fling interception
    if (swipeIntentConfirmedRef.current && event.cancelable) {
      event.preventDefault()
    }
  }

  const handleRosterTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (!swipeTrackingRef.current || swipeStartXRef.current == null || swipeStartYRef.current == null) {
      swipeTrackingRef.current = false
      swipeIntentConfirmedRef.current = false
      return
    }
    const endX = event.changedTouches[0]?.clientX ?? swipeStartXRef.current
    const endY = event.changedTouches[0]?.clientY ?? swipeStartYRef.current
    const deltaX = endX - swipeStartXRef.current
    const deltaY = endY - swipeStartYRef.current
    const wasConfirmed = swipeIntentConfirmedRef.current
    const wasInteractive = swipeStartedOnInteractiveRef.current

    swipeTrackingRef.current = false
    swipeIntentConfirmedRef.current = false
    swipeStartedOnInteractiveRef.current = false
    swipeStartXRef.current = null
    swipeStartYRef.current = null

    const minDelta = wasInteractive ? 64 : 56
    // Require confirmed horizontal intent with at least minDelta
    if (wasConfirmed) {
      const nextTab = computeNextSwipeTab(tab, deltaX, deltaY, minDelta)
      remoteLog('DEBUG', 'Gesture', `TouchEnd evaluated: deltaX=${Math.round(deltaX)} confirmed=${wasConfirmed} nextTab=${nextTab || 'none'}`)
      if (nextTab) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        if (switchTabRafRef.current != null) {
          try { cancelAnimationFrame(switchTabRafRef.current) } catch {}
        }
        switchTabRafRef.current = requestAnimationFrame(() => {
          switchTabRafRef.current = null
          switchTab(nextTab)
        })
      }
    } else {
      remoteLog('DEBUG', 'Gesture', `TouchEnd tap preserved: deltaX=${Math.round(deltaX)} deltaY=${Math.round(deltaY)} wasInteractive=${wasInteractive}`)
    }
  }

  const handleRosterTouchCancel = () => {
    swipeTrackingRef.current = false
    swipeIntentConfirmedRef.current = false
    swipeStartedOnInteractiveRef.current = false
    swipeStartXRef.current = null
    swipeStartYRef.current = null
  }

  if (needsOnboarding) {
    return (
      <OnboardingLanding
        theme={theme}
        setTheme={setTheme}
        onPaired={async (endpoint: string) => {
          const normalized = activateEndpoint(endpoint)
          try {
            localStorage.setItem('hermes-mobile-active-endpoint', normalized)
            localStorage.setItem('hermes-mobile-onboarding-completed', 'true')
          } catch {}
          setNeedsOnboarding(false)
          const data = await refresh(normalized, true)
          if (!data) {
            throw new Error(
              lastConnectionErrorRef.current ||
                'Signed in, but authenticated Hermes verification failed.'
            )
          }
        }}
      />
    )
  }

  if (createOpen) return <CreateWizard step={createStep} setStep={setCreateStep} draft={botDraft} setDraft={setBotDraft} creating={creating} error={error} close={() => { setCreateOpen(false); setCreateStep(0); setError('') }} finish={() => void finishCreate()}/>
  if (settings) return <ConnectionSettings profiles={profiles.length} sessions={sessions.length} connected={connectionStatus === 'connected'} endpoint={activeEndpoint !== 'http://127.0.0.1:9119' ? activeEndpoint : undefined} theme={theme} setTheme={setTheme} uiScale={uiScale} setUiScale={setUiScale} close={() => setSettings(false)} refresh={() => refresh()} onPairingBusy={setPairingBusyState} onPaired={async endpoint => { const normalized = activateEndpoint(endpoint); const data = await refresh(normalized, true); if (!data) throw new Error(lastConnectionErrorRef.current || 'Signed in, but authenticated Hermes REST or live WebSocket verification failed.'); localStorage.setItem('hermes-mobile-active-endpoint', normalized) }}/>
  if (selected && profileSheet) return <BotProfileSheet profile={profiles.find(profile => profile.name === selected.profile)} session={selected} onClose={() => setProfileSheet(false)} onUpdated={() => void refresh()}/>

  return (
    <>
      <main
        className={`app roster-shell tab-slide-${slideDirection}`}
        style={selected ? { display: 'none' } : undefined}
        onTouchStart={selected ? undefined : handleRosterTouchStart}
        onTouchMove={selected ? undefined : handleRosterTouchMove}
        onTouchEnd={selected ? undefined : handleRosterTouchEnd}
        onTouchCancel={selected ? undefined : handleRosterTouchCancel}
      >
    <div className="roster-pinned">
      <header className="roster-head">
        <div className="roster-status">
          <button
            type="button"
            className="host-node-btn"
            onClick={() => setSettings(true)}
            aria-label={`Hermes host settings (${connectionStatus === 'connected' ? 'connected' : connectionStatus === 'disconnected' ? 'offline' : 'checking'})`}
            title={
              connectionStatus === 'connected'
                ? `Connected to Hermes host${activeEndpoint ? ` (${activeEndpoint.replace(/^https?:\/\//, '')})` : ''}. Tap to open settings.`
                : connectionStatus === 'disconnected'
                ? 'Hermes host disconnected. Tap to open connection settings.'
                : 'Checking Hermes host connection…'
            }
          >
            <div className="host-avatar-wrap">
              <div className="host-avatar-inner">
                <img src={HermesHostIcon} alt="Hermes Host" className="host-avatar-img"/>
              </div>
              <span className={`host-status-pip ${connectionStatus === 'disconnected' ? 'offline' : connectionStatus === 'connected' ? 'online' : 'checking'}`} aria-hidden="true"/>
            </div>
          </button>
        </div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Search" onClick={() => setSearching(value => !value)}><Search size={18}/></button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><SettingsIcon size={18}/></button>
          {tab === 'sessions' ? (
            <div className="header-action-group">
              <button
                type="button"
                className={`header-action-btn primary action-group-trigger ${actionMenuOpen ? 'open' : ''}`}
                aria-haspopup={profiles.length > 1 ? 'menu' : undefined}
                aria-expanded={profiles.length > 1 ? actionMenuOpen : undefined}
                aria-label="New chat session"
                disabled={creatingSession}
                onClick={() => {
                  if (profiles.length > 1) {
                    setActionMenuOpen(open => !open)
                  } else {
                    void handleNewSession()
                  }
                }}
              >
                <Plus size={16}/>
                <span>{creatingSession ? 'Creating…' : 'New'}</span>
              </button>
              {actionMenuOpen && profiles.length > 1 && <>
                <button
                  type="button"
                  className="action-group-scrim"
                  aria-label="Close menu"
                  onClick={() => setActionMenuOpen(false)}
                />
                <div className="action-group-menu" role="menu">
                  <div className="action-group-header">New chat with</div>
                  {profiles.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      role="menuitem"
                      className="action-group-item"
                      onClick={() => {
                        setActionMenuOpen(false)
                        void handleNewSession(p.name)
                      }}
                    >
                      <BotAvatar profile={p} fallbackName={p.name} variant="session"/>
                      <span>{p.display_name || titleize(p.name)}</span>
                    </button>
                  ))}
                </div>
              </>}
            </div>
          ) : (
            <div className="header-action-group">
              <button
                type="button"
                className={`header-action-btn primary action-group-trigger ${actionMenuOpen ? 'open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={actionMenuOpen}
                aria-label={tab === 'tasks' ? 'New task or bot' : 'New bot or group'}
                onClick={() => setActionMenuOpen(open => !open)}
              >
                <Plus size={16}/>
                <span>New</span>
              </button>
              {actionMenuOpen && <>
                <button
                  type="button"
                  className="action-group-scrim"
                  aria-label="Close menu"
                  onClick={() => setActionMenuOpen(false)}
                />
                <div className="action-group-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="action-group-item"
                    onClick={() => { setActionMenuOpen(false); if (tab === 'tasks') setCreateTaskOpen(true); else setCreateOpen(true); }}
                  >
                    {tab === 'tasks' ? <CalendarClock size={15}/> : <Bot size={15}/>}
                    <span>{tab === 'tasks' ? 'New task' : 'New Bot'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="action-group-item"
                    onClick={() => { setActionMenuOpen(false); if (tab === 'tasks') setCreateOpen(true); else setCreateTaskOpen(true); }}
                  >
                    {tab === 'tasks' ? <Bot size={15}/> : <CalendarClock size={15}/>}
                    <span>{tab === 'tasks' ? 'New Bot' : 'New task'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="action-group-item"
                    disabled
                    title="Group-room transport is not yet enabled"
                    onClick={() => setActionMenuOpen(false)}
                  >
                    <Users size={15}/>
                    <span>New group</span>
                  </button>
                </div>
              </>}
            </div>
          )}
        </div>
      </header>
      {searching && <div className="search"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'bots' ? 'Search bots and group chats…' : tab === 'sessions' ? 'Search sessions…' : 'Search tasks…'}/><button onClick={() => { setQuery(''); setSearching(false) }}><X size={16}/></button></div>}
    </div>
    <div
      className="roster-list-scroll"
      key="roster-scroll"
      ref={rosterScrollRef}
      style={{ display: tab === 'tasks' ? 'none' : undefined }}
    >
        {error && <Notice message={error} retry={() => void refresh()}/>}
        {((loading && !profiles.length) || (tab === 'sessions' && loading && !sessions.length)) ? <Skeleton/> : (
          <>
            <section className="bot-list" style={{ display: tab === 'bots' ? undefined : 'none' }}>
              {rows.map(({ profile, session }, index) => {
                const activeTurn = isBotRowWorking(profile.name, session || profile.canonical_session, activeTurns, adhocSessionIds)
                const isWorking = Boolean(activeTurn)
                const isWaitingInput = Boolean(activeTurn && (activeTurn.status === 'waiting' || activeTurn.needsInput))
                return (
                    <button
                      className={`bot-row enter ${isWorking ? 'working' : ''} ${isWaitingInput ? 'waiting' : ''}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                      key={profile.name}
                      onPointerDown={handleRowPointerDown}
                      onClick={() => {
                        remoteLog('DEBUG', 'Action', `Bot row click fired on ${profile.name}`)
                        const intentId = ++navigationIntentRef.current
                        const openTargetId = session?.id || `draft:${profile.name}`
                        openingSessionIdRef.current = openTargetId
                        setOpeningSessionId(openTargetId)
                        requestAnimationFrame(() => {
                          if (navigationIntentRef.current !== intentId) return
                          requestAnimationFrame(() => {
                            if (navigationIntentRef.current !== intentId) return
                            void openBot(profile, session)
                          })
                        })
                      }}
                    >
                    <div className="bot-avatar-wrap">
                      <BotAvatar profile={profile} fallbackName={profile.name}/>
                      {isWorking && (
                        <span className={`bot-status-pip ${isWaitingInput ? 'waiting' : ''}`} aria-hidden="true"/>
                      )}
                      {session?.unread && !isWorking && <span className="bot-unread-pip" aria-hidden="true"/>}
                    </div>
                    <span className="bot-copy">
                      <b>{profile.display_name || titleize(profile.name)}</b>
                      {activeTurn ? (
                        isWaitingInput ? (
                          <small className="bot-clarify-question">
                            {activeTurn.pendingClarify?.questions?.[0]?.question || 'Clarification needed'}
                          </small>
                        ) : (
                          <small className="bot-in-progress">
                            <span className="live-wave" aria-hidden="true"><i/><i/><i/></span>
                            <span className="live-status-text">{activeTurn.statusText}</span>
                          </small>
                        )
                      ) : (
                        <small>{cleanPreviewSnippet(session?.preview) || profile.description || 'No messages yet'} </small>
                      )}
                    </span>
                    <span className="meta">
                      {ago(session?.last_active)}
                      {session?.unread && (
                        <span className="unread-badge">
                          {session.unread_count && session.unread_count > 99 ? '99+' : session.unread_count || 1}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </section>

            <section className="bot-list" style={{ display: tab === 'sessions' ? undefined : 'none' }}>
              {!visibleSessions.length ? (
                <div className="sessions-empty">
                  <MessageSquare size={24}/>
                  <b>No conversations yet</b>
                  <p>Start a new chat with any of your Bots.</p>
                  <button className="task-outline-pill" onClick={() => void handleNewSession()}>
                    <Plus size={14}/> Start a chat
                  </button>
                </div>
              ) : (
                visibleSessions.slice(0, 45).map((session, index) => {
                  const activeTurn = isSessionRowWorking(session.id, session.profile, activeTurns)
                  const isWorking = Boolean(activeTurn)
                  const isWaitingInput = Boolean(activeTurn && (activeTurn.status === 'waiting' || activeTurn.needsInput))
                  const isOpening = openingSessionId === session.id
                  const profile = profileMap.get(session.profile)
                  return (
                    <button
                      className={`bot-row enter ${isWorking ? 'working' : ''} ${isOpening ? 'opening' : ''} ${isWaitingInput ? 'waiting' : ''}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                      key={`${session.profile}:${session.id}`}
                      onPointerDown={handleRowPointerDown}
                      onClick={() => {
                        remoteLog('DEBUG', 'Action', `Session row click fired on ${session.id}`)
                        const intentId = ++navigationIntentRef.current
                        openingSessionIdRef.current = session.id
                        setOpeningSessionId(session.id)
                        requestAnimationFrame(() => {
                          if (navigationIntentRef.current !== intentId) return
                          requestAnimationFrame(() => {
                            if (navigationIntentRef.current !== intentId) return
                            void openSession(session)
                          })
                        })
                      }}
                    >
                      <div className="bot-avatar-wrap">
                        <BotAvatar profile={profile} fallbackName={session.profile} variant="session"/>
                        {isWorking && (
                          <span className={`bot-status-pip ${isWaitingInput ? 'waiting' : ''}`} aria-hidden="true"/>
                        )}
                        {session.unread && !isWorking && <span className="bot-unread-pip" aria-hidden="true"/>}
                      </div>
                      <span className="bot-copy">
                        <b>{session.title || 'Untitled session'}</b>
                        {activeTurn ? (
                          isWaitingInput ? (
                            <small className="bot-clarify-question">
                              {activeTurn.pendingClarify?.questions?.[0]?.question || 'Clarification needed'}
                            </small>
                          ) : (
                            <small className="bot-in-progress">
                              <span className="live-wave" aria-hidden="true"><i/><i/><i/></span>
                              <span className="live-status-text">{activeTurn.statusText}</span>
                            </small>
                          )
                        ) : (
                          <small>{titleize(session.profile || 'default')} · {cleanPreviewSnippet(session.preview)}</small>
                        )}
                      </span>
                      <span className="meta">
                        {isOpening ? (
                          <span className="row-opening-cue"><RefreshCw size={12} className="pull-refresh-spinner" /></span>
                        ) : (
                          ago(session.last_active)
                        )}
                        {session.unread && !isOpening && (
                          <span className="unread-badge">
                            {session.unread_count && session.unread_count > 99 ? '99+' : session.unread_count || 1}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
              )}
            </section>
          </>
        )}
      </div>
      <TasksView
        profiles={profiles}
        query={searching ? query : ''}
        baseUrl={activeEndpoint}
        createOpen={createTaskOpen}
        setCreateOpen={setCreateTaskOpen}
        active={!selected && tab === 'tasks'}
      />
    <NavIsland tab={tab} setTab={switchTab}/>
  </main>
  {selected && (
    <ErrorBoundary
      onError={cancelPendingCachedHydration}
      onReset={() => { cancelPendingCachedHydration(); setSelected(null) }}
    >
      <ChatView
        session={selected}
        perfTraceId={sessionOpenTraceMapRef.current.get(selected.id)}
        conversationLoading={conversationLoading}
        messages={messages}
        settledAssistant={settledAssistant?.sessionId === selected.id && settledAssistant.profile === selected.profile ? settledAssistant : null}
        profiles={profiles}
        streaming={streaming}
        sending={sending}
        toolActivities={toolActivities}
        error={error}
        back={() => {
          sessionLoadRef.current++
          navigationIntentRef.current++
          openingSessionIdRef.current = null
          setOpeningSessionId(null)
          setConversationLoading(false)
          cancelPendingCachedHydration()
          remoteLog('DEBUG', 'Navigation', `Chat chevron back tapped from ${selected.id}`)
          setSelected(null)
        }}
        refresh={() => void openSession(selected)}
        clearChat={() => handleClearChat(selected)}
        openProfile={() => setProfileSheet(true)}
        onSessionModelChange={handleSessionModelChange}
        pendingClarify={pendingClarify}
        onAnswerClarify={handleAnswerClarify}
        onSkipClarify={handleSkipClarify}
        submit={submit}
        submitVoice={submitVoice}
        stop={stop}
        loadEarlierMessages={loadEarlierMessages}
      />
    </ErrorBoundary>
  )}
  </>
  )
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Bot }> = [
  { id: 'bots', label: 'Bots', icon: Bot },
  { id: 'sessions', label: 'Sessions', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
]

export function NavIsland({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null)
  const [hasAnimated, setHasAnimated] = useState(false)
  const itemRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    bots: null,
    sessions: null,
    tasks: null,
  })

  useLayoutEffect(() => {
    const el = itemRefs.current[tab]
    if (!el) return
    const update = () => {
      setIndicatorStyle({
        left: el.offsetLeft,
        width: el.offsetWidth,
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (!hasAnimated) {
      requestAnimationFrame(() => setHasAnimated(true))
    }
    return () => ro.disconnect()
  }, [tab, hasAnimated])

  useEffect(() => {
    const handleResize = () => {
      const el = itemRefs.current[tab]
      if (el) {
        setIndicatorStyle({
          left: el.offsetLeft,
          width: el.offsetWidth,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [tab])

  return (
    <>
      <div className="nav-bottom-scrim" aria-hidden="true" />
      <nav className="nav-island" aria-label="Page navigation">
        {indicatorStyle && (
          <span
            className={`nav-island-indicator ${hasAnimated ? 'animate' : ''}`}
            style={{
              transform: `translateX(${indicatorStyle.left}px)`,
              width: `${indicatorStyle.width}px`,
            }}
            aria-hidden="true"
          />
        )}
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            ref={el => { itemRefs.current[id] = el }}
            className={`nav-island-item ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} strokeWidth={1.75} />
            <span className="nav-island-label">{label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

function Notice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="notice"><b>Connection needs attention</b><span>{message}</span><button onClick={retry}>Try again</button></div>
}
function Skeleton() { return <div className="skeletons">{[1, 2, 3, 4, 5, 6].map(item => <i key={item}/>)}</div> }

function LegacyConnectionSettings({ profiles, sessions, theme, setTheme, close, refresh }: { profiles: number; sessions: number; theme: Theme; setTheme: (theme: Theme) => void; close: () => void; refresh: () => void }) {
  const [showThemes, setShowThemes] = useState(false)
  const themes: Array<{ id: Theme; label: string; description: string }> = [
    { id: 'light', label: 'White', description: 'Clean white canvas & daylight contrast' },
    { id: 'grey', label: 'Grey', description: 'Refined charcoal & graphite monochrome' },
    { id: 'dark', label: 'Black / OLED Dark', description: 'Deep obsidian & OLED true black' },
  ]
  return <main className="app panel"><header className="panel-head"><button className="back-button" onClick={close}>‹</button><div><h2>Connection</h2><p>Hermes Desktop host</p></div></header><section className="connection-card"><span className="status-pill">● Connected</span><h3>This Windows PC</h3><code>127.0.0.1:9119</code><div className="stats"><span><b>{profiles}</b>Bots</span><span><b>{sessions}</b>Sessions</span></div><button className="primary wide" onClick={refresh}>Sync now</button></section><section className="menu-list"><button>Notifications <span>›</span></button><button onClick={() => setShowThemes(value => !value)}>Appearance <span>{themes.find(item => item.id === theme)?.label} ›</span></button>{showThemes && <div className="theme-picker">{themes.map(item => <button className={item.id === theme ? 'selected' : ''} onClick={() => setTheme(item.id)} key={item.id}><span className={`theme-swatch theme-${item.id}`}/><span><b>{item.label}</b><small>{item.description}</small></span><i>{item.id === theme ? '✓' : ''}</i></button>)}</div>}<button>Security & pairing <span>›</span></button><button>About Hermes Mobile <span>0.1.0 ›</span></button></section><p className="fine">The host owns models, credentials, tools, memory, skills, and approvals. This client is the control surface.</p></main>
}

function CreateWizard({ step, setStep, draft, setDraft, creating, error, close, finish }: { step: number; setStep: (step: number) => void; draft: DraftBot; setDraft: React.Dispatch<React.SetStateAction<DraftBot>>; creating: boolean; error: string; close: () => void; finish: () => void }) {
  const titles = ['Who is this bot?', 'Personality', 'Model', 'Look']
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      event.preventDefault()
      if (step > 0) setStep(step - 1)
      else close()
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [close, setStep, step])
  const pickRole = (role: string) => { const [name, description] = roles[role]; setDraft(current => ({ ...current, role, name, description })) }
  return <main className="app wizard"><header><button className="icon-button" onClick={close}><X size={18}/></button><div className="progress">{[0, 1, 2, 3].map(item => <i className={item === step ? 'current' : ''} key={item}/>)}</div></header><section key={step}><h1>{titles[step]}</h1>{step === 0 && <><p>Name it and give it a job.</p><div className="chips">{Object.keys(roles).map(role => <button className={draft.role === role ? 'selected' : ''} onClick={() => pickRole(role)} key={role}>{role}</button>)}</div><Field label="NAME"><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}/><small>Lowercase profile handle, for example research-rabbit.</small></Field><Field label="WHAT SHOULD IT DO?"><input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></Field></>}{step === 1 && <><p>Optional — shape how it thinks and talks.</p><div className="explain">This becomes the Bot’s real SOUL.md and loads into every conversation.</div><Field label="SOUL"><textarea value={draft.soul} onChange={event => setDraft(current => ({ ...current, soul: event.target.value }))}/></Field></>}{step === 2 && <><p>Optional — pin a model, or use the Hermes default.</p><button className={!draft.model ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: '', provider: '' }))}><b>Use Hermes default</b><small>Inherits this PC’s provider and model.</small></button><button className={draft.model === 'gpt-5.6-sol' ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: 'gpt-5.6-sol', provider: 'openai-api' }))}>openai-api/gpt-5.6-sol</button></>}{step === 3 && <><p>Choose an avatar that remains identical in Hermes Desktop and Mobile.</p><BotAppearancePicker name={draft.name} shape={draft.shape} onShape={shape => setDraft(current => ({ ...current, shape }))}/></>}{error && <p className="wizard-error">{error}</p>}</section><footer><button className="secondary" onClick={() => step ? setStep(step - 1) : close()}>{step ? 'Back' : 'Cancel'}</button><button className="primary" disabled={creating || (step === 0 && !draft.name)} onClick={() => step < 3 ? setStep(step + 1) : finish()}>{creating ? 'Creating…' : step < 3 ? 'Continue' : 'Create Bot'}</button></footer></main>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
