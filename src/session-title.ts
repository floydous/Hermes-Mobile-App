import type { LiveSession, LiveUsage } from './hermes'

/**
 * Pure helper to update session title in-flight.
 */
export function applySessionTitleUpdate(
  sessions: LiveSession[],
  turnSessionId: string,
  activeSessionId: string,
  newTitle: string
): LiveSession[] {
  const cleanTitle = newTitle.trim()
  if (!cleanTitle) return sessions
  return sessions.map(s => (s.id === turnSessionId || s.id === activeSessionId) ? { ...s, title: cleanTitle } : s)
}

/**
 * Remaps an optimistic or draft session ID to the server-assigned canonical ID,
 * preserving any streamed title update.
 */
export function remapSessionId(
  sessions: LiveSession[],
  oldSessionId: string,
  newSessionId: string,
  overrideTitle?: string | null
): LiveSession[] {
  if (!newSessionId || oldSessionId === newSessionId) {
    if (overrideTitle) {
      return sessions.map(s => s.id === oldSessionId ? { ...s, title: overrideTitle } : s)
    }
    return sessions
  }

  return sessions.map(s => {
    if (s.id === oldSessionId) {
      return {
        ...s,
        id: newSessionId,
        ...(overrideTitle ? { title: overrideTitle } : {}),
      }
    }
    return s
  })
}

export type TitleReconciliationState = {
  activeSessionId: string
  latestStreamedTitle: string | null
}

export function createTitleReconciliation(initialSessionId: string): TitleReconciliationState {
  return {
    activeSessionId: initialSessionId,
    latestStreamedTitle: null,
  }
}

export function handleTitleEvent(
  state: TitleReconciliationState,
  payload: { title?: unknown },
  turnSessionId: string,
  onSelectedTitleUpdate: (title: string) => void,
  setSessions: (updater: (items: LiveSession[]) => LiveSession[]) => void
): void {
  const newTitle = String(payload.title || '').trim()
  if (newTitle) {
    state.latestStreamedTitle = newTitle
    onSelectedTitleUpdate(newTitle)
    setSessions(items => applySessionTitleUpdate(items, turnSessionId, state.activeSessionId, newTitle))
  }
}

export function finalizeSessionRemap(
  state: TitleReconciliationState,
  resolvedSessionId: string,
  turnSessionId: string,
  onSelectedIdUpdate: (newId: string) => void,
  setSessions: (updater: (items: LiveSession[]) => LiveSession[]) => void
): string {
  const finalId = resolvedSessionId || turnSessionId
  state.activeSessionId = finalId
  if (finalId !== turnSessionId) {
    onSelectedIdUpdate(finalId)
    setSessions(items => remapSessionId(items, turnSessionId, finalId, state.latestStreamedTitle))
  }
  return finalId
}

export type TurnSubmissionPipelineArgs = {
  turnSessionId: string
  turnProfile: string
  prompt: string
  activeEndpoint: string
  options?: { editMessageId?: number }
  connectAndSubmitFn: (
    sessionId: string,
    profile: string,
    text: string,
    onEvent: (type: string, payload: Record<string, unknown>) => void,
    endpoint: string,
    opts?: { truncateMessageId?: number }
  ) => Promise<{ sessionId: string }>
  onDelta: (text: string) => void
  onComplete: (text: string, usage?: LiveUsage) => void
  onToolStart: (id: string, name: string, context?: string, parameters?: Record<string, unknown>) => void
  onToolComplete: (id: string, name: string, durationS?: number, summary?: string) => void
  onClarifyRequest?: (requestId: string, questions: Array<{ qid: string; question: string; choices?: string[] | null; multi_select?: boolean }>) => void
  onTitleUpdate: (title: string) => void
  onSessionsUpdate: (updater: (items: LiveSession[]) => LiveSession[]) => void
  onSelectedIdUpdate: (newId: string) => void
  onError: (msg: string) => void
}

/**
 * Production submission pipeline orchestrator.
 * Safely executes prompt submissions, processes streaming events,
 * and eliminates TDZ errors when in-flight events arrive prior to session settlement.
 */
export async function executeTurnSubmissionPipeline(
  args: TurnSubmissionPipelineArgs
): Promise<{ finalSessionId: string; finalText: string; completionUsage?: LiveUsage }> {
  let finalText = ''
  let completionUsage: LiveUsage | undefined
  const titleState = createTitleReconciliation(args.turnSessionId)

  const submissionResult = await args.connectAndSubmitFn(
    args.turnSessionId,
    args.turnProfile,
    args.prompt,
    (type, payload) => {
      if (type === 'message.delta') {
        finalText += String(payload.text || '')
        args.onDelta(finalText)
      }
      if (type === 'message.complete') {
        finalText = String(payload.text || finalText)
        completionUsage = payload.usage && typeof payload.usage === 'object' ? payload.usage as LiveUsage : undefined
        args.onComplete(finalText, completionUsage)
      }
      if (type === 'tool.start' || type === 'tool.started' || type === 'tool.generating') {
        const id = String(payload.tool_id || payload.name || payload.tool_name || `tool-${Date.now()}`)
        const toolName = String(payload.name || payload.tool_name || payload.tool || 'tool')
        const rawParams = payload.parameters || payload.args || {}
        const params = (rawParams && typeof rawParams === 'object' ? rawParams : {}) as Record<string, unknown>
        args.onToolStart(id, toolName, typeof payload.context === 'string' ? payload.context : undefined, params)
      }
      if (type === 'request.clarify') {
        const reqId = String(payload.requestId || payload.id || '')
        const questions = Array.isArray(payload.questions) ? payload.questions : []
        if (reqId && questions.length > 0) {
          args.onClarifyRequest?.(reqId, questions as any)
        }
      }
      if (type === 'tool.complete' || type === 'tool.completed') {
        const id = String(payload.tool_id || payload.name || payload.tool_name || `tool-${Date.now()}`)
        const toolName = String(payload.name || payload.tool_name || payload.tool || 'tool')
        args.onToolComplete(
          id,
          toolName,
          typeof payload.duration_s === 'number' ? payload.duration_s : undefined,
          typeof payload.summary === 'string' ? payload.summary : undefined
        )
      }
      if (type === 'session.title') {
        handleTitleEvent(
          titleState,
          payload,
          args.turnSessionId,
          args.onTitleUpdate,
          args.onSessionsUpdate
        )
      }
      if (type === 'error') {
        args.onError(String(payload.message || 'Hermes could not complete that request.'))
      }
    },
    args.activeEndpoint,
    args.options?.editMessageId != null ? { truncateMessageId: args.options.editMessageId } : undefined
  )

  const finalSessionId = finalizeSessionRemap(
    titleState,
    submissionResult.sessionId,
    args.turnSessionId,
    args.onSelectedIdUpdate,
    args.onSessionsUpdate
  )

  return { finalSessionId, finalText, completionUsage }
}
