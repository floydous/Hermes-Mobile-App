import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Eraser, History, LoaderCircle, Paperclip, RotateCw, X } from 'lucide-react'
import type { DragEvent } from 'react'

import { BotAvatar } from './BotAvatar'
import { MessageCard, MarkdownContent } from './MarkdownContent'
import { SmoothStreamingView } from './SmoothStreamingView'
import { ClarifyCard, type ClarifyRequest } from './ClarifyCard'
import type { ToolActivity } from '../chat-turn'
import { applySlashCompletion } from '../slash-routing'
import { SCROLL_FOLLOW_THRESHOLD, shouldStickToBottom } from '../scroll-follow'
import { formatResponseStats } from '../message-stats'
import { getInitialSpinnerPhrase, getProgressiveSpinnerPhrase, getRandomToolThreshold } from '../spinner-phrases'
import { useEdgeSwipeBack } from '../edge-swipe'
import { Composer, type ComposerDropFilesRef, type ComposerEditRequest } from './Composer'
import type { LiveMessage, LiveProfile, LiveSession, LiveUsage } from '../hermes'

type Timeline = LiveMessage & { local?: boolean }
type Props = {
  session: LiveSession
  conversationLoading: boolean
  messages: Timeline[]
  settledAssistant: { content: string; usage?: LiveUsage } | null
  profiles: LiveProfile[]
  streaming: string
  sending: boolean
  toolActivities: ToolActivity[]
  error: string
  back: () => void
  refresh: () => void
  clearChat?: () => Promise<void>
  openProfile: () => void
  onSessionModelChange: (model: string) => void
  pendingClarify?: ClarifyRequest | null
  onAnswerClarify?: (requestId: string, answers: Record<string, string | null>) => void
  onSkipClarify?: (requestId: string) => void
  submit: (attachments: { name: string; refText: string }[], text: string, options?: { editMessageId?: number }) => Promise<boolean>
  submitVoice: (text: string) => Promise<boolean>
  stop: () => void
  loadEarlierMessages?: () => Promise<boolean>
}

const titleize = (value?: string | null) => (value || '').split(/[-_]+/).filter(Boolean).map(part => (part[0] ? part[0].toUpperCase() + part.slice(1) : '')).join(' ') || 'Bot'

export function ChatView({ session, conversationLoading, messages, settledAssistant, profiles, streaming, sending, toolActivities, error, back, refresh, clearChat, openProfile, onSessionModelChange, pendingClarify, onAnswerClarify, onSkipClarify, submit, submitVoice, stop, loadEarlierMessages }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const followingRef = useRef(true)
  const stickQueuedRef = useRef(false)
  const prependingEarlierRef = useRef(false)
  const scrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const [following, setFollowing] = useState(true)
  const [unreadBelow, setUnreadBelow] = useState(0)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true)
  const [revealedTimestampId, setRevealedTimestampId] = useState<number | null>(null)
  const [controlError, setControlError] = useState('')
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [confirmClearExiting, setConfirmClearExiting] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEdgeSwipeBack(shellRef, back, !confirmClearOpen)

  const closeConfirmClear = () => {
    if (clearing || confirmClearExiting) return
    setConfirmClearExiting(true)
    window.setTimeout(() => {
      setConfirmClearOpen(false)
      setConfirmClearExiting(false)
    }, 180)
  }

  const handleConfirmClear = async () => {
    if (!clearChat || clearing) return
    setClearing(true)
    try {
      await clearChat()
      setConfirmClearExiting(true)
      window.setTimeout(() => {
        setConfirmClearOpen(false)
        setConfirmClearExiting(false)
      }, 180)
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Could not clear chat')
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    const onMobileBack = (event: Event) => {
      if (confirmClearOpen) {
        event.preventDefault()
        closeConfirmClear()
      }
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [confirmClearOpen, clearing, confirmClearExiting])
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const pullStartRef = useRef<number | null>(null)
  const [editRequest, setEditRequest] = useState<ComposerEditRequest | null>(null)
  const [modelLabel, setModelLabel] = useState(session.model || '')
  const dropFilesRef: ComposerDropFilesRef = useRef<((files: File[]) => void) | null>(null)
  const botProfile = profiles.find(profile => profile.name === (session.profile || 'default'))
  const botName = botProfile?.display_name || (session.title && session.title !== 'Bot Chat' ? session.title : titleize(session.profile || 'default'))

  const visibleError = error || controlError
  const activeAssistantText = settledAssistant?.content || streaming
  const settledStats = settledAssistant ? formatResponseStats({ id: -1, role: 'assistant', content: settledAssistant.content, usage: settledAssistant.usage }) : null
  const lastMessage = messages[messages.length - 1]
  const lastMessageIsAssistant = lastMessage?.role === 'assistant'
  const isLastMessageSettledAssistant = Boolean(
    lastMessageIsAssistant &&
    ((activeAssistantText && lastMessage.content === activeAssistantText) || (!streaming && !sending))
  )
  const hasRunningTools = Boolean(sending && toolActivities && toolActivities.length > 0)
  const showActiveAssistant = Boolean(
    (!pendingClarify && sending && (!lastMessageIsAssistant || hasRunningTools || !activeAssistantText || (activeAssistantText && lastMessage.content !== activeAssistantText))) ||
    (!pendingClarify && streaming && (!lastMessageIsAssistant || lastMessage.content !== streaming)) ||
    (!pendingClarify && settledAssistant && !isLastMessageSettledAssistant)
  )
  const showConversationLoading = conversationLoading && !messages.length
  const showEmptyState = !conversationLoading && !messages.length && !showActiveAssistant && !streaming && !visibleError

  const runningTool = sending ? (toolActivities || []).slice().reverse().find(t => t && t.status === 'running') : undefined
  const activeToolsCount = sending ? (toolActivities || []).length : 0

  const [typingBubbleWidth, setTypingBubbleWidth] = useState<number | null>(null)
  const typingMeasureRef = useRef<HTMLDivElement | null>(null)
  const [spinnerPhrase, setSpinnerPhrase] = useState(() => getInitialSpinnerPhrase())
  const lastToolCountRef = useRef(0)
  const nextThresholdRef = useRef(getRandomToolThreshold(1, 2))

  useEffect(() => {
    if (!sending) {
      setSpinnerPhrase(getInitialSpinnerPhrase())
      lastToolCountRef.current = 0
      nextThresholdRef.current = getRandomToolThreshold(1, 2)
      return
    }

    const currentToolCount = toolActivities ? toolActivities.length : 0
    if (currentToolCount > lastToolCountRef.current) {
      lastToolCountRef.current = currentToolCount
      if (currentToolCount >= nextThresholdRef.current) {
        setSpinnerPhrase(prev => getProgressiveSpinnerPhrase(prev))
        nextThresholdRef.current = currentToolCount + getRandomToolThreshold(1, 2)
      }
    }
  }, [sending, toolActivities?.length])

  let liveStatus = spinnerPhrase
  if (pendingClarify) {
    liveStatus = 'Needs your input…'
  } else if (runningTool) {
    if (runningTool.name === 'Dispatched Task') {
      liveStatus = runningTool.summary ? `${runningTool.summary}…` : 'Working on dispatched task…'
    } else {
      liveStatus = activeToolsCount > 1
        ? `Using ${runningTool.name} · ${activeToolsCount} tool calls…`
        : `Using ${runningTool.name}…`
    }
  }

  useLayoutEffect(() => {
    if (!sending || streaming) {
      setTypingBubbleWidth(null)
      return
    }
    const el = typingMeasureRef.current
    if (!el) return
    const update = () => {
      setTypingBubbleWidth(Math.ceil(el.scrollWidth) + 34)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [liveStatus, sending, streaming])

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTo({ top: thread.scrollHeight, behavior })
    if (!followingRef.current) {
      followingRef.current = true
      setFollowing(prev => (prev ? prev : true))
    }
    setUnreadBelow(prev => (prev === 0 ? prev : 0))
  }

  const scheduleStickToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (stickQueuedRef.current) return
    stickQueuedRef.current = true
    requestAnimationFrame(() => {
      stickQueuedRef.current = false
      if (!followingRef.current) return
      scrollToLatest(behavior)
    })
  }

  useEffect(() => {
    setDraggingFiles(false)
  }, [session.id])

  useLayoutEffect(() => {
    initializedRef.current = false
    followingRef.current = true
    setFollowing(true)
    setUnreadBelow(0)
    setRevealedTimestampId(null)
    setHasMoreEarlier(true)
    setLoadingEarlier(false)
    scrollAnchorRef.current = null
    prependingEarlierRef.current = false
  }, [session.id])

  useLayoutEffect(() => {
    const thread = threadRef.current
    if (scrollAnchorRef.current && thread) {
      const heightDiff = thread.scrollHeight - scrollAnchorRef.current.scrollHeight
      thread.scrollTop = scrollAnchorRef.current.scrollTop + heightDiff
      scrollAnchorRef.current = null
      prependingEarlierRef.current = false
    }
  }, [messages])

  useLayoutEffect(() => {
    if (!messages.length || initializedRef.current) return
    initializedRef.current = true
    const frame = requestAnimationFrame(() => {
      scrollToLatest('auto')
      requestAnimationFrame(() => scrollToLatest('auto'))
    })
    return () => cancelAnimationFrame(frame)
  }, [messages.length])

  useEffect(() => {
    if (!initializedRef.current) return
    if (prependingEarlierRef.current) return
    if (followingRef.current) scheduleStickToBottom('auto')
    else setUnreadBelow(count => count + 1)
  }, [messages.length, streaming])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current && !prependingEarlierRef.current) scheduleStickToBottom('auto')
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const fetchEarlier = useCallback(async () => {
    if (loadingEarlier || !hasMoreEarlier || !loadEarlierMessages) return
    const thread = threadRef.current
    if (!thread) return
    setLoadingEarlier(true)
    prependingEarlierRef.current = true
    scrollAnchorRef.current = {
      scrollHeight: thread.scrollHeight,
      scrollTop: thread.scrollTop,
    }
    try {
      const more = await loadEarlierMessages()
      setHasMoreEarlier(more)
    } catch {
      setHasMoreEarlier(false)
    } finally {
      setLoadingEarlier(false)
    }
  }, [loadingEarlier, hasMoreEarlier, loadEarlierMessages])

  const onScroll = () => {
    const thread = threadRef.current
    if (!thread) return

    // Auto-fetch earlier messages when scrolled near top
    if (thread.scrollTop < 120 && !loadingEarlier && hasMoreEarlier && !pullRefreshing && messages.length >= 10 && loadEarlierMessages) {
      void fetchEarlier()
    }

    const nearEnd = shouldStickToBottom(thread.scrollHeight, thread.scrollTop, thread.clientHeight, SCROLL_FOLLOW_THRESHOLD)
    if (nearEnd === followingRef.current) return
    followingRef.current = nearEnd
    setFollowing(nearEnd)
    if (nearEnd) setUnreadBelow(prev => (prev === 0 ? prev : 0))
  }

  const pullRefresh = async () => {
    setPullRefreshing(true)
    try { await Promise.resolve(refresh()) } finally { window.setTimeout(() => setPullRefreshing(false), 180) }
  }
  const onThreadTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (threadRef.current?.scrollTop === 0) pullStartRef.current = event.touches[0].clientY
  }
  const onThreadTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (pullStartRef.current == null || threadRef.current?.scrollTop !== 0) return
    const distance = Math.min(64, Math.max(0, event.touches[0].clientY - pullStartRef.current))
    if (distance > 0) event.preventDefault()
    setPullDistance(distance)
  }
  const onThreadTouchEnd = () => {
    const shouldRefresh = pullDistance >= 48
    pullStartRef.current = null
    setPullDistance(0)
    if (shouldRefresh && !pullRefreshing) void pullRefresh()
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingFiles(true)
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    setDraggingFiles(false)
    dropFilesRef.current?.(Array.from(event.dataTransfer.files))
  }
  const editMessage = (text: string, id?: number) => { setEditRequest({ text, messageId: id, nonce: Date.now() }) }

  return <main ref={shellRef} className="app chat-shell" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDraggingFiles(false)}>
    {draggingFiles && <div className="file-drop-overlay" aria-live="polite"><div><Paperclip size={24}/><b>Drop files to upload to Hermes</b><span>Documents stay on the host for Hermes to read</span></div></div>}
    <header className="chat-header">
      <button className="round-control" onClick={back} aria-label="Back"><ArrowDown size={18} className="back-chevron"/></button>
      <div className="chat-title"><button className="chat-identity-button" onClick={openProfile} aria-label={`Open ${botName} settings`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="header"/><span><b>{botName}</b><small>{botName} · {sending ? 'Working' : modelLabel || 'Hermes default'}</small></span></button></div>
      <div className="chat-header-actions">
        {clearChat && (
          <button
            className="round-control clear-chat-btn"
            onClick={() => setConfirmClearOpen(true)}
            aria-label="Clear chat"
            title="Clear chat & reset agent memory"
            disabled={clearing}
          >
            <Eraser size={16}/>
          </button>
        )}
        <button
          className="round-control"
          onClick={refresh}
          aria-label="Refresh conversation"
          title="Refresh conversation"
          disabled={clearing}
        >
          <RotateCw size={16}/>
        </button>
      </div>
    </header>

    {visibleError && <div className="chat-error"><span>{visibleError}</span><button onClick={() => setControlError('')}><X size={14}/></button></div>}

    <div className="thread-scroll" ref={threadRef} onScroll={onScroll} onTouchStart={onThreadTouchStart} onTouchMove={onThreadTouchMove} onTouchEnd={onThreadTouchEnd}>
      <div className="thread-content" ref={contentRef}>
        {(pullDistance > 6 || pullRefreshing) && (
          <div
            className="pull-floating-overlay"
            style={{
              transform: `translate3d(-50%, ${pullRefreshing ? 20 : Math.min(28, pullDistance * 0.45)}px, 0)`,
              opacity: pullRefreshing ? 1 : Math.min(1, pullDistance / 24),
            }}
            aria-live="polite"
          >
            <div
              className={`pull-floating-indicator ${pullRefreshing ? 'refreshing' : ''} ${pullDistance >= 48 ? 'ready' : ''}`}
              style={!pullRefreshing ? {
                transform: `rotate(${Math.min(360, (pullDistance / 48) * 360)}deg)`,
              } : undefined}
            >
              <RotateCw size={15} className={pullRefreshing ? 'pull-refresh-spinner' : ''} />
            </div>
          </div>
        )}
        {showConversationLoading && (
          <section className="chat-empty-state conversation-loading" aria-live="polite" aria-label={`Loading ${botName} conversation`}>
            <BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/>
            <h1>{botName.toUpperCase()}</h1>
            <div className="conversation-loading-pill">
              <span className="live-wave" aria-hidden="true"><i/><i/><i/></span>
              <span>Loading conversation…</span>
            </div>
            <div className="chat-skeleton-stream" aria-hidden="true">
              <div className="chat-skeleton-bubble assistant" />
              <div className="chat-skeleton-bubble user" />
              <div className="chat-skeleton-bubble assistant short" />
            </div>
          </section>
        )}
        {showEmptyState && <section className="chat-empty-state" aria-label={`Start a conversation with ${botName}`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/><h1>{botName.toUpperCase()}</h1><p>Say something to get started.</p></section>}
        {messages.length >= 10 && loadEarlierMessages && (
          <div className="load-earlier-container" aria-live="polite">
            {loadingEarlier ? (
              <div className="load-earlier-capsule is-loading" role="status" aria-label="Loading earlier messages">
                <LoaderCircle size={13} className="spin" />
                <span>Loading earlier messages…</span>
              </div>
            ) : hasMoreEarlier ? (
              <button
                type="button"
                className="load-earlier-btn"
                onClick={fetchEarlier}
                disabled={loadingEarlier}
                aria-label="Load earlier messages"
              >
                <History size={13} />
                <span>Load earlier messages</span>
              </button>
            ) : (
              <div className="load-earlier-capsule is-start" role="status" aria-label="Beginning of conversation">
                <span>Beginning of conversation</span>
              </div>
            )}
          </div>
        )}
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1
          const previousMessage = index > 0 ? messages[index - 1] : undefined
          const hasAssistantReplyAfter = messages.slice(index + 1).some(m => m.role === 'assistant')
          const isCompleted = !sending && !isLast && hasAssistantReplyAfter
          return (
            <MessageCard
              key={message.id}
              message={message}
              previousMessage={previousMessage}
              onEdit={editMessage}
              profile={botProfile}
              profiles={profiles}
              fallbackName={session.profile}
              isCompleted={hasAssistantReplyAfter}
              isActiveTurn={isLast && sending}
              activeToolStatus={isLast && sending ? liveStatus : undefined}
              revealTimestamp={message.role === 'assistant' && revealedTimestampId === message.id}
              onRevealTimestamp={() => setRevealedTimestampId(current => current === message.id ? null : message.id)}
            />
          )
        })}
        {showActiveAssistant && (
          <article className="message-row assistant-row live-response">
            <div className="assistant-message-layout">
              <div
                className={`assistant-bubble ${sending && !streaming ? 'live-typing' : ''}`}
                style={typingBubbleWidth != null ? { width: `${typingBubbleWidth}px` } : undefined}
              >
                {sending && !streaming && (
                  <div className="typing-indicator" ref={typingMeasureRef} aria-live="polite">
                    <span className="typing-dots" aria-hidden="true">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </span>
                    <span className="typing-status" key={liveStatus}>{liveStatus}</span>
                  </div>
                )}
                {activeAssistantText && (
                  <>
                    {sending ? (
                      <SmoothStreamingView text={activeAssistantText} />
                    ) : (
                      <MarkdownContent>{activeAssistantText}</MarkdownContent>
                    )}
                    {sending && (
                      <div className="typing-inline" aria-hidden="true">
                        <span className="typing-dots">
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                        </span>
                        {runningTool && <span className="typing-status">{runningTool.name}…</span>}
                      </div>
                    )}
                  </>
                )}
                {settledStats && (
                  <div className="response-stats" aria-label="Response generation statistics">{settledStats}</div>
                )}
              </div>
            </div>
          </article>
        )}
      </div>
    </div>

    {!following && <button className="latest-button" onClick={() => scrollToLatest()}><ArrowDown size={15}/><span>Latest{unreadBelow ? ` · ${unreadBelow}` : ''}</span></button>}

    {pendingClarify ? (
      <ClarifyCard
        request={pendingClarify}
        onSubmit={answers => onAnswerClarify?.(pendingClarify.requestId, answers)}
        onSkip={() => onSkipClarify?.(pendingClarify.requestId)}
      />
    ) : (
      <Composer session={session} profiles={profiles} sending={sending} draggingFiles={draggingFiles} editRequest={editRequest} cancelEdit={() => setEditRequest(null)} dropFilesRef={dropFilesRef} onControlError={setControlError} onModelLabel={setModelLabel} onSessionModelChange={onSessionModelChange} submit={submit} submitVoice={submitVoice} stop={stop}/>
    )}

    {confirmClearOpen && (
      <div
        className={`task-modal-backdrop ${confirmClearExiting ? 'exiting' : ''}`}
        role="presentation"
        onMouseDown={event => { if (!clearing && event.target === event.currentTarget) closeConfirmClear() }}
      >
        <section
          className="task-delete-modal clear-chat-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="clear-chat-title"
          aria-describedby="clear-chat-message"
        >
          <Eraser size={22}/>
          <h2 id="clear-chat-title">Clear conversation?</h2>
          <p id="clear-chat-message">
            This will reset {botName}’s memory and erase all messages in this session. The bot profile remains intact.
          </p>
          <footer>
            <button disabled={clearing} onClick={closeConfirmClear}>Keep chat</button>
            <button className="delete" disabled={clearing} onClick={() => void handleConfirmClear()}>
              {clearing ? <LoaderCircle size={15} className="connection-sync-spinner"/> : <Eraser size={15}/>}
              {clearing ? 'Clearing…' : 'Clear chat'}
            </button>
          </footer>
        </section>
      </div>
    )}
  </main>
}

function LoadingSpinner() {
  return <span className="conversation-spinner" role="status" aria-label="Loading"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
}
