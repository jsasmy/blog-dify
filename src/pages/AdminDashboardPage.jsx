import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBlog } from '../context/BlogContext.jsx'
import { useAdmin } from '../context/AdminContext.jsx'
import { useSite } from '../context/SiteContext.jsx'
import { formatDate } from '../utils/formatDate.js'

const sortOptions = [
  { value: 'time-desc', label: '时间降序' },
  { value: 'time-asc', label: '时间升序' },
  { value: 'click-desc', label: '点击量降序' },
  { value: 'click-asc', label: '点击量升序' },
]

const POSTS_PER_PAGE = 6

function AdminDashboardPage() {
  const { posts, loading, listPosts, deletePost } = useBlog()
  const { logout } = useAdmin()
  const { settings, fetchSettings, updateSettings } = useSite()
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState('time-desc')
  const [blogName, setBlogName] = useState('')
  const [blogMark, setBlogMark] = useState('')
  const [blogDescription, setBlogDescription] = useState('')
  const [homeTitle, setHomeTitle] = useState('')
  const [homeIntro, setHomeIntro] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [actionError, setActionError] = useState('')
  const [draftOpen, setDraftOpen] = useState(true)
  const [publishedOpen, setPublishedOpen] = useState(true)
  const [draftPage, setDraftPage] = useState(1)
  const [publishedPage, setPublishedPage] = useState(1)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    setBlogName(settings.blog_name || '')
    setBlogMark(settings.blog_mark || '')
    setBlogDescription(settings.blog_description || '')
    setHomeTitle(settings.home_title || '')
    setHomeIntro(settings.home_intro || '')
  }, [settings])

  useEffect(() => {
    listPosts({ sort: sortBy, admin: true })
  }, [listPosts, sortBy])

  useEffect(() => {
    const handleFocus = () => {
      listPosts({ sort: sortBy, admin: true })
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [listPosts, sortBy])

  const filteredPosts = useMemo(() => {
    const q = keyword.trim().toLowerCase()

    if (!q) {
      return posts
    }

    return posts.filter((post) => {
      const title = (post.title || '').toLowerCase()
      const summary = (post.summary || '').toLowerCase()
      const keywords = (post.keywords || []).join(' ').toLowerCase()
      return title.includes(q) || summary.includes(q) || keywords.includes(q)
    })
  }, [keyword, posts])

  const totalClicks = useMemo(
    () => posts.reduce((sum, post) => sum + Number(post.clicks || 0), 0),
    [posts],
  )

  const draftPosts = filteredPosts.filter((post) => post.status === 'draft')
  const publishedPosts = filteredPosts.filter((post) => post.status !== 'draft')
  const safeDraftPage = Math.min(draftPage, Math.max(1, Math.ceil(draftPosts.length / POSTS_PER_PAGE)))
  const safePublishedPage = Math.min(publishedPage, Math.max(1, Math.ceil(publishedPosts.length / POSTS_PER_PAGE)))
  const draftTotalPages = Math.max(1, Math.ceil(draftPosts.length / POSTS_PER_PAGE))
  const publishedTotalPages = Math.max(1, Math.ceil(publishedPosts.length / POSTS_PER_PAGE))
  const paginatedDraftPosts = draftPosts.slice((safeDraftPage - 1) * POSTS_PER_PAGE, safeDraftPage * POSTS_PER_PAGE)
  const paginatedPublishedPosts = publishedPosts.slice(
    (safePublishedPage - 1) * POSTS_PER_PAGE,
    safePublishedPage * POSTS_PER_PAGE,
  )

  function renderPostItems(items) {
    return items.map((post) => (
      <article key={post.id} className="panel post-card" role="listitem">
        <div className="post-card-head">
          <div>
            <h3>{post.title}</h3>
            <p>{post.summary}</p>
          </div>
          <div className="post-actions">
            <Link className="text-link" to={`/admin/editor/${post.id}`}>
              编辑
            </Link>
            <button type="button" className="text-button danger" onClick={() => handleDeletePost(post.id)}>
              删除
            </button>
          </div>
        </div>

        <div className="meta-row">
          <span>发布时间：{formatDate(post.createdAt)}</span>
          <span>点击量：{post.clicks}</span>
          <span>来源：{post.source === 'import' ? '文档导入' : '手动编写'}</span>
          <span>状态：{post.status === 'draft' ? '草稿' : '已发布'}</span>
        </div>
      </article>
    ))
  }

  async function handleSaveSettings() {
    setSavingSettings(true)

    try {
      await updateSettings({ blogName, blogMark, blogDescription, homeTitle, homeIntro })
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleDeletePost(id) {
    const confirmed = window.confirm('确定要删除这篇文章吗？删除后将同时清理关联附件和预览文件。')

    if (!confirmed) {
      return
    }

    setActionError('')

    try {
      await deletePost(id)
      await listPosts({ sort: sortBy, admin: true })
    } catch (error) {
      setActionError(error.message || '删除失败，请重试')
    }
  }

  return (
    <div className="page-grid admin-grid">
      <section className="panel hero-panel simple-hero">
        <div>
          <p className="eyebrow">后台总览</p>
          <h1>管理你的博客内容</h1>
          <p className="hero-text">在这里统一处理文章发布、搜索、排序，以及博客基础信息。</p>
        </div>
        <div className="hero-actions">
          <Link className="button button-primary" to="/admin/editor">
            写新文章
          </Link>
          <button type="button" className="button button-secondary" onClick={logout}>
            退出登录
          </button>
        </div>
      </section>

      <aside className="panel stats-panel">
        <div className="stat-card compact">
          <strong>{posts.length}</strong>
          <span>文章数量</span>
        </div>
        <div className="stat-card compact">
          <strong>{totalClicks}</strong>
          <span>累计阅读</span>
        </div>
      </aside>

      <section className="panel toolbar-panel">
        <div className="section-head left">
          <h2>博客信息</h2>
          <span>修改后会立即同步到前台显示</span>
        </div>

        <div className="editor-form settings-grid">
          <label className="field">
            <span>博客名称</span>
            <input value={blogName} onChange={(event) => setBlogName(event.target.value)} />
          </label>
          <label className="field">
            <span>左上角简称</span>
            <input value={blogMark} onChange={(event) => setBlogMark(event.target.value)} maxLength="2" />
          </label>
          <label className="field">
            <span>顶部简介</span>
            <input value={blogDescription} onChange={(event) => setBlogDescription(event.target.value)} />
          </label>
          <label className="field">
            <span>首页标题</span>
            <input value={homeTitle} onChange={(event) => setHomeTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>首页介绍</span>
            <textarea rows="3" value={homeIntro} onChange={(event) => setHomeIntro(event.target.value)} />
          </label>
        </div>

        <div className="hero-actions">
          <button type="button" className="button button-primary" onClick={handleSaveSettings} disabled={savingSettings}>
            {savingSettings ? '保存中...' : '保存博客信息'}
          </button>
        </div>
      </section>

      <section className="panel toolbar-panel">
        <div className="toolbar-row">
          <label className="field grow" htmlFor="admin-search-posts">
            <span>查找文章</span>
            <input
              id="admin-search-posts"
              type="search"
              placeholder="按标题或关键词搜索"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setDraftPage(1)
                setPublishedPage(1)
              }}
            />
          </label>

          <label className="field" htmlFor="admin-sort-posts">
            <span>排序方式</span>
            <select
              id="admin-sort-posts"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value)
                setDraftPage(1)
                setPublishedPage(1)
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="list-section">
        <div className="section-head">
          <h2>文章管理</h2>
          <span>{loading ? '正在读取...' : `${filteredPosts.length} 篇`}</span>
        </div>

        {actionError ? <p className="form-error">{actionError}</p> : null}

        {!loading && filteredPosts.length === 0 ? (
          <article className="panel empty-box">
            <h3>没有找到匹配文章</h3>
            <p>请换个搜索词，或者先写一篇新文章。</p>
          </article>
        ) : null}

        {filteredPosts.length > 0 ? (
          <div className="collapsible-sections">
            <section className="panel collapsible-panel">
              <button type="button" className="collapse-toggle" onClick={() => setDraftOpen((current) => !current)}>
                <span>草稿 ({draftPosts.length})</span>
                <span>{draftOpen ? '收起' : '展开'}</span>
              </button>

              {draftOpen ? (
                <div className="post-list simple-list" role="list">
                  {draftPosts.length > 0 ? renderPostItems(paginatedDraftPosts) : <p className="empty-inline">当前没有草稿文章。</p>}

                  {draftPosts.length > 0 ? (
                    <div className="pagination-bar">
                      <button type="button" className="button button-secondary" disabled={draftPage === 1} onClick={() => setDraftPage((current) => Math.max(1, current - 1))}>
                        上一页
                      </button>
                      <span className="pagination-text">第 {safeDraftPage} / {draftTotalPages} 页</span>
                      <button type="button" className="button button-secondary" disabled={safeDraftPage === draftTotalPages} onClick={() => setDraftPage((current) => Math.min(draftTotalPages, current + 1))}>
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="panel collapsible-panel">
              <button type="button" className="collapse-toggle" onClick={() => setPublishedOpen((current) => !current)}>
                <span>已发布 ({publishedPosts.length})</span>
                <span>{publishedOpen ? '收起' : '展开'}</span>
              </button>

              {publishedOpen ? (
                <div className="post-list simple-list" role="list">
                  {publishedPosts.length > 0 ? renderPostItems(paginatedPublishedPosts) : <p className="empty-inline">当前没有已发布文章。</p>}

                  {publishedPosts.length > 0 ? (
                    <div className="pagination-bar">
                      <button type="button" className="button button-secondary" disabled={publishedPage === 1} onClick={() => setPublishedPage((current) => Math.max(1, current - 1))}>
                        上一页
                      </button>
                      <span className="pagination-text">第 {safePublishedPage} / {publishedTotalPages} 页</span>
                      <button type="button" className="button button-secondary" disabled={safePublishedPage === publishedTotalPages} onClick={() => setPublishedPage((current) => Math.min(publishedTotalPages, current + 1))}>
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default AdminDashboardPage
