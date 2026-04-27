import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BlogAssistant from '../components/BlogAssistant.jsx'
import { useBlog } from '../context/BlogContext.jsx'
import { useSite } from '../context/SiteContext.jsx'
import { formatDate } from '../utils/formatDate.js'

const sortOptions = [
  { value: 'time-desc', label: '按时间从新到旧' },
  { value: 'time-asc', label: '按时间从旧到新' },
  { value: 'click-desc', label: '按阅读量从高到低' },
  { value: 'click-asc', label: '按阅读量从低到高' },
]

const POSTS_PER_PAGE = 6

function HomePage() {
  const { posts, loading, listPosts } = useBlog()
  const { settings, fetchSettings } = useSite()
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState('time-desc')
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    listPosts({ sort: sortBy })
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

  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE)))
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE))
  const paginatedPosts = filteredPosts.slice((safePage - 1) * POSTS_PER_PAGE, safePage * POSTS_PER_PAGE)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchSettings()
    }, 180)

    return () => window.clearTimeout(timer)
  }, [fetchSettings])

  return (
    <div className="page-grid public-grid">
      <section className="panel hero-panel simple-hero public-hero">
        <div>
          <p className="eyebrow">{settings.blog_name}</p>
          <h1>{settings.home_title}</h1>
          <p className="hero-text">{settings.home_intro}</p>
        </div>
      </section>

      <section className="panel toolbar-panel">
        <div className="toolbar-row">
          <label className="field grow" htmlFor="search-posts">
            <span>搜索文章</span>
            <input
              id="search-posts"
              type="search"
              placeholder="输入标题或关键词"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </label>

          <label className="field" htmlFor="sort-posts">
            <span>排序方式</span>
            <select
              id="sort-posts"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value)
                setPage(1)
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

      <section className="list-section public-list-section">
        <div className="section-head">
          <h2>文章列表</h2>
          <span>{loading ? '加载中...' : `${filteredPosts.length} 篇文章`}</span>
        </div>

        <div className="post-list simple-list" role="list">
          {paginatedPosts.map((post) => (
            <article key={post.id} className="panel post-card" role="listitem">
              <div className="post-card-head public-card-head">
                <div>
                  <h3>
                    <Link to={`/post/${post.id}`}>{post.title}</Link>
                  </h3>
                  <p>{post.summary}</p>
                </div>
              </div>

              <div className="meta-row">
                <span>发布于：{formatDate(post.createdAt)}</span>
                <span>阅读量：{post.clicks}</span>
              </div>

              <div className="tag-row">
                {(post.keywords || []).map((item) => (
                  <span key={item} className="tag">
                    {item}
                  </span>
                ))}
              </div>
            </article>
          ))}

          {!loading && filteredPosts.length === 0 ? (
            <article className="panel empty-box">
              <h3>没有找到相关文章</h3>
              <p>可以换一个标题词、关键词，或者稍后再看看新文章。</p>
            </article>
          ) : null}
        </div>

        {filteredPosts.length > 0 ? (
          <div className="pagination-bar">
            <button type="button" className="button button-secondary" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              上一页
            </button>
            <span className="pagination-text">
              第 {safePage} / {totalPages} 页
            </span>
            <button type="button" className="button button-secondary" disabled={safePage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              下一页
            </button>
          </div>
        ) : null}
      </section>

      <BlogAssistant posts={posts} />
    </div>
  )
}

export default HomePage
