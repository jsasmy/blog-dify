import cors from 'cors'
import Database from 'better-sqlite3'
import dotenv from 'dotenv'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import mammoth from 'mammoth'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import { postCatalog } from '../src/data/postCatalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(rootDir, '.env.production') })
const dataDir = path.join(rootDir, 'server', 'data')
const uploadsDir = path.join(rootDir, 'server', 'uploads')
const dbPath = path.join(dataDir, 'blog.db')
const distDir = path.join(rootDir, 'dist')

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(uploadsDir, { recursive: true })

const app = express()
const db = new Database(dbPath)
const port = process.env.PORT || 4000
const defaultAdminUsername = process.env.BLOG_ADMIN_USERNAME || 'admin'
const defaultAdminPassword = process.env.BLOG_ADMIN_PASSWORD || 'admin123'
const difyApiKey = process.env.DIFY_API_KEY || process.env.AI_API_KEY || ''
const difyBaseUrl = process.env.DIFY_BASE_URL || process.env.AI_BASE_URL || 'http://127.0.0.1'
const difyUserPrefix = process.env.DIFY_USER_PREFIX || 'blog-user'
const difyApiPath = process.env.DIFY_API_PATH || '/chat-messages'
const difyTimeoutMs = Number(process.env.DIFY_TIMEOUT_MS || 45000)
const difyRetryCount = Number(process.env.DIFY_RETRY_COUNT || 1)

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    html_preview TEXT,
    keywords_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    original_file_name TEXT,
    stored_file_name TEXT,
    file_mime_type TEXT,
    file_url TEXT,
    pdf_preview_json TEXT,
    attachments_json TEXT,
    cover_image_url TEXT
  )
`)

const postColumns = db.prepare('PRAGMA table_info(posts)').all()
if (!postColumns.some((column) => column.name === 'pdf_preview_json')) {
  db.exec('ALTER TABLE posts ADD COLUMN pdf_preview_json TEXT')
}
if (!postColumns.some((column) => column.name === 'attachments_json')) {
  db.exec('ALTER TABLE posts ADD COLUMN attachments_json TEXT')
}
if (!postColumns.some((column) => column.name === 'status')) {
  db.exec("ALTER TABLE posts ADD COLUMN status TEXT DEFAULT 'published'")
}
if (!postColumns.some((column) => column.name === 'cover_image_url')) {
  db.exec('ALTER TABLE posts ADD COLUMN cover_image_url TEXT')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    blog_name TEXT NOT NULL,
    blog_mark TEXT NOT NULL,
    blog_description TEXT NOT NULL,
    home_title TEXT NOT NULL,
    home_intro TEXT NOT NULL
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )
`)

const countRow = db.prepare('SELECT COUNT(*) AS count FROM posts').get()

if (countRow.count === 0) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO posts (
      id, slug, title, summary, content, html_preview, keywords_json,
      created_at, updated_at, clicks, source, original_file_name,
      stored_file_name, file_mime_type, file_url, pdf_preview_json, attachments_json, status, cover_image_url
    ) VALUES (
      @id, @slug, @title, @summary, @content, @htmlPreview, @keywordsJson,
      @createdAt, @updatedAt, @clicks, @source, @originalFileName,
      @storedFileName, @fileMimeType, @fileUrl, @pdfPreviewJson, @attachmentsJson, @status, @coverImageUrl
    )
  `).run({
    id: crypto.randomUUID(),
    slug: '欢迎使用简博客',
    title: '欢迎使用简博客',
    summary: '这是一个支持后台同步、文档导入和中文搜索排序的博客系统。',
    content: '## 开始使用\n\n你可以直接新建文章，也可以导入 PDF 或 DOCX 文档。',
    htmlPreview: '',
    keywordsJson: JSON.stringify(['博客', '入门', '同步']),
    createdAt: now,
    updatedAt: now,
    clicks: 1,
    source: 'manual',
    originalFileName: null,
    storedFileName: null,
    fileMimeType: null,
    fileUrl: null,
    pdfPreviewJson: JSON.stringify([]),
    attachmentsJson: JSON.stringify([]),
    status: 'published',
    coverImageUrl: null,
  })
}

const settingsRow = db.prepare('SELECT COUNT(*) AS count FROM site_settings').get()

if (settingsRow.count === 0) {
  db.prepare(`
    INSERT INTO site_settings (id, blog_name, blog_mark, blog_description, home_title, home_intro)
    VALUES (1, @blogName, @blogMark, @blogDescription, @homeTitle, @homeIntro)
  `).run({
    blogName: '简博客',
    blogMark: '简',
    blogDescription: '记录想法、经验与长期写作',
    homeTitle: '欢迎来到我的博客',
    homeIntro: '这里展示我发布的文章，支持按标题或关键词搜索，也可以按时间和阅读热度排序。',
  })
}

const adminRow = db.prepare('SELECT COUNT(*) AS count FROM admin_users').get()

if (adminRow.count === 0) {
  db.prepare(`
    INSERT INTO admin_users (id, username, password_hash)
    VALUES (1, @username, @passwordHash)
  `).run({
    username: defaultAdminUsername,
    passwordHash: crypto.createHash('sha256').update(defaultAdminPassword).digest('hex'),
  })
}

syncStaticPostsToDatabase()

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      callback(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`)
    },
  }),
})

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/uploads/:fileName', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.fileName)

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ message: '文件不存在' })
    return
  }

  const post = db.prepare('SELECT * FROM posts').all().map(rowToPost).find((item) => {
    if (item.storedFileName === req.params.fileName) {
      return true
    }

    return (item.attachments || []).some((attachment) => attachment.storedFileName === req.params.fileName)
  })

  const matchedAttachment = post?.attachments?.find((attachment) => attachment.storedFileName === req.params.fileName)
  const downloadName = matchedAttachment?.originalFileName || post?.originalFileName || req.params.fileName
  const encodedName = encodeURIComponent(downloadName)

  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedName}`)
  res.sendFile(filePath)
})

function rowToPost(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: row.content,
    htmlPreview: row.html_preview,
    keywords: JSON.parse(row.keywords_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clicks: row.clicks,
    source: row.source,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name,
    fileMimeType: row.file_mime_type,
    fileUrl: row.file_url,
    pdfPreviewImages: JSON.parse(row.pdf_preview_json || '[]'),
    attachments: JSON.parse(row.attachments_json || '[]'),
    status: row.status || 'published',
    coverImageUrl: row.cover_image_url || '',
  }
}

function getSiteSettings() {
  return db.prepare('SELECT * FROM site_settings WHERE id = 1').get()
}

function getAdminUser() {
  return db.prepare('SELECT * FROM admin_users WHERE id = 1').get()
}

function getAdminToken() {
  const user = getAdminUser()
  return crypto.createHash('sha256').update(`${user.username}:${user.password_hash}`).digest('hex')
}

function slugify(text) {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')

  return normalized || `article-${Date.now()}`
}

function extractKeywords(text) {
  const words = text
    .replace(/[\r\n]/g, ' ')
    .split(/[\s，。、“”‘’；：！？,.!?:;()（）【】[]"']+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  return [...new Set(words)].slice(0, 6)
}

function extractTitle(text, fallback) {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean)

  return (firstLine || fallback || '未命名文章').slice(0, 80)
}

function extractSummary(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 120) || '暂无摘要'
}

function textToMarkdown(text) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
    .filter(Boolean)

  return paragraphs.map((paragraph, index) => (index === 0 ? `## ${paragraph}` : paragraph)).join('\n\n')
}

function cleanupPdfText(text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const merged = []

  for (const line of lines) {
    if (/^\d+$/.test(line)) {
      continue
    }

    const prev = merged[merged.length - 1]
    if (prev && !/[。！？：；]$/.test(prev) && line.length < 28) {
      merged[merged.length - 1] = `${prev}${line}`
      continue
    }

    merged.push(line)
  }

  return merged.join('\n\n')
}

async function convertDocx(filePath) {
  const buffer = fs.readFileSync(filePath)
  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.inline(async (image) => ({
        src: `data:${image.contentType};base64,${await image.read('base64')}`,
      })),
    },
  )
  const textResult = await mammoth.extractRawText({ buffer })
  return {
    htmlPreview: htmlResult.value,
    text: textResult.value,
  }
}

async function convertPdf(filePath) {
  const buffer = fs.readFileSync(filePath)
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  const screenshots = await parser.getScreenshot({ imageDataUrl: false, imageBuffer: true })
  await parser.destroy()

  const previewImages = (screenshots.pages || []).map((page, index) => {
    const previewFileName = `${path.basename(filePath, path.extname(filePath))}-page-${index + 1}.png`
    const previewPath = path.join(uploadsDir, previewFileName)
    fs.writeFileSync(previewPath, page.data)
    return `/uploads/${previewFileName}`
  })

  return {
    htmlPreview: '',
    text: cleanupPdfText(result.text),
    pdfPreviewImages: previewImages,
  }
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token']

  if (token !== getAdminToken()) {
    res.status(401).json({ message: '没有管理权限，请先登录后台' })
    return
  }

  next()
}

async function parseImportedFile(file) {
  const lowerName = file.originalname.toLowerCase()
  let converted

  if (lowerName.endsWith('.docx')) {
    converted = await convertDocx(file.path)
  } else if (lowerName.endsWith('.pdf')) {
    converted = await convertPdf(file.path)
  } else {
    throw new Error('仅支持 PDF 或 DOCX 文件')
  }

  const text = converted.text.replace(/\r/g, '').trim()
  return {
    title: extractTitle(text, file.originalname.replace(/\.(pdf|docx)$/i, '')),
    summary: extractSummary(text),
    content: textToMarkdown(text),
    htmlPreview: converted.htmlPreview,
    pdfPreviewImages: converted.pdfPreviewImages || [],
    keywords: extractKeywords(text),
    file: {
      originalFileName: file.originalname,
      storedFileName: path.basename(file.path),
      mimeType: file.mimetype,
      fileUrl: `/uploads/${path.basename(file.path)}`,
    },
  }
}

function buildOrder(sort) {
  switch (sort) {
    case 'time-asc':
      return 'created_at ASC'
    case 'click-desc':
      return 'clicks DESC, created_at DESC'
    case 'click-asc':
      return 'clicks ASC, created_at DESC'
    default:
      return 'created_at DESC'
  }
}

const ASSISTANT_STOP_WORDS = new Set([
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

const ASSISTANT_QUERY_ALIASES = {
  写作: ['writing', 'workflow', 'notes'],
  博客: ['blogging', 'publishing', 'design'],
  设计: ['design', 'ui', 'editorial'],
  研究: ['research', 'notes'],
  笔记: ['notes', 'research', 'knowledge'],
  整理: ['workflow', 'knowledge', 'notes'],
  工作流: ['workflow', 'notes'],
  知识: ['knowledge', 'research', 'notes'],
  发布: ['publishing', 'blogging'],
 }

function isAiConfigured() {
  return Boolean(difyApiKey)
}

function normalizeDifyBaseUrl(value) {
  const base = String(value || '').trim()

  if (!base) {
    return 'http://127.0.0.1/v1'
  }

  return base.replace(/\/+$/, '').endsWith('/v1') ? base.replace(/\/+$/, '') : `${base.replace(/\/+$/, '')}/v1`
}

function isRetryableDifyStatus(status) {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function cleanAssistantAnswerText(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function extractAssistantJsonCandidate(text) {
  const value = cleanAssistantAnswerText(text)
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1)
  }

  return value
}

function normalizeAssistantAction(action) {
  const value = String(action || '').trim().toLowerCase()
  if (['insert', 'append', 'write', 'add'].includes(value)) return 'insert'
  if (['replace', 'rewrite', 'update'].includes(value)) return 'replace'
  return 'reply'
}

function normalizeAssistantFormat(format) {
  return String(format || '').trim().toLowerCase() === 'plain' ? 'plain' : 'markdown'
}

function normalizeAssistantArticleRefs(value) {
  if (!value) {
    return []
  }

  const items = Array.isArray(value) ? value : [value]
  return items
    .flatMap((item) => {
      if (typeof item === 'string') {
        return [{ title: item, id: item }]
      }
      if (item && typeof item === 'object') {
        return [
          {
            id: String(item.id || item.postId || item.articleId || '').trim(),
            title: String(item.title || item.name || '').trim(),
          },
        ]
      }
      return []
    })
    .filter((item) => item.id || item.title)
}

function parseAssistantStructuredReply(rawText, { isAdmin = false } = {}) {
  const cleanedText = cleanAssistantAnswerText(rawText)
  const fallback = {
    text: cleanedText,
    aiAction: 'reply',
    format: 'markdown',
    parsed: false,
  }

  if (!cleanedText) {
    return fallback
  }

  try {
    const parsed = JSON.parse(extractAssistantJsonCandidate(cleanedText))
    const text = String(parsed?.content || parsed?.text || parsed?.answer || '').trim()
    let aiAction = normalizeAssistantAction(parsed?.action)

    if (!isAdmin && aiAction !== 'reply') {
      aiAction = 'reply'
    }

    return {
      text: text || cleanedText,
      aiAction,
      format: normalizeAssistantFormat(parsed?.format),
      articleRefs: normalizeAssistantArticleRefs(parsed?.openArticles || parsed?.articleIds || parsed?.articleTitles || parsed?.articles),
      parsed: true,
    }
  } catch {
    return fallback
  }
}

function tokenizeAssistantQuery(query) {
  const normalized = String(query || '').toLowerCase().trim()

  if (!normalized) {
    return []
  }

  const chunks = normalized
    .split(/[\s，。、“”‘’；：！？,.!?:;()（）【】/\\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !ASSISTANT_STOP_WORDS.has(item))

  const expanded = chunks.flatMap((item) => {
    const aliases = Object.entries(ASSISTANT_QUERY_ALIASES)
      .filter(([key]) => item.includes(key))
      .flatMap(([, values]) => values)

    return [item, ...aliases]
  })

  return [...new Set([normalized, ...chunks, ...expanded])]
}

function scoreAssistantPost(post, tokens) {
  if (!tokens.length) {
    return 0
  }

  const title = String(post.title || '').toLowerCase()
  const summary = String(post.summary || '').toLowerCase()
  const content = stripMarkup(post.content).toLowerCase()
  const keywords = (post.keywords || []).join(' ').toLowerCase()
  let score = 0

  for (const token of tokens) {
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
  }

  return score
}

function pickAssistantRecommendations(posts, query, currentPost) {
  const normalized = String(query || '').trim()
  const askHot = /(热门|点击|阅读量|最受欢迎|高阅读)/.test(normalized)
  const askLatest = /(最新|最近|刚发布|近期)/.test(normalized)
  const askSimilar = /(相似|类似|同类|延伸|相关文章)/.test(normalized)
  const askOverview = /(全部|所有|整站|全站).*(文章|博客|内容).*(总结|概括|提炼|列举|大意|含义)|总结目前所有文章|列举所有文章/.test(normalized)
  const askBlogOverview = /(博客|网站).*(介绍|概览|大体|整体)|快速了解这个博客/.test(normalized)

  if (askOverview || askBlogOverview) {
    return [...posts]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12)
  }

  if (askHot) {
    return [...posts].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 4)
  }

  if (askLatest) {
    return [...posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4)
  }

  if (currentPost && askSimilar) {
    const currentKeywords = currentPost.keywords || []
    return posts
      .filter((post) => post.id !== currentPost.id)
      .map((post) => ({ post, score: scoreAssistantPost(post, currentKeywords) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((item) => item.post)
  }

  const tokens = tokenizeAssistantQuery(normalized)
  return posts
    .map((post) => ({ post, score: scoreAssistantPost(post, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.post.createdAt) - new Date(a.post.createdAt))
    .slice(0, 4)
    .map((item) => item.post)
}

function pickAssistantArticlesByRefs(posts, refs) {
  if (!Array.isArray(refs) || !refs.length) {
    return []
  }

  const normalizedPosts = posts.map((post) => ({
    post,
    id: String(post.id || '').toLowerCase(),
    title: String(post.title || '').toLowerCase(),
  }))
  const seen = new Set()

  return refs
    .flatMap((ref) => {
      const id = String(ref.id || '').toLowerCase()
      const title = String(ref.title || '').toLowerCase()
      const matched =
        normalizedPosts.find((item) => id && item.id === id)?.post ||
        normalizedPosts.find((item) => title && item.title === title)?.post ||
        normalizedPosts.find((item) => title && item.title.includes(title))?.post ||
        normalizedPosts.find((item) => title && title.includes(item.title))?.post

      return matched ? [matched] : []
    })
    .filter((post) => {
      if (seen.has(post.id)) {
        return false
      }
      seen.add(post.id)
      return true
    })
    .slice(0, 8)
}

function pickAssistantArticlesFromText(posts, text) {
  const value = String(text || '').toLowerCase()
  if (!value) {
    return []
  }

  return posts
    .filter((post) => {
      const title = String(post.title || '').toLowerCase()
      return title && value.includes(title)
    })
    .slice(0, 8)
}

function buildAssistantContext(post) {
  return {
    id: post.id,
    title: post.title,
    summary: post.summary,
    keywords: post.keywords || [],
    createdAt: post.createdAt,
    clicks: post.clicks || 0,
    excerpt: stripMarkup(post.content).slice(0, 1800),
  }
}

function createStaticPostRecord(catalogPost, index) {
  const contentPath = path.join(rootDir, 'src', 'content', `${catalogPost.slug}.md`)
  const content = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : ''

  return {
    id: `static-${catalogPost.slug}`,
    slug: catalogPost.slug,
    title: catalogPost.title,
    summary: catalogPost.excerpt,
    content,
    htmlPreview: '',
    keywords: catalogPost.tags || [],
    createdAt: new Date(`${catalogPost.publishedAt}T00:00:00.000Z`).toISOString(),
    updatedAt: new Date(`${catalogPost.publishedAt}T00:00:00.000Z`).toISOString(),
    clicks: Math.max(0, 100 - index),
    source: 'seed',
    originalFileName: null,
    storedFileName: null,
    fileMimeType: null,
    fileUrl: null,
    pdfPreviewImages: [],
    attachments: [],
    status: 'published',
    coverImageUrl: '',
  }
}

function syncStaticPostsToDatabase() {
  const findBySlug = db.prepare('SELECT * FROM posts WHERE slug = ? LIMIT 1')
  const insertPost = db.prepare(`
    INSERT INTO posts (
      id, slug, title, summary, content, html_preview, keywords_json,
      created_at, updated_at, clicks, source, original_file_name,
      stored_file_name, file_mime_type, file_url, pdf_preview_json, attachments_json, status, cover_image_url
    ) VALUES (
      @id, @slug, @title, @summary, @content, @htmlPreview, @keywordsJson,
      @createdAt, @updatedAt, @clicks, @source, @originalFileName,
      @storedFileName, @fileMimeType, @fileUrl, @pdfPreviewJson, @attachmentsJson, @status, @coverImageUrl
    )
  `)
  const updateSeedPost = db.prepare(`
    UPDATE posts SET
      title = @title,
      summary = @summary,
      content = @content,
      html_preview = @htmlPreview,
      keywords_json = @keywordsJson,
      updated_at = @updatedAt,
      clicks = @clicks,
      status = @status,
      cover_image_url = @coverImageUrl
    WHERE slug = @slug
  `)

  postCatalog.forEach((catalogPost, index) => {
    const record = createStaticPostRecord(catalogPost, index)
    const existing = findBySlug.get(record.slug)

    if (!existing) {
      insertPost.run({
        id: record.id,
        slug: record.slug,
        title: record.title,
        summary: record.summary,
        content: record.content,
        htmlPreview: record.htmlPreview,
        keywordsJson: JSON.stringify(record.keywords),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        clicks: record.clicks,
        source: record.source,
        originalFileName: record.originalFileName,
        storedFileName: record.storedFileName,
        fileMimeType: record.fileMimeType,
        fileUrl: record.fileUrl,
        pdfPreviewJson: JSON.stringify(record.pdfPreviewImages),
        attachmentsJson: JSON.stringify(record.attachments),
        status: record.status,
        coverImageUrl: record.coverImageUrl,
      })
      return
    }

    if (existing.source === 'seed') {
      updateSeedPost.run({
        slug: record.slug,
        title: record.title,
        summary: record.summary,
        content: record.content,
        htmlPreview: record.htmlPreview,
        keywordsJson: JSON.stringify(record.keywords),
        updatedAt: new Date().toISOString(),
        clicks: existing.clicks,
        status: 'published',
        coverImageUrl: record.coverImageUrl,
      })
    }
  })
}

function normalizeAssistantHistory(history) {
  if (!Array.isArray(history)) {
    return []
  }

  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .slice(-8)
    .map((item) => ({
      role: item.role,
      text: String(item.text || '').trim(),
      source: item.source === 'ai' ? 'ai' : 'local',
    }))
    .filter((item) => item.text)
}

async function generateAssistantReplyWithHistory({
  query,
  currentPost,
  recommendations,
  history,
  conversationId,
  sessionId,
  selectedText = '',
  isAdmin = false,
}) {
  if (!isAiConfigured()) {
    throw new Error('AI assistant is not configured')
  }

  const payload = {
    userQuestion: query,
    conversationHistory: normalizeAssistantHistory(history),
    isAdmin: Boolean(isAdmin),
    currentPost: currentPost ? buildAssistantContext(currentPost) : null,
    selectedText: String(selectedText || '').trim().slice(0, 4000) || null,
    recommendedPosts: recommendations.map(buildAssistantContext),
    allPublishedPosts: listPublicPosts('', 'time-desc').slice(0, 20).map((post) => ({
      id: post.id,
      title: post.title,
      summary: post.summary,
      keywords: post.keywords || [],
    })),
    openableArticles: listPublicPosts('', 'time-desc').slice(0, 30).map((post) => ({
      id: post.id,
      title: post.title,
      summary: post.summary,
      keywords: post.keywords || [],
    })),
  }

  const endpoint = `${normalizeDifyBaseUrl(difyBaseUrl)}${difyApiPath.startsWith('/') ? difyApiPath : `/${difyApiPath}`}`
  const requestBody = {
    inputs: {
      blog_context: JSON.stringify(payload, null, 2),
      context: query,
      query,
      selectedText: payload.selectedText || '',
      IsAdmin: Boolean(isAdmin) ? 'true' : 'false',
    },
    query,
    response_mode: 'blocking',
    conversation_id: conversationId || undefined,
    user: `${difyUserPrefix}-${sessionId || 'default'}`,
    files: [],
  }

  let response = null
  let rawText = ''
  let data = null
  let lastError = null

  for (let attempt = 0; attempt <= difyRetryCount; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), difyTimeoutMs)

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${difyApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      rawText = await response.text()
      data = null

      if (rawText) {
        try {
          data = JSON.parse(rawText)
        } catch {
          data = null
        }
      }

      if (response.ok) {
        lastError = null
        break
      }

      const providerMessage =
        data?.message ||
        data?.error ||
        data?.error?.message ||
        rawText ||
        `Dify 请求失败，状态码 ${response.status}`

      lastError = new Error(providerMessage)

      if (!isRetryableDifyStatus(response.status) || attempt === difyRetryCount) {
        throw lastError
      }

      await sleep(800 * (attempt + 1))
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('Dify 请求超时，请稍后重试') : error

      if (attempt === difyRetryCount) {
        throw lastError
      }

      await sleep(800 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }

  if (lastError) {
    throw lastError
  }

  const text = data?.answer

  if (!text) {
    throw new Error('Dify 没有返回可用内容')
  }

  const structuredReply = parseAssistantStructuredReply(text, { isAdmin })

  return {
    text: structuredReply.text,
    aiAction: structuredReply.aiAction,
    format: structuredReply.format,
    articleRefs: structuredReply.articleRefs || [],
    structured: structuredReply.parsed,
    conversationId: String(data?.conversation_id || conversationId || '').trim(),
  }
}

function listPosts(search = '', sort = 'time-desc') {
  const orderBy = buildOrder(sort)
  const trimmed = search.trim()

  if (!trimmed) {
    return db.prepare(`SELECT * FROM posts ORDER BY ${orderBy}`).all().map(rowToPost)
  }

  const like = `%${trimmed}%`
  return db
    .prepare(
      `SELECT * FROM posts
       WHERE title LIKE @like OR summary LIKE @like OR keywords_json LIKE @like
       ORDER BY ${orderBy}`,
    )
    .all({ like })
    .map(rowToPost)
}

function listPublicPosts(search = '', sort = 'time-desc') {
  const mergedPosts = listPosts('', sort).filter((post) => post.status !== 'draft')

  if (!search.trim()) {
    return mergedPosts
  }

  const like = search.trim().toLowerCase()
  return mergedPosts.filter((post) => {
    const title = String(post.title || '').toLowerCase()
    const summary = String(post.summary || '').toLowerCase()
    const keywords = (post.keywords || []).join(' ').toLowerCase()
    const content = stripMarkup(post.content).toLowerCase()
    return title.includes(like) || summary.includes(like) || keywords.includes(like) || content.includes(like)
  })
}

function getPost(id) {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)

  if (row) {
    return rowToPost(row)
  }

  return null
}

function isAdminRequest(req) {
  return req.headers['x-admin-token'] === getAdminToken()
}

function saveUploadedFile(file) {
  return {
    originalFileName: file.originalname,
    storedFileName: path.basename(file.path),
    mimeType: file.mimetype,
    fileUrl: `/uploads/${path.basename(file.path)}`,
  }
}

app.get('/api/site-settings', (_req, res) => {
  res.json(getSiteSettings())
})

app.put('/api/site-settings', requireAdmin, (req, res) => {
  const {
    blogName = '简博客',
    blogMark = '简',
    blogDescription = '',
    homeTitle = '欢迎来到我的博客',
    homeIntro = '',
  } = req.body ?? {}

  db.prepare(`
    UPDATE site_settings SET
      blog_name = @blogName,
      blog_mark = @blogMark,
      blog_description = @blogDescription,
      home_title = @homeTitle,
      home_intro = @homeIntro
    WHERE id = 1
  `).run({
    blogName: blogName.trim() || '简博客',
    blogMark: blogMark.trim().slice(0, 2) || '简',
    blogDescription: blogDescription.trim(),
    homeTitle: homeTitle.trim() || '欢迎来到我的博客',
    homeIntro: homeIntro.trim(),
  })

  res.json(getSiteSettings())
})

app.get('/api/posts', (req, res) => {
  const { search = '', sort = 'time-desc' } = req.query
  const data = isAdminRequest(req)
    ? listPosts(String(search), String(sort))
    : listPublicPosts(String(search), String(sort))
  res.json(data)
})

app.get('/api/posts/:id', (req, res) => {
  const post = getPost(req.params.id)

  if (!post || (post.status === 'draft' && !isAdminRequest(req))) {
    res.status(404).json({ message: '文章不存在' })
    return
  }

  res.json(post)
})

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body ?? {}
  const adminUser = getAdminUser()
  const passwordHash = crypto.createHash('sha256').update(password || '').digest('hex')

  if (username !== adminUser.username || passwordHash !== adminUser.password_hash) {
    res.status(401).json({ message: '账号或密码错误' })
    return
  }

  res.json({ token: getAdminToken(), username: adminUser.username })
})

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  const adminUser = getAdminUser()
  res.json({ username: adminUser.username })
})

app.post('/api/posts/:id/click', (req, res) => {
  const post = getPost(req.params.id)

  if (!post) {
    res.status(404).json({ message: '文章不存在' })
    return
  }

  db.prepare('UPDATE posts SET clicks = clicks + 1 WHERE id = ?').run(req.params.id)
  res.json(getPost(req.params.id))
})

app.post('/api/assistant/chat', async (req, res) => {
  const { query = '', currentPostId = '', selectedText = '', history = [], conversationId = '', sessionId = '' } = req.body ?? {}
  const normalizedQuery = String(query).trim()
  const isAdmin = isAdminRequest(req)

  if (!normalizedQuery) {
    res.status(400).json({ message: '请输入问题后再发送' })
    return
  }

  if (!isAiConfigured()) {
    res.status(503).json({ message: 'AI 助手暂未配置，请先设置 AI_API_KEY' })
    return
  }

  try {
    const posts = listPublicPosts('', 'time-desc')
    const currentPost = currentPostId ? posts.find((post) => post.id === currentPostId) || null : null
    const recommendations = pickAssistantRecommendations(posts, normalizedQuery, currentPost)
    const result = await generateAssistantReplyWithHistory({
      query: normalizedQuery,
      currentPost,
      recommendations,
      history,
      conversationId: String(conversationId || ''),
      sessionId: String(sessionId || ''),
      selectedText,
      isAdmin,
    })
    const aiSelectedArticles = pickAssistantArticlesByRefs(posts, result.articleRefs)
    const mentionedArticles = aiSelectedArticles.length ? [] : pickAssistantArticlesFromText(posts, result.text)
    const responseRecommendations = aiSelectedArticles.length ? aiSelectedArticles : mentionedArticles

    res.json({
      text: result.text,
      aiAction: result.aiAction,
      format: result.format,
      recommendations: responseRecommendations,
      articleChannel: responseRecommendations.length > 0,
      aiEnabled: true,
      provider: 'dify',
      structured: result.structured,
      canWrite: isAdmin,
      conversationId: result.conversationId,
    })
  } catch (error) {
    console.error('Assistant chat failed:', error)
    res.status(500).json({ message: error.message || 'AI 助手暂时不可用' })
  }
})

app.post('/api/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: '请上传文件' })
      return
    }

    const result = await parseImportedFile(req.file)
    res.json(result)
  } catch (error) {
    res.status(400).json({ message: error.message || '导入失败' })
  }
})

app.post('/api/upload/pdf-source', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: '请上传 PDF 文件' })
      return
    }

    if (!req.file.originalname.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ message: '这里只支持上传 PDF 原文件' })
      return
    }

    const converted = await convertPdf(req.file.path)

    res.json({
      file: saveUploadedFile(req.file),
      pdfPreviewImages: converted.pdfPreviewImages || [],
    })
  } catch (error) {
    res.status(400).json({ message: error.message || 'PDF 上传失败' })
  }
})

app.post('/api/upload/attachment', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: '请先选择文件' })
    return
  }

  res.json(saveUploadedFile(req.file))
})

app.post('/api/upload/image', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: '请先选择图片文件' })
    return
  }

  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ message: '这里只支持上传图片' })
    return
  }

  res.json(saveUploadedFile(req.file))
})

app.post('/api/posts', requireAdmin, (req, res) => {
  const now = new Date().toISOString()
  const {
    title,
    summary,
    content,
    htmlPreview = '',
    pdfPreviewImages = [],
    attachments = [],
    status = 'published',
    coverImageUrl = '',
    keywords = [],
    source = 'manual',
    file,
  } = req.body

  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ message: '标题和正文不能为空' })
    return
  }

  const id = crypto.randomUUID()

  db.prepare(`
    INSERT INTO posts (
      id, slug, title, summary, content, html_preview, keywords_json,
      created_at, updated_at, clicks, source, original_file_name,
      stored_file_name, file_mime_type, file_url, pdf_preview_json, attachments_json, status, cover_image_url
    ) VALUES (
      @id, @slug, @title, @summary, @content, @htmlPreview, @keywordsJson,
      @createdAt, @updatedAt, 0, @source, @originalFileName,
      @storedFileName, @fileMimeType, @fileUrl, @pdfPreviewJson, @attachmentsJson, @status, @coverImageUrl
    )
  `).run({
    id,
    slug: slugify(title),
    title: title.trim(),
    summary: (summary || extractSummary(content)).trim(),
    content,
    htmlPreview,
    keywordsJson: JSON.stringify(keywords),
    createdAt: now,
    updatedAt: now,
    source,
    originalFileName: file?.originalFileName || null,
    storedFileName: file?.storedFileName || null,
    fileMimeType: file?.mimeType || null,
    fileUrl: file?.fileUrl || null,
    pdfPreviewJson: JSON.stringify(pdfPreviewImages),
    attachmentsJson: JSON.stringify(attachments),
    status,
    coverImageUrl,
  })

  res.status(201).json(getPost(id))
})

app.put('/api/posts/:id', requireAdmin, (req, res) => {
  const existing = getPost(req.params.id)

  if (!existing) {
    res.status(404).json({ message: '文章不存在' })
    return
  }

  const {
    title,
    summary,
    content,
    htmlPreview = '',
    pdfPreviewImages = existing.pdfPreviewImages || [],
    attachments = existing.attachments || [],
    status = existing.status || 'published',
    coverImageUrl = existing.coverImageUrl || '',
    keywords = [],
    source = existing.source,
    file,
  } = req.body

  const keptAttachmentNames = new Set(attachments.map((item) => item.storedFileName))
  for (const attachment of existing.attachments || []) {
    if (attachment.storedFileName && !keptAttachmentNames.has(attachment.storedFileName)) {
      const attachmentPath = path.join(uploadsDir, attachment.storedFileName)
      if (fs.existsSync(attachmentPath)) {
        fs.unlinkSync(attachmentPath)
      }
    }
  }

  db.prepare(`
    UPDATE posts SET
      slug = @slug,
      title = @title,
      summary = @summary,
      content = @content,
      html_preview = @htmlPreview,
      keywords_json = @keywordsJson,
      updated_at = @updatedAt,
      source = @source,
      original_file_name = @originalFileName,
      stored_file_name = @storedFileName,
      file_mime_type = @fileMimeType,
      file_url = @fileUrl,
      pdf_preview_json = @pdfPreviewJson,
      attachments_json = @attachmentsJson,
      status = @status,
      cover_image_url = @coverImageUrl
    WHERE id = @id
  `).run({
    id: req.params.id,
    slug: slugify(title),
    title: title.trim(),
    summary: (summary || extractSummary(content)).trim(),
    content,
    htmlPreview,
    keywordsJson: JSON.stringify(keywords),
    updatedAt: new Date().toISOString(),
    source,
    originalFileName: file?.originalFileName || null,
    storedFileName: file?.storedFileName || null,
    fileMimeType: file?.mimeType || null,
    fileUrl: file?.fileUrl || null,
    pdfPreviewJson: JSON.stringify(pdfPreviewImages),
    attachmentsJson: JSON.stringify(attachments),
    status,
    coverImageUrl,
  })

  res.json(getPost(req.params.id))
})

app.delete('/api/posts/:id', requireAdmin, (req, res) => {
  const existing = getPost(req.params.id)

  if (!existing) {
    res.status(404).json({ message: '文章不存在' })
    return
  }

  if (existing.storedFileName) {
    const filePath = path.join(uploadsDir, existing.storedFileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  for (const previewUrl of existing.pdfPreviewImages || []) {
    const previewFilePath = path.join(rootDir, previewUrl.replace(/^\//, ''))
    if (fs.existsSync(previewFilePath)) {
      fs.unlinkSync(previewFilePath)
    }
  }

  for (const attachment of existing.attachments || []) {
    if (attachment.storedFileName) {
      const attachmentPath = path.join(uploadsDir, attachment.storedFileName)
      if (fs.existsSync(attachmentPath)) {
        fs.unlinkSync(attachmentPath)
      }
    }
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))

  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next()
      return
    }

    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Blog server running at http://localhost:${port}`)
})
