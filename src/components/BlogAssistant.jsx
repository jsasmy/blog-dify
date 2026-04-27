import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import { assistantChatRequest } from '../services/blogApi.js'
import {
  ASSISTANT_WORKSPACE_EVENT,
  DEFAULT_ASSISTANT_WIDTH,
  createAssistantMessage,
  createAssistantSession,
  readAssistantWorkspace,
  sortAssistantSessions,
  writeAssistantWorkspace,
} from '../utils/assistantWorkspace.js'
import { formatDate } from '../utils/formatDate.js'

const MIN_WIDTH = 820
const MAX_WIDTH = 1380

const STOP_WORDS = new Set([
  '帮我',
  '一下',
  '看看',
  '想看',
  '文章',
  '博客',
  '内容',
  '关于',
  '相关',
  '哪些',
  '推荐',
  '找到',
  '查找',
  '寻找',
  '介绍',
  '总结',
  '概括',
  '提炼',
  '意思',
  '大意',
  '这篇',
  '本文',
])

const HOME_SUGGESTIONS = ['推荐新文章', '找写作相关', '热门文章有哪些', '帮我快速了解这个博客']
const POST_SUGGESTIONS = ['总结这篇文章', '这篇适合谁看', '推荐相似文章', '提炼这篇核心观点']

function clampWidth(value) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
}

function stripMarkup(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~>-]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function takeSentences(text, count = 2) {
  const parts = stripMarkup(text)
    .split(/(?<=[。！？.!?])/)
    .map((item) => item.trim())
    .filter(Boolean)

  return parts.slice(0, count).join(' ')
}

function tokenize(query) {
  const normalized = String(query || '')
    .toLowerCase()
    .trim()

  if (!normalized) {
    return []
  }

  const chunks = normalized
    .split(/[\s，。、“”‘’；：！？,.!?:;()（）【】/\\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOP_WORDS.has(item))

  return [...new Set([normalized, ...chunks])]
}

function scorePost(post, tokens) {
  if (!tokens.length) {
    return 0
  }

  const title = String(post.title || '').toLowerCase()
  const summary = String(post.summary || '').toLowerCase()
  const content = stripMarkup(post.content).toLowerCase()
  const keywords = (post.keywords || []).join(' ').toLowerCase()
  let score = 0

  tokens.forEach((token) => {
    if (title.includes(token)) {
      score += 8
    }
    if (summary.includes(token)) {
      score += 5
    }
    if (keywords.includes(token)) {
      score += 6
    }
    if (content.includes(token)) {
      score += 2
    }
  })

  return score
}

function buildPostDigest(post) {
  const lead = post.summary?.trim() || takeSentences(post.content, 1) || '这篇文章主要围绕一个明确主题展开。'
  const detail = takeSentences(post.content, 2)
  const audience = (post.keywords || []).length
    ? `如果你正在关注${post.keywords.slice(0, 3).join('、')}，这篇会比较对口。`
    : '如果你想快速把握主题背景和作者观点，可以先从这篇开始。'

  return [lead, detail && detail !== lead ? detail : '', audience].filter(Boolean).join(' ')
}

function buildOverview(posts) {
  if (!posts.length) {
    return '现在还没有可分析的文章。'
  }

  const latest = [...posts]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3)
    .map((post) => post.title)

  const keywordPool = posts.flatMap((post) => post.keywords || [])
  const topKeywords = [...new Set(keywordPool)].slice(0, 5)

  return `目前博客重点集中在${topKeywords.join('、') || '长期写作与知识整理'}这些主题。最近更新较新的文章有：${latest.join('、')}。`
}

function buildAllPostsOverview(posts) {
  if (!posts.length) {
    return '现在还没有可分析的文章。'
  }

  const intro = buildOverview(posts)
  const lines = posts
    .slice(0, 12)
    .map((post) => `${post.title}：${post.summary || takeSentences(post.content, 1) || '围绕该主题展开。'}`)

  return [intro, `逐篇来看：${lines.join('；')}`].join(' ')
}

function createLocalResponse(query, posts, currentPost) {
  const normalized = String(query || '').trim()
  const lowerQuery = normalized.toLowerCase()

  if (!normalized) {
    return {
      text: '你可以直接问我：帮我找写作相关的文章、推荐最近更新的文章，或者总结当前这篇文章。',
      recommendations: [],
      source: 'local',
    }
  }

  const askSummary = /(总结|概括|提炼|大意|讲什么|核心|重点)/.test(normalized)
  const askAudience = /(适合谁|谁适合看|给谁看|适合什么人)/.test(normalized)
  const askHot = /(热门|点击|阅读量|最受欢迎|高阅读)/.test(normalized)
  const askLatest = /(最新|最近|刚发布|近期)/.test(normalized)
  const askSimilar = /(相似|类似|同类|延伸|相关文章)/.test(normalized)
  const askOverview = /(博客|网站).*(介绍|概览|大体|整体)|快速了解这个博客/.test(normalized)
  const askAllPostsOverview = /(全部|所有|整站|全站).*(文章|博客|内容).*(总结|概括|提炼|列举|大意|含义)|总结目前所有文章|列举所有文章/.test(normalized)

  if (askAllPostsOverview) {
    return {
      text: buildAllPostsOverview(posts),
      recommendations: [...posts]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6),
      source: 'local',
    }
  }

  if (currentPost && (askSummary || askAudience)) {
    const text = askAudience
      ? `${currentPost.title}更适合想了解${(currentPost.keywords || []).slice(0, 3).join('、') || '这个主题'}的读者。它的阅读门槛不高，先给出主题摘要，再展开正文细节。`
      : buildPostDigest(currentPost)

    return {
      text,
      recommendations: askAudience ? [currentPost] : [],
      source: 'local',
    }
  }

  if (askOverview) {
    return {
      text: buildOverview(posts),
      recommendations: [...posts]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 3),
      source: 'local',
    }
  }

  if (askHot) {
    const recommendations = [...posts].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 3)
    return {
      text: recommendations.length
        ? '我按阅读量帮你挑了几篇更受欢迎的文章，适合先建立对博客主题的整体感觉。'
        : '暂时还没有足够的阅读数据。',
      recommendations,
      source: 'local',
    }
  }

  if (askLatest) {
    const recommendations = [...posts]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3)
    return {
      text: recommendations.length ? '这些是最近更新的文章，适合想先看最新内容的读者。' : '暂时还没有新文章。',
      recommendations,
      source: 'local',
    }
  }

  if (currentPost && askSimilar) {
    const currentKeywords = currentPost.keywords || []
    const recommendations = posts
      .filter((post) => post.id !== currentPost.id)
      .map((post) => ({ post, score: scorePost(post, currentKeywords) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.post)

    return {
      text: recommendations.length
        ? `我找了几篇和《${currentPost.title}》主题接近的文章，你可以顺着继续读。`
        : '这篇目前没有特别明显的同类文章，但你可以试试问我某个关键词。',
      recommendations,
      source: 'local',
    }
  }

  const tokens = tokenize(lowerQuery)
  const recommendations = posts
    .map((post) => ({ post, score: scorePost(post, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.post.createdAt) - new Date(a.post.createdAt))
    .slice(0, 4)
    .map((item) => item.post)

  if (recommendations.length) {
    const focus = tokens.filter((item) => item !== lowerQuery).slice(0, 3)
    return {
      text: `我根据${focus.length ? focus.join('、') : '你的问题'}筛到这些更相关的文章，你可以先看标题和摘要挑一篇进入。`,
      recommendations,
      source: 'local',
    }
  }

  return {
    text: '我暂时没找到高度匹配的文章。你可以换个更短的关键词，比如“写作”“研究”“工作流”“设计”。',
    recommendations: [],
    source: 'local',
  }
}

function cleanAssistantText(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s+|\s+$/g, '')
}

function normalizeAssistantErrorMessage(error) {
  const message = String(error?.message || '').trim()

  if (!message || message === 'fetch failed' || message === '请求失败') {
    return 'AI 服务暂时不可用，请稍后再试。'
  }

  if (/503|UNAVAILABLE|high demand/i.test(message)) {
    return 'AI 模型当前负载较高，已切换为本地检索回答。'
  }

  if (/timeout|超时/i.test(message)) {
    return 'AI 服务响应超时，已切换为本地检索回答。'
  }

  return message
}

function createInitialSession(introMessage) {
  return createAssistantSession({
    title: '新会话 1',
    initialMessage: introMessage,
    pinned: false,
  })
}

function toHistoryPayload(messages, limit = 8) {
  return messages
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      text: message.text,
      source: message.source,
    }))
}

function BlogAssistant({ posts = [], currentPost = null, suggestions: customSuggestions = null, workspaceId = 'user-public', allowInlineSessionControl = false }) {
  const suggestions = customSuggestions || (currentPost ? POST_SUGGESTIONS : HOME_SUGGESTIONS)
  const panelRef = useRef(null)
  const renameInputRef = useRef(null)
  const dragStateRef = useRef(null)
  const [query, setQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(DEFAULT_ASSISTANT_WIDTH)
  const [renamingSessionId, setRenamingSessionId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState('')
  const [expandedContextIds, setExpandedContextIds] = useState(() => new Set())
  const [activeInlineSessionId, setActiveInlineSessionId] = useState('')

  const introMessage = useMemo(
    () =>
      createAssistantMessage({
        role: 'assistant',
        text: currentPost
          ? '助手已开启。你现在在文章页提问时，我会知道当前打开的文章；也可以新建会话聊其他主题。'
          : '助手已开启。你可以新建多个会话，分别聊选题、找文章、总结全文。',
        recommendations: currentPost ? [currentPost] : [],
        source: 'local',
      }),
    [currentPost],
  )

  const initialSession = useMemo(() => createInitialSession(introMessage), [introMessage])
  const [sessions, setSessions] = useState(() => [initialSession])
  const [activeSessionId, setActiveSessionId] = useState(() => initialSession.id)

  useEffect(() => {
    const restored = readAssistantWorkspace(workspaceId, initialSession)
    setSessions(restored.sessions.length ? restored.sessions : [initialSession])
    setActiveSessionId(restored.activeSessionId || initialSession.id)
    setActiveInlineSessionId(restored.activeInlineSessionId || '')
    setOpen(Boolean(restored.open))
    setWidth(clampWidth(Number(restored.width) || DEFAULT_ASSISTANT_WIDTH))
    setLoaded(true)
  }, [initialSession, workspaceId])

  useEffect(() => {
    function syncWorkspace(event) {
      if (event?.detail?.source === 'blog-assistant') {
        return
      }
      const restored = readAssistantWorkspace(workspaceId, initialSession)
      setSessions(restored.sessions.length ? restored.sessions : [initialSession])
      setActiveSessionId((current) => {
        const nextId = restored.activeSessionId || restored.sessions[0]?.id || initialSession.id
        return restored.sessions.some((session) => session.id === current) ? current : nextId
      })
      setActiveInlineSessionId(restored.activeInlineSessionId || '')
      setOpen(Boolean(restored.open))
      setWidth(clampWidth(Number(restored.width) || DEFAULT_ASSISTANT_WIDTH))
    }

    window.addEventListener(ASSISTANT_WORKSPACE_EVENT, syncWorkspace)
    return () => window.removeEventListener(ASSISTANT_WORKSPACE_EVENT, syncWorkspace)
  }, [initialSession, workspaceId])

  useEffect(() => {
    if (!loaded) {
      return
    }

    writeAssistantWorkspace(workspaceId, {
      open,
      width,
      activeSessionId,
      activeInlineSessionId,
      sessions,
    }, 'blog-assistant')
  }, [activeInlineSessionId, activeSessionId, loaded, open, sessions, width, workspaceId])

  useEffect(() => {
    if (renamingSessionId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingSessionId])

  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0]
  const orderedSessions = useMemo(() => sortAssistantSessions(sessions), [sessions])

  function patchSessions(updater) {
    setSessions((current) => sortAssistantSessions(updater(current)))
  }

  function replaceSessionMessages(sessionId, updater) {
    patchSessions((current) =>
      current.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: updater(session.messages),
                  updatedAt: Date.now(),
            }
          : session,
      ),
    )
  }

  function handleNewSession() {
    const nextIndex = sessions.length + 1
    const session = createAssistantSession({
      title: `新会话 ${nextIndex}`,
      initialMessage: createAssistantMessage({
        role: 'assistant',
        text: currentPost
          ? `新会话已开启。你当前打开的是《${currentPost.title}》，提问时我会带着这篇文章的上下文理解。`
          : '新会话已开启。你可以把它当成另一个窗口，单独聊一个主题。',
        source: 'local',
      }),
    })
    patchSessions((current) => [session, ...current])
    setActiveSessionId(session.id)
    setDeleteConfirmId('')
    setOpen(true)
  }

  function togglePin(sessionId) {
    patchSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              pinned: !session.pinned,
              updatedAt: Date.now(),
            }
          : session,
      ),
    )
  }

  function startRename(session) {
    setRenamingSessionId(session.id)
    setRenameDraft(session.title)
    setDeleteConfirmId('')
  }

  function commitRename(sessionId) {
    const nextTitle = renameDraft.trim() || '未命名会话'
    patchSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              title: nextTitle,
              updatedAt: Date.now(),
            }
          : session,
      ),
    )
    setRenamingSessionId('')
    setRenameDraft('')
    setDeleteConfirmId('')
  }

  function handleCloseSession(sessionId) {
    const target = sessions.find((session) => session.id === sessionId)

    if (!target) {
      return
    }

    if (target.pinned) {
      return
    }

    if (deleteConfirmId !== sessionId) {
      setDeleteConfirmId(sessionId)
      return
    }

    patchSessions((current) => {
      if (current.length === 1) {
        const resetSession = createInitialSession(currentPost, introMessage)
        setActiveSessionId(resetSession.id)
        return [resetSession]
      }

      const nextSessions = current.filter((session) => session.id !== sessionId)
      if (sessionId === activeSessionId) {
        setActiveSessionId(sortAssistantSessions(nextSessions)[0]?.id || '')
      }
      return nextSessions
    })
    setDeleteConfirmId('')
  }

  function cancelDeleteConfirm() {
    setDeleteConfirmId('')
  }

  function toggleContextExpanded(messageId) {
    setExpandedContextIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }

  function toggleInlineSession(sessionId) {
    setActiveInlineSessionId((current) => (current === sessionId ? '' : sessionId))
  }

  function startDrag(event) {
    if (window.innerWidth <= 960) {
      return
    }

    dragStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    }

    function onMove(moveEvent) {
      const delta = dragStateRef.current.startX - moveEvent.clientX
      setWidth(clampWidth(dragStateRef.current.startWidth + delta))
    }

    function onUp() {
      dragStateRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  async function submit(nextQuery) {
    const value = String(nextQuery || query).trim()

    if (!value || submitting || !activeSession) {
      return
    }

    const userMessage = createAssistantMessage({ role: 'user', text: value })
    replaceSessionMessages(activeSession.id, (messages) => [...messages, userMessage])
    setQuery('')
    setSubmitting(true)
    setOpen(true)
    setDeleteConfirmId('')
    const articleSearch = createLocalResponse(value, posts, currentPost)

    try {
      const response = await assistantChatRequest({
        query: value,
        currentPostId: currentPost?.id || '',
        history: toHistoryPayload(activeSession.messages),
        conversationId: activeSession.providerConversationId || '',
        sessionId: activeSession.id,
      })

      patchSessions((current) =>
        current.map((session) =>
          session.id === activeSession.id
            ? {
                ...session,
                providerConversationId: response.conversationId || session.providerConversationId || '',
                updatedAt: Date.now(),
                messages: [
                  ...session.messages,
                  createAssistantMessage({
                    role: 'assistant',
                    text: response.text || 'AI 助手暂时没有返回内容。',
                    recommendations: response.recommendations || [],
                    source: 'ai',
                  }),
                ],
              }
            : session,
        ),
      )
    } catch (error) {
      const normalizedErrorMessage = normalizeAssistantErrorMessage(error)
      replaceSessionMessages(activeSession.id, (messages) => [
        ...messages,
        createAssistantMessage({
          role: 'assistant',
          text: `${articleSearch.text}${normalizedErrorMessage ? ` 当前已切换为本地检索回答：${normalizedErrorMessage}` : ''}`,
          recommendations: articleSearch.recommendations,
          source: 'local',
        }),
      ])
    } finally {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return null
  }

  return (
    <>
      <div className="assistant-launcher-cluster">
        <button type="button" className="assistant-fab" onClick={() => setOpen((current) => !current)}>
          {open ? '收起助手' : '打开助手'}
        </button>
        <button type="button" className="assistant-mini-action" onClick={handleNewSession}>
          新会话
        </button>
      </div>

      {open ? (
        <section className="assistant-window" aria-label="博客智能助手窗口" ref={panelRef} style={{ width: `${width}px` }}>
          <div className="assistant-resize-handle" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />

          <header className="assistant-window-head">
            <div>
              <p className="eyebrow">Assistant Workspace</p>
              <h2>博客智能助手</h2>
            </div>
            <div className="assistant-window-actions">
              <span className="assistant-badge">AI + 站内检索</span>
              <button type="button" className="assistant-icon-button" onClick={handleNewSession}>
                + 会话
              </button>
              <button type="button" className="assistant-icon-button" onClick={() => setOpen(false)}>
                收起
              </button>
            </div>
          </header>

          <div className="assistant-window-body">
            <aside className="assistant-session-sidebar">
              <div className="assistant-session-list">
                {orderedSessions.map((session) => {
                  const isActive = session.id === activeSession?.id
                  const isRenaming = renamingSessionId === session.id
                  const isDeleteConfirm = deleteConfirmId === session.id

                  return (
                    <article key={session.id} className={`assistant-session-card${isActive ? ' active' : ''}`}>
                      <button type="button" className="assistant-session-main" onClick={() => setActiveSessionId(session.id)}>
                        <div className="assistant-session-title-row">
                          {isRenaming ? (
                            <input
                              ref={renameInputRef}
                              className="assistant-session-title-input"
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={() => commitRename(session.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  commitRename(session.id)
                                }

                                if (event.key === 'Escape') {
                                  setRenamingSessionId('')
                                  setRenameDraft('')
                                }
                              }}
                            />
                          ) : (
                            <strong>{session.title}</strong>
                          )}

                          {session.pinned ? <span className="assistant-pin">固定</span> : null}
                          {allowInlineSessionControl && session.id === activeInlineSessionId ? <span className="assistant-inline-badge">+</span> : null}
                        </div>
                        <span>{session.messages.at(-1)?.text || '开始新的提问'}</span>
                      </button>

                      <div className="assistant-session-tools">
                        <button type="button" className="assistant-session-tool" onClick={() => togglePin(session.id)}>
                          {session.pinned ? '取消固定' : '固定'}
                        </button>
                        <button type="button" className="assistant-session-tool" onClick={() => startRename(session)}>
                          重命名
                        </button>
                        {allowInlineSessionControl ? (
                          <button type="button" className="assistant-session-tool" onClick={() => toggleInlineSession(session.id)}>
                            {session.id === activeInlineSessionId ? '取消+' : '设为+'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`assistant-session-tool danger${session.pinned ? ' disabled' : ''}`}
                          onClick={() => handleCloseSession(session.id)}
                          disabled={session.pinned}
                        >
                          {isDeleteConfirm ? '确认删除' : '删除'}
                        </button>
                      </div>

                      {isDeleteConfirm ? (
                        <div className="assistant-session-confirm">
                          <span>再次点击删除，或取消。</span>
                          <button type="button" className="assistant-session-tool" onClick={cancelDeleteConfirm}>
                            取消
                          </button>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </aside>

            <div className="assistant-chat-panel">
              <div className="assistant-suggestions" aria-label="快捷提问">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="assistant-chip"
                    onClick={() => submit(item)}
                    disabled={submitting}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="assistant-thread assistant-window-thread" role="log" aria-live="polite">
                {(activeSession?.messages || []).map((message) => (
                  <article key={message.id} className={`assistant-message assistant-message-${message.role}`}>
                    <div className="assistant-message-top">
                      <span className="assistant-role">{message.role === 'assistant' ? '助手' : '你'}</span>
                      {message.role === 'assistant' ? (
                        <span className="assistant-source">{message.source === 'ai' ? 'AI' : '本地检索'}</span>
                      ) : null}
                    </div>
                    {message.context ? (
                      <div className={`assistant-message-context${expandedContextIds.has(message.id) ? ' is-expanded' : ''}`}>
                        <div className="assistant-message-context-head">
                          <strong>{message.context.label || (message.context.type === 'selection' ? '选中文本' : '当前段落')}</strong>
                          <button type="button" className="assistant-context-toggle" onClick={() => toggleContextExpanded(message.id)}>
                            {expandedContextIds.has(message.id) ? '收起' : '展开'}
                          </button>
                        </div>
                        <span>{expandedContextIds.has(message.id) ? message.context.text : message.context.preview || message.context.text}</span>
                      </div>
                    ) : null}
                    {message.role === 'assistant' ? (
                      <div className="assistant-rich-text markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanAssistantText(message.text)}</ReactMarkdown>
                      </div>
                    ) : (
                      <p>{message.text}</p>
                    )}

                    {(message.recommendations || []).length > 0 ? (
                      <div className="assistant-results">
                        <div className="assistant-results-head">
                          <strong>文章通道</strong>
                          <span>点击卡片打开文章</span>
                        </div>
                        {message.recommendations.map((post) => (
                          <Link key={post.id} className="assistant-result-card" to={`/post/${post.id}`}>
                            <strong>{post.title}</strong>
                            <span>{post.summary}</span>
                            <em>
                              {formatDate(post.createdAt)} · {post.clicks || 0} 次阅读
                            </em>
                            <small>打开文章</small>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}

                {submitting ? (
                  <article className="assistant-message assistant-message-assistant">
                    <div className="assistant-message-top">
                      <span className="assistant-role">助手</span>
                      <span className="assistant-source">处理中</span>
                    </div>
                    <p>正在结合站内文章和 AI 模型生成回答...</p>
                  </article>
                ) : null}
              </div>

              <form
                className="assistant-form assistant-window-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  submit(query)
                }}
              >
                <label className="field grow" htmlFor="assistant-query">
                  <span>向当前会话提问</span>
                  <textarea
                    id="assistant-query"
                    rows="3"
                    placeholder={currentPost ? '例如：总结这篇文章，或换个角度继续问' : '例如：帮我找写作相关的文章，或新开一个主题会话'}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    disabled={submitting}
                  />
                </label>

                <button type="submit" className="button button-primary" disabled={submitting}>
                  {submitting ? '生成中...' : '发送问题'}
                </button>
              </form>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

export default BlogAssistant
