export const ASSISTANT_WORKSPACE_EVENT = 'blog-assistant-workspace-updated'
export const ASSISTANT_STORAGE_PREFIX = 'blog-assistant-workspace'
export const DEFAULT_ASSISTANT_WIDTH = 1060

export function assistantStorageKey(currentPost) {
  return `${ASSISTANT_STORAGE_PREFIX}:${currentPost?.id || currentPost || 'global'}`
}

export function createAssistantMessage({ role, text, recommendations = [], source = 'local', context = null, origin = 'assistant', writeMode = '' }) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    recommendations,
    source,
    context,
    origin,
    writeMode,
    createdAt: Date.now(),
  }
}

export function createAssistantSession({ title, initialMessage, pinned = false }) {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    pinned,
    providerConversationId: '',
    messages: initialMessage ? [initialMessage] : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function normalizeAssistantSession(session) {
  return {
    id: session.id,
    title: session.title || '未命名会话',
    pinned: Boolean(session.pinned),
    providerConversationId: String(session.providerConversationId || ''),
    createdAt: Number(session.createdAt || Date.now()),
    updatedAt: Number(session.updatedAt || Date.now()),
    messages: Array.isArray(session.messages)
      ? session.messages.map((message) => ({
          ...message,
          recommendations: Array.isArray(message.recommendations) ? message.recommendations : [],
          context: message.context || null,
          origin: message.origin || 'assistant',
          writeMode: message.writeMode || '',
        }))
      : [],
  }
}

export function sortAssistantSessions(list) {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

export function readAssistantWorkspace(currentPost, fallbackSession = null) {
  const fallback = fallbackSession ? [fallbackSession] : []
  const raw = window.localStorage.getItem(assistantStorageKey(currentPost))

  if (!raw) {
    return {
      open: false,
      width: DEFAULT_ASSISTANT_WIDTH,
      activeSessionId: fallback[0]?.id || '',
      activeInlineSessionId: '',
      sessions: fallback,
    }
  }

  try {
    const parsed = JSON.parse(raw)
    const sessions = Array.isArray(parsed.sessions) && parsed.sessions.length
      ? sortAssistantSessions(parsed.sessions.map(normalizeAssistantSession))
      : fallback
    const activeSessionId = sessions.some((session) => session.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : sessions[0]?.id || ''

    return {
      open: Boolean(parsed.open),
      width: Number(parsed.width) || DEFAULT_ASSISTANT_WIDTH,
      activeSessionId,
      activeInlineSessionId: String(parsed.activeInlineSessionId || ''),
      sessions,
    }
  } catch {
    return {
      open: false,
      width: DEFAULT_ASSISTANT_WIDTH,
      activeSessionId: fallback[0]?.id || '',
      activeInlineSessionId: '',
      sessions: fallback,
    }
  }
}

export function writeAssistantWorkspace(currentPost, workspace, source = 'external') {
  window.localStorage.setItem(
    assistantStorageKey(currentPost),
    JSON.stringify({
      open: Boolean(workspace.open),
      width: Number(workspace.width) || DEFAULT_ASSISTANT_WIDTH,
      activeSessionId: workspace.activeSessionId || workspace.sessions?.[0]?.id || '',
      activeInlineSessionId: workspace.activeInlineSessionId || '',
      sessions: sortAssistantSessions((workspace.sessions || []).map(normalizeAssistantSession)),
    }),
  )
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_WORKSPACE_EVENT, {
      detail: { key: assistantStorageKey(currentPost), source },
    }),
  )
}

export function updateAssistantWorkspace(currentPost, updater, fallbackSession = null) {
  const current = readAssistantWorkspace(currentPost, fallbackSession)
  const next = updater(current)
  writeAssistantWorkspace(currentPost, next)
  return next
}
