import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Eraser, LoaderCircle, Paperclip, RotateCw, X } from 'lucide-react'
import type { DragEvent } from 'react'

import { BotAvatar } from './BotAvatar'
import { MessageCard, MarkdownContent } from './MarkdownContent'
import type { ToolActivity } from '../chat-turn'
import { applySlashCompletion } from '../slash-routing'
import { SCROLL_FOLLOW_THRESHOLD, shouldStickToBottom } from '../scroll-follow'
import { formatResponseStats } from '../message-stats'
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
  submit: (attachments: { name: string; refText: string }[], text: string, options?: { editMessageId?: number }) => Promise<boolean>
  submitVoice: (text: string) => Promise<boolean>
  stop: () => void
}

const titleize = (value?: string | null) => (value || '').split(/[-_]+/).filter(Boolean).map(part => (part[0] ? part[0].toUpperCase() + part.slice(1) : '')).join(' ') || 'Bot'

export function ChatView({ session, conversationLoading, messages, settledAssistant, profiles, streaming, sending, toolActivities, error, back, refresh, clearChat, openProfile, onSessionModelChange, submit, submitVoice, stop }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const followingRef = useRef(true)
  const stickQueuedRef = useRef(false)
  const [following, setFollowing] = useState(true)
  const [unreadBelow, setUnreadBelow] = useState(0)
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
    (sending && (!lastMessageIsAssistant || hasRunningTools || !activeAssistantText || (activeAssistantText && lastMessage.content !== activeAssistantText))) ||
    (streaming && (!lastMessageIsAssistant || lastMessage.content !== streaming)) ||
    (settledAssistant && !isLastMessageSettledAssistant)
  )
  const showConversationLoading = conversationLoading && !messages.length
  const showEmptyState = !conversationLoading && !messages.length && !showActiveAssistant && !streaming && !visibleError

  const runningTool = sending ? (toolActivities || []).slice().reverse().find(t => t && t.status === 'running') : undefined
  const activeToolsCount = sending ? (toolActivities || []).length : 0

  const [typingBubbleWidth, setTypingBubbleWidth] = useState<number | null>(null)
  const typingMeasureRef = useRef<HTMLDivElement | null>(null)

  let liveStatus = 'Thinking…'
  if (runningTool) {
    if (runningTool.name === 'Dispatched Task') {
      liveStatus = runningTool.summary ? `${runningTool.summary}…` : 'Working on dispatched task…'
    } else {
      liveStatus = activeToolsCount > 1
        ? `Using ${runningTool.name} · ${activeToolsCount} tool calls…`
        : `Using ${runningTool.name}…`
    }
  } else if (activeToolsCount > 0 && !streaming) {
    liveStatus = `${activeToolsCount} tool call${activeToolsCount > 1 ? 's' : ''} completed…`
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
  }, [session.id])

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
    if (followingRef.current) scheduleStickToBottom('auto')
    else setUnreadBelow(count => count + 1)
  }, [messages.length, streaming])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scheduleStickToBottom('auto')
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const thread = threadRef.current
    if (!thread) return
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
        {(pullDistance > 8 || pullRefreshing) && <div className="chat-pull-cue" style={{ height: `${pullRefreshing ? 34 : pullDistance}px` }}><RotateCw size={14} className={pullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{pullRefreshing ? 'Refreshing…' : pullDistance >= 48 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
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
        {messages.map(message => <MessageCard key={message.id} message={message} onEdit={editMessage} profile={botProfile} profiles={profiles} fallbackName={session.profile} revealTimestamp={message.role === 'assistant' && revealedTimestampId === message.id} onRevealTimestamp={() => setRevealedTimestampId(current => current === message.id ? null : message.id)}/>)}
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
                    <MarkdownContent>{activeAssistantText}</MarkdownContent>
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

    <Composer session={session} profiles={profiles} sending={sending} draggingFiles={draggingFiles} editRequest={editRequest} cancelEdit={() => setEditRequest(null)} dropFilesRef={dropFilesRef} onControlError={setControlError} onModelLabel={setModelLabel} onSessionModelChange={onSessionModelChange} submit={submit} submitVoice={submitVoice} stop={stop}/>

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
