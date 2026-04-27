import { EditorContent, useEditor } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import BlogAssistant from '../components/BlogAssistant.jsx'
import { useBlog } from '../context/BlogContext.jsx'
import { assistantChatRequest } from '../services/blogApi.js'
import {
  ASSISTANT_WORKSPACE_EVENT,
  createAssistantMessage,
  createAssistantSession,
  readAssistantWorkspace,
  updateAssistantWorkspace,
} from '../utils/assistantWorkspace.js'

const LOCAL_DRAFT_KEY = 'simple-blog-editor-draft'
const EDITOR_SUGGESTIONS = ['帮我拟一个标题', '生成文章大纲', '润色这段内容', '提炼摘要和关键词']
const PARAGRAPH_SELECTOR = 'p, h2, h3, li, blockquote, pre'

const toolbarItems = [
  { label: '正文', action: 'paragraph' },
  { label: 'H2', action: 'h2' },
  { label: 'H3', action: 'h3' },
  { label: '加粗', action: 'bold' },
  { label: '斜体', action: 'italic' },
  { label: '引用', action: 'blockquote' },
  { label: '无序列表', action: 'bulletList' },
  { label: '有序列表', action: 'orderedList' },
  { label: '代码块', action: 'codeBlock' },
  { label: '链接', action: 'link' },
  { label: '图片', action: 'image' },
  { label: '分隔线', action: 'divider' },
]

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

function markdownishToHtml(value) {
  if (!value?.trim()) {
    return '<p></p>'
  }

  if (looksLikeHtml(value)) {
    return value
  }

  const lines = value.replace(/\r/g, '').split('\n')
  const blocks = []
  let listBuffer = []
  let orderedBuffer = []

  function flushLists() {
    if (listBuffer.length > 0) {
      blocks.push(`<ul>${listBuffer.map((item) => `<li>${item}</li>`).join('')}</ul>`)
      listBuffer = []
    }
    if (orderedBuffer.length > 0) {
      blocks.push(`<ol>${orderedBuffer.map((item) => `<li>${item}</li>`).join('')}</ol>`)
      orderedBuffer = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushLists()
      continue
    }

    if (line.startsWith('### ')) {
      flushLists()
      blocks.push(`<h3>${escapeHtml(line.slice(4))}</h3>`)
      continue
    }

    if (line.startsWith('## ')) {
      flushLists()
      blocks.push(`<h2>${escapeHtml(line.slice(3))}</h2>`)
      continue
    }

    if (line.startsWith('> ')) {
      flushLists()
      blocks.push(`<blockquote><p>${escapeHtml(line.slice(2))}</p></blockquote>`)
      continue
    }

    if (line === '---') {
      flushLists()
      blocks.push('<hr />')
      continue
    }

    if (line.startsWith('- ')) {
      orderedBuffer = []
      listBuffer.push(escapeHtml(line.slice(2)))
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      listBuffer = []
      orderedBuffer.push(escapeHtml(line.replace(/^\d+\.\s/, '')))
      continue
    }

    flushLists()
    blocks.push(`<p>${escapeHtml(line)}</p>`)
  }

  flushLists()
  return blocks.join('') || '<p></p>'
}

function htmlToPlainText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanAiEditorReply(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function resizeSummaryField(element) {
  if (!element) return
  const minHeight = 74
  element.style.setProperty('height', 'auto', 'important')
  element.style.setProperty('height', `${Math.max(element.scrollHeight, minHeight)}px`, 'important')
  element.style.setProperty('overflow', 'hidden', 'important')
}

function scheduleSummaryResize(element) {
  if (!element) return
  window.requestAnimationFrame(() => resizeSummaryField(element))
}

function previewParagraphText(text) {
  const value = String(text || '').trim()
  if (!value) return '当前为空段落'
  return value.length > 80 ? `${value.slice(0, 80)}...` : value
}

function normalizeInlineDecisionAction(action) {
  const value = String(action || '').trim().toLowerCase()
  if (['insert', 'append', 'write', 'add'].includes(value)) return 'insert'
  if (['replace', 'rewrite', 'update'].includes(value)) return 'replace'
  return 'reply'
}

function extractJsonCandidate(text) {
  const value = String(text || '').trim()
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1)
  }

  return value
}

function parseInlineAssistantDecision(rawText) {
  const cleanedText = cleanAiEditorReply(rawText)
  const candidate = extractJsonCandidate(cleanedText)

  try {
    const parsed = JSON.parse(candidate)
    const content = String(parsed?.content || parsed?.text || parsed?.answer || '').trim()
    return {
      action: normalizeInlineDecisionAction(parsed?.action),
      content: content || cleanedText,
    }
  } catch {
    return {
      action: 'reply',
      content: cleanedText,
    }
  }
}

function EditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { createPost, fetchPost, importDocument, updatePost, uploadAttachment, uploadImage, posts, listPosts } = useBlog()
  const imageInputRef = useRef(null)
  const coverInputRef = useRef(null)
  const paperRef = useRef(null)
  const activeBlockRef = useRef(null)
  const selectedRangeRef = useRef(null)
  const summaryInputRef = useRef(null)

  const [title, setTitle] = useState('')
  const [keywords, setKeywords] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('<p></p>')
  const [fileMeta, setFileMeta] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [status, setStatus] = useState('published')
  const [coverImageUrl, setCoverImageUrl] = useState('')
  const [loading, setLoading] = useState(Boolean(id))
  const [importing, setImporting] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [autosaveMessage, setAutosaveMessage] = useState('')

  const [paragraphTarget, setParagraphTarget] = useState(null)
  const [activeParagraph, setActiveParagraph] = useState(null)
  const [inlineMessages, setInlineMessages] = useState([])
  const [inlinePrompt, setInlinePrompt] = useState('')
  const [inlineConversationId, setInlineConversationId] = useState('')
  const [inlineAiBusy, setInlineAiBusy] = useState(false)
  const [recognizedExpanded, setRecognizedExpanded] = useState(false)
  const [inlineWorkspaceSessionId, setInlineWorkspaceSessionId] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: '在这里开始撰写正文内容...' }),
    ],
    content,
    immediatelyRender: false,
    onUpdate({ editor: currentEditor }) {
      setContent(currentEditor.getHTML())
      window.requestAnimationFrame(() => updateParagraphTargetFromBlock(activeBlockRef.current))
    },
    editorProps: {
      attributes: {
        class: 'tiptap editor-paper-content picdoc-body-content',
      },
      handleKeyDown(view, event) {
        if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
          return false
        }

        const { state, dispatch } = view
        dispatch(state.tr.insertText('　', state.selection.from, state.selection.to))
        return true
      },
    },
  })

  const isPublishedPost = id && status === 'published'

  const draftSnapshot = useMemo(
    () => ({ title, keywords, summary, content, attachments, fileMeta, coverImageUrl }),
    [attachments, content, coverImageUrl, fileMeta, keywords, summary, title],
  )

  const editorAssistantPost = useMemo(
    () => ({
      id: id || 'editor-draft',
      title: title || '未命名草稿',
      summary: summary || '当前正在编辑的文章草稿',
      content: htmlToPlainText(content),
      keywords: keywords
        .split(/[，,]/)
        .map((item) => item.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clicks: 0,
    }),
    [content, id, keywords, summary, title],
  )
  const editorAssistantWorkspaceId = useMemo(() => `admin-editor:${id || 'draft'}`, [id])

  const inlineFallbackSession = useMemo(
    () =>
      createAssistantSession({
        title: '编辑器 AI 会话',
        initialMessage: createAssistantMessage({
          role: 'assistant',
          text: '编辑器 AI 会话已开启。段落加号和右键选中文本产生的问答都会记录在这里。',
          source: 'local',
        }),
        pinned: false,
      }),
    [],
  )

  useEffect(() => {
    listPosts({ sort: 'time-desc' })
  }, [listPosts])

  useEffect(() => {
    scheduleSummaryResize(summaryInputRef.current)
  }, [summary])

  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  useEffect(() => {
    if (!id) {
      const savedDraft = window.localStorage.getItem(LOCAL_DRAFT_KEY)
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft)
          setTitle(parsed.title || '')
          setKeywords(parsed.keywords || '')
          setSummary(parsed.summary || '')
          setContent(parsed.content || '<p></p>')
          setAttachments(parsed.attachments || [])
          setFileMeta(parsed.fileMeta || null)
          setCoverImageUrl(parsed.coverImageUrl || '')
          setStatus('draft')
          setAutosaveMessage('已恢复上次未提交的草稿')
        } catch {
          window.localStorage.removeItem(LOCAL_DRAFT_KEY)
        }
      }
      return
    }

    let active = true
    async function loadPost() {
      setLoading(true)
      try {
        const post = await fetchPost(id, { admin: true })
        if (!active) return

        setTitle(post.title || '')
        setKeywords((post.keywords || []).join('，'))
        setSummary(post.summary || '')
        setContent(markdownishToHtml(post.content || ''))
        setAttachments(post.attachments || [])
        setStatus(post.status || 'published')
        setCoverImageUrl(post.coverImageUrl || '')
        setFileMeta(
          post.fileUrl
            ? {
                originalFileName: post.originalFileName,
                fileUrl: post.fileUrl,
                storedFileName: post.storedFileName,
                mimeType: post.fileMimeType,
              }
            : null,
        )
      } catch (loadError) {
        if (active) setError(loadError.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadPost()
    return () => {
      active = false
    }
  }, [fetchPost, id])

  useEffect(() => {
    if (id || (!title.trim() && !htmlToPlainText(content) && !summary.trim())) return

    const timer = window.setTimeout(() => {
      window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draftSnapshot))
      setAutosaveMessage('已自动保存到本地草稿')
    }, 900)

    return () => window.clearTimeout(timer)
  }, [content, draftSnapshot, id, summary, title])

  useEffect(() => {
    if (!id || status !== 'draft' || (!title.trim() && !htmlToPlainText(content))) return

    const timer = window.setTimeout(async () => {
      const normalizedKeywords = keywords
        .split(/[，,]/)
        .map((item) => item.trim())
        .filter(Boolean)

      try {
        await updatePost(id, {
          title,
          summary,
          content,
          attachments,
          coverImageUrl,
          status: 'draft',
          keywords: normalizedKeywords,
          source: fileMeta ? 'import' : 'manual',
          file: fileMeta,
        })
        setAutosaveMessage('草稿已自动保存')
      } catch {
        setAutosaveMessage('自动保存失败，请手动保存草稿')
      }
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [attachments, content, coverImageUrl, fileMeta, id, keywords, status, summary, title, updatePost])

  useEffect(() => {
    function syncInlineSession(event) {
      if (event?.detail?.source !== 'blog-assistant' || !inlineWorkspaceSessionId) {
        return
      }

      const workspace = readAssistantWorkspace(editorAssistantWorkspaceId, inlineFallbackSession)
      const stillExists = workspace.sessions.some((session) => session.id === inlineWorkspaceSessionId)
      if (stillExists) {
        return
      }

      setInlineWorkspaceSessionId('')
      setInlineConversationId('')
      setInlineMessages([])
      setInlinePrompt('')
      setActiveParagraph(null)
      setParagraphTarget(null)
      selectedRangeRef.current = null
    }

    window.addEventListener(ASSISTANT_WORKSPACE_EVENT, syncInlineSession)
    return () => window.removeEventListener(ASSISTANT_WORKSPACE_EVENT, syncInlineSession)
  }, [editorAssistantWorkspaceId, inlineFallbackSession, inlineWorkspaceSessionId])

  async function handleEditorImageUpload(event) {
    const file = event.target.files?.[0]
    if (!file || !editor) return
    setUploadingImage(true)
    setError('')
    try {
      const image = await uploadImage(file)
      editor.chain().focus().setImage({ src: image.fileUrl, alt: image.originalFileName }).run()
      setSuccessMessage('图片已插入正文')
    } catch (uploadError) {
      setError(uploadError.message || '图片上传失败')
    } finally {
      setUploadingImage(false)
      event.target.value = ''
    }
  }

  async function handleCoverUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    setError('')
    try {
      const image = await uploadImage(file)
      setCoverImageUrl(image.fileUrl)
      setSuccessMessage('封面图已上传')
    } catch (uploadError) {
      setError(uploadError.message || '封面图上传失败')
    } finally {
      setUploadingImage(false)
      event.target.value = ''
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setImporting(true)
    try {
      const result = await importDocument(file)
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setFileMeta(result.file)
        setSuccessMessage('PDF 原文件已关联，可继续自己填写文章内容')
      } else {
        setTitle(result.title || '')
        setSummary(result.summary || '')
        setContent(markdownishToHtml(result.content || ''))
        setKeywords((result.keywords || []).join('，'))
        setFileMeta(result.file)
        setSuccessMessage('文档内容已导入编辑区')
      }
    } catch (importError) {
      setError(importError.message || '导入失败，请重试')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  async function handleAttachmentUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setSuccessMessage('')
    setUploadingAttachment(true)
    try {
      const uploaded = await uploadAttachment(file)
      setAttachments((current) => [...current, uploaded])
      setSuccessMessage('附件上传成功')
    } catch (uploadError) {
      setError(uploadError.message || '附件上传失败')
    } finally {
      setUploadingAttachment(false)
      event.target.value = ''
    }
  }

  function handleRemoveAttachment(storedFileName) {
    setAttachments((current) => current.filter((item) => item.storedFileName !== storedFileName))
  }

  function applyToolbar(action) {
    if (!editor) return
    switch (action) {
      case 'paragraph':
        editor.chain().focus().setParagraph().run()
        break
      case 'h2':
        editor.chain().focus().toggleHeading({ level: 2 }).run()
        break
      case 'h3':
        editor.chain().focus().toggleHeading({ level: 3 }).run()
        break
      case 'bold':
        editor.chain().focus().toggleBold().run()
        break
      case 'italic':
        editor.chain().focus().toggleItalic().run()
        break
      case 'blockquote':
        editor.chain().focus().toggleBlockquote().run()
        break
      case 'callout':
        editor.chain().focus().insertContent('<blockquote><p>在这里写提示信息</p></blockquote>').run()
        break
      case 'bulletList':
        editor.chain().focus().toggleBulletList().run()
        break
      case 'orderedList':
        editor.chain().focus().toggleOrderedList().run()
        break
      case 'codeBlock':
        editor.chain().focus().toggleCodeBlock().run()
        break
      case 'link': {
        const url = window.prompt('输入链接地址', 'https://')
        if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        break
      }
      case 'image':
        imageInputRef.current?.click()
        break
      case 'divider':
        editor.chain().focus().setHorizontalRule().run()
        break
      case 'alignLeft':
        editor.chain().focus().setTextAlign('left').run()
        break
      case 'alignCenter':
        editor.chain().focus().setTextAlign('center').run()
        break
      default:
        break
    }
  }

  function updateParagraphTargetFromBlock(block) {
    if (!paperRef.current || !block || !paperRef.current.contains(block)) return

    const rect = block.getBoundingClientRect()
    const paperRect = paperRef.current.getBoundingClientRect()

    activeBlockRef.current = block
    selectedRangeRef.current = null
    const nextTarget = {
      kind: 'block',
      text: block.innerText.trim(),
      top: rect.top - paperRect.top + paperRef.current.scrollTop,
      height: rect.height,
    }
    setParagraphTarget(nextTarget)
    if (activeParagraph) {
      setActiveParagraph(nextTarget)
    }
  }

  function insertTextAfterActiveParagraph(text) {
    if (!editor || !activeBlockRef.current) return

    const pos = editor.view.posAtDOM(activeBlockRef.current, 0)
    const nodeSize = editor.view.state.doc.nodeAt(pos)?.nodeSize || 0
    if (pos < 0 || !nodeSize) return

    editor
      .chain()
      .focus()
      .insertContentAt(pos + nodeSize, `<p>${escapeHtml(cleanAiEditorReply(text))}</p>`)
      .run()
    window.requestAnimationFrame(() => updateParagraphTargetFromBlock(activeBlockRef.current))
  }

  function replaceActiveParagraphText(text) {
    if (!editor) return

    if (selectedRangeRef.current && paragraphTarget?.kind === 'selection') {
      const { from, to } = selectedRangeRef.current
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, escapeHtml(cleanAiEditorReply(text)))
        .run()
      selectedRangeRef.current = null
      setActiveParagraph(null)
      setParagraphTarget(null)
      return
    }

    if (!activeBlockRef.current) return

    const pos = editor.view.posAtDOM(activeBlockRef.current, 0)
    const nodeSize = editor.view.state.doc.nodeAt(pos)?.nodeSize || 0
    if (pos < 0 || !nodeSize) return

    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + nodeSize }, `<p>${escapeHtml(cleanAiEditorReply(text))}</p>`)
      .run()
    window.requestAnimationFrame(() => {
      const nextBlock = paperRef.current?.querySelector('.picdoc-body-content p, .picdoc-body-content h2, .picdoc-body-content h3, .picdoc-body-content li, .picdoc-body-content blockquote, .picdoc-body-content pre')
      updateParagraphTargetFromBlock(nextBlock)
    })
  }

  function findFirstEditorBlock() {
    return paperRef.current?.querySelector('.picdoc-body-content p, .picdoc-body-content h2, .picdoc-body-content h3, .picdoc-body-content li, .picdoc-body-content blockquote, .picdoc-body-content pre') || null
  }

  function findBlockFromNode(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node
    return element?.closest?.(PARAGRAPH_SELECTOR) || null
  }

  function clearSelectionTarget() {
    selectedRangeRef.current = null
    if (paragraphTarget?.kind === 'selection') {
      setParagraphTarget(null)
    }
    if (activeParagraph?.kind === 'selection') {
      setActiveParagraph(null)
      setInlineConversationId('')
      setInlineMessages([])
      setInlinePrompt('')
      setRecognizedExpanded(false)
    }
  }

  function updateSelectionTargetFromRange(range, selectedText) {
    if (!paperRef.current || !editor) return false

    const contentRoot = paperRef.current.querySelector('.picdoc-body-content')
    if (!contentRoot) return false

    const commonNode = range.commonAncestorContainer?.nodeType === 3 ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer
    if (!commonNode || !contentRoot.contains(commonNode)) {
      return false
    }

    const selectionRect = range.getBoundingClientRect()
    const firstRect = range.getClientRects()?.[0]
    const rect = selectionRect.width || selectionRect.height ? selectionRect : firstRect
    if (!rect) return false

    const block = findBlockFromNode(range.startContainer) || findFirstEditorBlock()
    const paperRect = paperRef.current.getBoundingClientRect()
    let { from, to, empty } = editor.state.selection
    if (empty) {
      try {
        from = editor.view.posAtDOM(range.startContainer, range.startOffset)
        to = editor.view.posAtDOM(range.endContainer, range.endOffset)
        empty = from === to
      } catch {
        return false
      }
    }
    if (empty) return false
    if (from > to) {
      ;[from, to] = [to, from]
    }

    activeBlockRef.current = block
    selectedRangeRef.current = { from, to }
    const nextTarget = {
      kind: 'selection',
      text: selectedText,
      top: rect.top - paperRect.top + paperRef.current.scrollTop,
      height: Math.max(rect.height, 28),
      left: rect.left - paperRect.left + paperRef.current.scrollLeft,
      width: Math.max(rect.width, 32),
    }
    setParagraphTarget(nextTarget)
    if (activeParagraph) {
      setActiveParagraph(nextTarget)
    }
    return true
  }

  function getRequestedParagraphIndex(prompt) {
    const text = String(prompt || '')
    const numericMatch = text.match(/第\s*(\d+)\s*段/)
    if (numericMatch) {
      return Math.max(Number(numericMatch[1]) - 1, 0)
    }

    const chineseNumbers = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    }
    const chineseMatch = text.match(/第\s*([一二两三四五六七八九十])\s*段/)
    if (chineseMatch) {
      return chineseNumbers[chineseMatch[1]] - 1
    }

    return null
  }

  function findEditorBlockByPrompt(prompt) {
    const requestedIndex = getRequestedParagraphIndex(prompt)
    if (requestedIndex === null) {
      return null
    }

    const contentRoot = paperRef.current?.querySelector('.picdoc-body-content')
    const blocks = [...(contentRoot?.querySelectorAll(PARAGRAPH_SELECTOR) || [])].filter((block) => contentRoot.contains(block))
    return blocks[requestedIndex] || null
  }

  async function typeTextIntoEditor(text, mode = 'insert', format = 'markdown', prompt = '') {
    if (!editor) return false

    const value = cleanAiEditorReply(text)
    if (!value) return false

    if (mode === 'replace' && selectedRangeRef.current && paragraphTarget?.kind === 'selection') {
      const { from, to } = selectedRangeRef.current
      const finalHtml = format === 'plain' ? escapeHtml(value) : markdownishToHtml(value)
      editor.chain().focus().insertContentAt({ from, to }, finalHtml).run()
      selectedRangeRef.current = null
      return true
    }

    const sourceBlock = findEditorBlockByPrompt(prompt) || (activeBlockRef.current?.isConnected ? activeBlockRef.current : findFirstEditorBlock())
    const finalHtml = format === 'plain' ? `<p>${escapeHtml(value)}</p>` : markdownishToHtml(value)

    if (!sourceBlock) {
      editor.chain().focus().insertContent(finalHtml).run()
      return true
    }

    let startPos = -1
    try {
      startPos = editor.view.posAtDOM(sourceBlock, 0)
    } catch {
      startPos = -1
    }

    const startNodeSize = startPos >= 0 ? editor.view.state.doc.nodeAt(startPos)?.nodeSize || 0 : 0
    if (startPos < 0 || !startNodeSize) {
      editor.chain().focus().insertContent(finalHtml).run()
      return true
    }

    const insertPosition = mode === 'insert' ? startPos + startNodeSize : { from: startPos, to: startPos + startNodeSize }
    editor.chain().focus().insertContentAt(insertPosition, finalHtml).run()

    window.requestAnimationFrame(() => {
      const lookupPos = mode === 'insert' ? startPos + startNodeSize + 1 : startPos + 1
      const block = editor.view.domAtPos(lookupPos)?.node?.parentElement?.closest?.(PARAGRAPH_SELECTOR)
      updateParagraphTargetFromBlock(block || sourceBlock)
    })

    return true
  }

  function handleSelectionContextMenu(event) {
    const rawTarget = event.target?.nodeType === 3 ? event.target.parentElement : event.target
    if (rawTarget?.closest?.('.editor-inline-trigger, .editor-inline-chatbox, .editor-meta-table')) {
      return
    }

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    if (!selection || !selectedText || !selection.rangeCount) {
      return
    }

    const range = selection.getRangeAt(0)
    if (!updateSelectionTargetFromRange(range, selectedText)) {
      return
    }

    event.preventDefault()
  }

  function handleEditorMouseDown(event) {
    const rawTarget = event.target?.nodeType === 3 ? event.target.parentElement : event.target
    if (event.button === 2 || rawTarget?.closest?.('.editor-inline-trigger, .editor-inline-chatbox')) {
      return
    }

    clearSelectionTarget()
  }

  function getInlineChatboxStyle() {
    if (!paragraphTarget || !paperRef.current) {
      return undefined
    }

    const shellHeight = paperRef.current.clientHeight || 0
    const estimatedHeight = 520
    const top = Math.max(12, Math.min(paragraphTarget.top - 24, Math.max(12, shellHeight - estimatedHeight - 12)))
    return { top: `${top}px` }
  }

  function handleParagraphHover(event) {
    if (!paperRef.current) return

    if (paragraphTarget?.kind === 'selection') {
      return
    }

    const rawTarget = event.target?.nodeType === 3 ? event.target.parentElement : event.target
    if (rawTarget?.closest?.('.editor-inline-trigger, .editor-inline-chatbox')) {
      return
    }

    const contentRoot = paperRef.current.querySelector('.picdoc-body-content')
    let block = rawTarget?.closest?.(PARAGRAPH_SELECTOR) || null

    if (!block || !contentRoot?.contains(block)) {
      const blocks = [...(contentRoot?.querySelectorAll(PARAGRAPH_SELECTOR) || [])]
      block = blocks.reduce(
        (closest, item) => {
          const rect = item.getBoundingClientRect()
          const distance =
            event.clientY >= rect.top && event.clientY <= rect.bottom
              ? 0
              : Math.min(Math.abs(event.clientY - rect.top), Math.abs(event.clientY - rect.bottom))

          return !closest || distance < closest.distance ? { item, distance } : closest
        },
        null,
      )?.item
    }

    if (!block || !contentRoot?.contains(block)) {
      activeBlockRef.current = null
      setParagraphTarget(null)
      return
    }

    updateParagraphTargetFromBlock(block)
  }

  function buildInlineMessageContext(target = activeParagraph) {
    const text = String(target?.text || '').trim()
    const kind = target?.kind === 'selection' ? 'selection' : 'block'
    return {
      type: kind,
      label: kind === 'selection' ? '选中文本' : '当前段落',
      text,
      preview: previewParagraphText(text),
      postId: id || 'editor-draft',
      postTitle: title || '未命名草稿',
      signature: `${kind}:${text.slice(0, 180)}`,
    }
  }

  function getInlineAssistantSession() {
    const workspace = readAssistantWorkspace(editorAssistantWorkspaceId, inlineFallbackSession)
    const activeSession =
      workspace.sessions.find((session) => session.id === workspace.activeInlineSessionId) ||
      workspace.sessions.find((session) => session.id === workspace.activeSessionId) ||
      workspace.sessions[0] ||
      inlineFallbackSession
    return { workspace, activeSession }
  }

  function appendInlineMessagesToWorkspace({ userMessage, assistantMessage, conversationId, context }) {
    updateAssistantWorkspace(
      editorAssistantWorkspaceId,
      (workspace) => {
        const activeSession = workspace.sessions.find((session) => session.id === (inlineWorkspaceSessionId || workspace.activeSessionId)) || workspace.sessions[0] || inlineFallbackSession
        const sessionExists = workspace.sessions.some((session) => session.id === activeSession.id)
        const sessions = sessionExists ? workspace.sessions : [activeSession, ...workspace.sessions]

        return {
          ...workspace,
          open: workspace.open,
          activeSessionId: activeSession.id,
          activeInlineSessionId: activeSession.id,
          sessions: sessions.map((session) =>
            session.id === activeSession.id
              ? {
                  ...session,
                  providerConversationId: conversationId || session.providerConversationId || '',
                  updatedAt: Date.now(),
                  messages: [
                    ...session.messages,
                    { ...userMessage, context, origin: 'inline' },
                    { ...assistantMessage, context, origin: 'inline' },
                  ],
                }
              : session,
          ),
        }
      },
      inlineFallbackSession,
    )
  }

  function openParagraphAssistant() {
    if (!paragraphTarget) return
    const workspace = readAssistantWorkspace(editorAssistantWorkspaceId, inlineFallbackSession)
    const activeSession =
      workspace.sessions.find((session) => session.id === workspace.activeInlineSessionId) ||
      workspace.sessions.find((session) => session.id === workspace.activeSessionId) ||
      workspace.sessions[0] ||
      inlineFallbackSession
    const context = buildInlineMessageContext(paragraphTarget)
    const savedMessages = (activeSession.messages || []).filter((message) => message.origin === 'inline' && message.context?.signature === context.signature)

    setActiveParagraph(paragraphTarget)
    setInlineWorkspaceSessionId(activeSession.id)
    updateAssistantWorkspace(
      editorAssistantWorkspaceId,
      (current) => ({
        ...current,
        activeInlineSessionId: activeSession.id,
        sessions: current.sessions.some((session) => session.id === activeSession.id) ? current.sessions : [activeSession, ...current.sessions],
      }),
      inlineFallbackSession,
    )
    setRecognizedExpanded(false)
    setInlineConversationId(activeSession.providerConversationId || '')
    setInlineMessages(
      savedMessages.length
        ? savedMessages
        : [{ id: `assistant-ready-${Date.now()}`, role: 'assistant', text: '已识别上下文，可以开始提问或要求写入。', source: 'local' }],
    )
    setInlinePrompt('')
  }

  async function typeAssistantMessage(messageId, text) {
    const value = cleanAiEditorReply(text)
    const step = value.length > 240 ? 3 : 1

    for (let index = step; index <= value.length + step; index += step) {
      const partial = value.slice(0, Math.min(index, value.length))
      setInlineMessages((current) => current.map((message) => (message.id === messageId ? { ...message, text: partial } : message)))

      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 12))
    }
  }

  async function sendParagraphMessage() {
    if (!activeParagraph || !inlinePrompt.trim()) return

    setInlineAiBusy(true)
    const prompt = inlinePrompt.trim()
    const context = buildInlineMessageContext(activeParagraph)
    const { activeSession } = getInlineAssistantSession()
    setInlineWorkspaceSessionId(activeSession.id)
    const userMessage = createAssistantMessage({ role: 'user', text: prompt, source: 'ai', context, origin: 'inline' })
    const nextMessages = [...inlineMessages, userMessage]
    setInlineMessages(nextMessages)

    try {
      const response = await assistantChatRequest({
        query: prompt,
        selectedText: activeParagraph.text,
        currentPostId: id || '',
        sessionId: activeSession.id,
        conversationId: activeSession.providerConversationId || inlineConversationId,
        history: (activeSession.messages || []).slice(-8).map((item) => ({ role: item.role, text: item.text, source: item.source || 'ai' })),
      }, {
        requireAdmin: true,
      })

      const fallbackDecision = parseInlineAssistantDecision(response.text)
      const decision = {
        action: normalizeInlineDecisionAction(response.aiAction || fallbackDecision.action),
        content: cleanAiEditorReply(response.text || fallbackDecision.content),
        format: response.format === 'plain' ? 'plain' : 'markdown',
      }
      const shouldAutoWrite = decision.action === 'insert' || decision.action === 'replace'
      const assistantMessage = createAssistantMessage({
        role: 'assistant',
        text: '',
        source: 'ai',
        context,
        origin: 'inline',
        writeMode: shouldAutoWrite ? decision.action : '',
      })
      const assistantMessageId = assistantMessage.id
      setInlineConversationId(response.conversationId || inlineConversationId)
      setInlineMessages((current) => [
        ...current,
        assistantMessage,
      ])
      setInlinePrompt('')
      await typeAssistantMessage(assistantMessageId, decision.content)
      appendInlineMessagesToWorkspace({
        userMessage,
        assistantMessage: { ...assistantMessage, text: decision.content },
        conversationId: response.conversationId || activeSession.providerConversationId || inlineConversationId,
        context,
      })
      if (shouldAutoWrite) {
        if (response.canWrite === false) {
          setInlineMessages((current) => [
            ...current,
            {
              id: `assistant-write-denied-${Date.now()}`,
              role: 'assistant',
              text: '后端没有识别到管理员写入权限，所以这次只显示在 AI 对话框里。请刷新后台页面或重新登录后再试。',
            },
          ])
          return
        }

        const wrote = await typeTextIntoEditor(decision.content, decision.action, decision.format, prompt)
        if (!wrote) {
          setInlineMessages((current) => [
            ...current,
            {
              id: `assistant-write-failed-${Date.now()}`,
              role: 'assistant',
              text: 'AI 已生成内容，但前端没有定位到可写入的正文段落。可以点下方“插入到后面”手动写入，或重新点击正文左侧加号再发送。',
            },
          ])
        }
      }
    } catch (sendError) {
      const context = buildInlineMessageContext(activeParagraph)
      const errorMessage = createAssistantMessage({
        role: 'assistant',
        text: sendError.message || 'AI 暂时不可用',
        source: 'local',
        context,
        origin: 'inline',
      })
      setInlineMessages((current) => [
        ...current,
        errorMessage,
      ])
      appendInlineMessagesToWorkspace({
        userMessage,
        assistantMessage: errorMessage,
        conversationId: activeSession.providerConversationId || inlineConversationId,
        context,
      })
    } finally {
      setInlineAiBusy(false)
    }
  }

  async function handleSave(nextStatus = status) {
    const normalizedKeywords = keywords
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (!title.trim() || !htmlToPlainText(content)) {
      setError('标题和正文不能为空')
      return
    }

    const payload = {
      title,
      summary,
      content,
      attachments,
      coverImageUrl,
      status: nextStatus,
      keywords: normalizedKeywords,
      source: fileMeta ? 'import' : 'manual',
      file: fileMeta,
    }

    try {
      if (id) {
        await updatePost(id, payload)
        setStatus(nextStatus)
        setSuccessMessage(nextStatus === 'draft' ? '草稿保存成功' : '文章发布成功')
        if (nextStatus === 'published') {
          window.setTimeout(() => navigate('/admin', { replace: true }), 500)
        }
        return
      }

      const created = await createPost(payload)
      window.localStorage.removeItem(LOCAL_DRAFT_KEY)
      setStatus(nextStatus)
      setSuccessMessage(nextStatus === 'draft' ? '草稿保存成功' : '文章发布成功')
      if (nextStatus === 'draft') {
        navigate(`/admin/editor/${created.id}`, { replace: true })
      } else {
        window.setTimeout(() => navigate('/admin', { replace: true }), 500)
      }
    } catch (saveError) {
      setError(saveError.message || '保存失败')
    }
  }

  return (
    <div className="editor-page editor-reset-page">
      <section className="panel editor-panel editor-reset-panel">
        <div className="section-head left">
          <h1>{id ? '编辑文章' : '新建文章'}</h1>
          <span>{id ? '继续完善这篇文章' : '可直接写作，也可上传 PDF / DOCX 或附件'}</span>
        </div>

        <div className="editor-tools">
          <label className="button button-secondary upload-button">
            {importing ? '正在导入...' : '导入 PDF / DOCX'}
            <input type="file" accept=".pdf,.docx" onChange={handleImport} hidden />
          </label>
          <label className="button button-secondary upload-button">
            {uploadingAttachment ? '正在上传附件...' : '上传附件'}
            <input type="file" onChange={handleAttachmentUpload} hidden />
          </label>
          <label className="button button-secondary upload-button">
            {uploadingImage ? '正在上传图片...' : '上传封面图'}
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} hidden />
          </label>
          {!isPublishedPost ? (
            <button type="button" className="button button-secondary" onClick={() => handleSave('draft')} disabled={loading}>
              保存草稿
            </button>
          ) : null}
          <button type="button" className="button button-primary" onClick={() => handleSave('published')} disabled={loading}>
            {isPublishedPost ? '保存更新' : '发布文章'}
          </button>
        </div>

        <div className="editor-status-row">
          {autosaveMessage ? <span className="autosave-note">{autosaveMessage}</span> : <span></span>}
          {successMessage ? <span className="success-note">{successMessage}</span> : null}
        </div>

        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleEditorImageUpload} />

        {coverImageUrl ? (
          <div className="cover-preview">
            <img src={coverImageUrl} alt="文章封面" className="cover-preview-image" />
          </div>
        ) : null}

        {fileMeta ? (
          <div className="import-tip">
            已关联原始文件：
            <a href={fileMeta.fileUrl} target="_blank" rel="noreferrer">
              {fileMeta.originalFileName}
            </a>
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="attachment-list">
            {attachments.map((item) => (
              <div key={item.storedFileName} className="attachment-item">
                <span>{item.originalFileName}</span>
                <button type="button" className="text-button danger" onClick={() => handleRemoveAttachment(item.storedFileName)}>
                  移除
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="editor-form editor-reading-form editor-reset-form picdoc-editor-form">
          <section className="field field-wide picdoc-body-section">
            <div className="editor-toolbar editor-fix-toolbar" aria-label="写作工具栏">
              {toolbarItems.map((item) => (
                <button key={item.action} type="button" className="toolbar-button" onClick={() => applyToolbar(item.action)}>
                  {item.label}
                </button>
              ))}
            </div>

            <div
              className="rich-editor-shell editor-fix-shell editor-plus-shell picdoc-body-shell"
              ref={paperRef}
              onContextMenu={handleSelectionContextMenu}
              onMouseDown={handleEditorMouseDown}
              onMouseMove={handleParagraphHover}
              onMouseLeave={(event) => {
                if (event.relatedTarget?.closest?.('.editor-inline-trigger, .editor-inline-chatbox')) {
                  return
                }
                if (!activeParagraph && paragraphTarget?.kind !== 'selection') {
                  activeBlockRef.current = null
                  setParagraphTarget(null)
                }
              }}
            >
              {paragraphTarget ? (
                <>
                  <div
                    className={`editor-inline-outline${paragraphTarget.kind === 'selection' ? ' is-selection' : ''}`}
                    style={{
                      top: `${paragraphTarget.top}px`,
                      height: `${paragraphTarget.height}px`,
                      ...(paragraphTarget.kind === 'selection'
                        ? {
                            left: `${paragraphTarget.left}px`,
                            width: `${paragraphTarget.width}px`,
                            right: 'auto',
                          }
                        : {}),
                    }}
                  />
                  <button
                    type="button"
                    className={`editor-inline-trigger${activeParagraph ? ' is-active' : ''}`}
                    style={{
                      top: `${paragraphTarget.top + paragraphTarget.height / 2 - 14}px`,
                      ...(paragraphTarget.kind === 'selection' ? { left: `${Math.max(paragraphTarget.left - 40, -40)}px` } : {}),
                    }}
                    onClick={openParagraphAssistant}
                    aria-label={paragraphTarget.kind === 'selection' ? '打开选中文本 AI' : '打开当前段落 AI'}
                    title={paragraphTarget.kind === 'selection' ? '打开选中文本 AI' : '打开当前段落 AI'}
                  >
                    +
                  </button>
                </>
              ) : null}

              {activeParagraph ? (
                <aside className="editor-inline-chatbox" style={getInlineChatboxStyle()}>
                  <div className="editor-inline-menu-head">
                    <strong>AI</strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setActiveParagraph(null)
                        updateAssistantWorkspace(
                          editorAssistantWorkspaceId,
                          (current) => ({
                            ...current,
                            activeInlineSessionId: current.activeInlineSessionId === inlineWorkspaceSessionId ? '' : current.activeInlineSessionId,
                          }),
                          inlineFallbackSession,
                        )
                        clearSelectionTarget()
                      }}
                    >
                      关闭
                    </button>
                  </div>
                  <div className={`editor-inline-recognized${recognizedExpanded ? ' is-expanded' : ''}`}>
                    <div className="editor-inline-recognized-head">
                      <span>{activeParagraph.kind === 'selection' ? '选中文本' : '当前段落'}</span>
                      <button type="button" className="text-button" onClick={() => setRecognizedExpanded((value) => !value)}>
                        {recognizedExpanded ? '收起' : '展开'}
                      </button>
                    </div>
                    <p>{recognizedExpanded ? activeParagraph.text : previewParagraphText(activeParagraph.text)}</p>
                  </div>
                  <div className="editor-inline-chatlog">
                    {inlineMessages.map((message) => (
                      <article key={message.id} className={`editor-inline-bubble editor-inline-bubble-${message.role}`}>
                        <span>{message.text}</span>
                        {message.role === 'assistant' && message.source === 'ai' ? (
                          <div className="editor-inline-write-actions">
                            <button type="button" className="text-button" onClick={() => replaceActiveParagraphText(message.text)}>
                              替换当前段
                            </button>
                            <button type="button" className="text-button" onClick={() => insertTextAfterActiveParagraph(message.text)}>
                              插入到后面
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                  <label className="field">
                    <textarea rows="4" value={inlinePrompt} onChange={(event) => setInlinePrompt(event.target.value)} placeholder="问 AI：这段怎么改更好？" disabled={inlineAiBusy} />
                  </label>
                  <div className="editor-inline-submit-row">
                    <button type="button" className="button button-primary" onClick={sendParagraphMessage} disabled={inlineAiBusy || !inlinePrompt.trim()}>
                      发送
                    </button>
                  </div>
                </aside>
              ) : null}

              <div className="editor-meta-table">
                <label className="editor-meta-row editor-meta-title-row">
                  <span className="editor-meta-label">题目：</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={loading} />
                </label>

                <label className="editor-meta-row editor-meta-summary-row">
                  <span className="editor-meta-label">摘要：</span>
                  <textarea
                    ref={summaryInputRef}
                    rows="2"
                    value={summary}
                    onChange={(event) => {
                      setSummary(event.target.value)
                      scheduleSummaryResize(event.target)
                    }}
                    disabled={loading}
                  />
                </label>

                <label className="editor-meta-row editor-meta-keywords-row">
                  <span className="editor-meta-label">关键词：</span>
                  <input value={keywords} onChange={(event) => setKeywords(event.target.value)} disabled={loading} />
                </label>
              </div>

              <EditorContent editor={editor} />
            </div>
          </section>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <BlogAssistant posts={posts} currentPost={editorAssistantPost} suggestions={EDITOR_SUGGESTIONS} workspaceId={editorAssistantWorkspaceId} allowInlineSessionControl />
    </div>
  )
}

export default EditorPage
