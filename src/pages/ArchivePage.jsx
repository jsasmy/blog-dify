import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { categories, formatDate, getAllPosts } from '../data/posts.js'

function ArchivePage() {
  const posts = getAllPosts()
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')

  const filteredPosts = useMemo(() => {
    const lowered = query.trim().toLowerCase()

    return posts.filter((post) => {
      const matchesCategory = activeCategory === 'All' || post.category === activeCategory
      const matchesQuery =
        lowered.length === 0 ||
        post.title.toLowerCase().includes(lowered) ||
        post.excerpt.toLowerCase().includes(lowered) ||
        post.tags.some((tag) => tag.toLowerCase().includes(lowered))

      return matchesCategory && matchesQuery
    })
  }, [activeCategory, posts, query])

  return (
    <section className="archive-page">
      <div className="section-heading archive-heading">
        <p className="eyebrow">Archive</p>
        <h1 className="archive-title">Find essays by topic, tag, or phrase</h1>
        <p>
          Search across the journal and filter by category to help returning readers locate the
          right thread quickly.
        </p>
      </div>

      <div className="archive-toolbar">
        <label className="search-field" htmlFor="archive-search">
          <span className="sr-only">Search posts</span>
          <input
            id="archive-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, excerpts, or tags"
          />
        </label>

        <div className="filter-row" role="tablist" aria-label="Filter posts by category">
          {['All', ...categories].map((category) => (
            <button
              key={category}
              type="button"
              className={category === activeCategory ? 'filter-pill active' : 'filter-pill'}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="archive-results">
        <p className="results-meta">{filteredPosts.length} post(s) found</p>
        <div className="archive-list">
          {filteredPosts.map((post) => (
            <article key={post.slug} className="archive-card">
              <div className="archive-card-meta">
                <span className="post-chip">{post.category}</span>
                <span>{formatDate(post.publishedAt)}</span>
              </div>
              <h2>
                <Link to={`/post/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.excerpt}</p>
              <div className="tag-row">
                {post.tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {filteredPosts.length === 0 ? (
            <article className="empty-archive-state">
              <p className="eyebrow">No matches</p>
              <h2>Try another keyword or category</h2>
              <p>The archive updates instantly as you change the search or active filter.</p>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default ArchivePage
