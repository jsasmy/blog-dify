import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useParams } from 'react-router-dom'
import BlogAssistant from '../components/BlogAssistant.jsx'
import { useBlog } from '../context/BlogContext.jsx'
import { formatDate } from '../utils/formatDate.js'

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

function PostPage() {
  const { id } = useParams()
  const { fetchPost, incrementClicks, posts } = useBlog()
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadPost() {
      try {
        const data = await fetchPost(id)

        if (!active) {
          return
        }

        setPost(data)
        const updated = await incrementClicks(id)

        if (active) {
          setPost(updated)
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || '加载失败')
        }
      }
    }

    loadPost()

    return () => {
      active = false
    }
  }, [fetchPost, id, incrementClicks])

  const navigationPosts = useMemo(() => {
    if (!post) {
      return { previous: null, next: null }
    }

    const sorted = [...posts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    const currentIndex = sorted.findIndex((item) => item.id === post.id)

    return {
      previous: currentIndex > 0 ? sorted[currentIndex - 1] : null,
      next: currentIndex >= 0 && currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null,
    }
  }, [post, posts])

  if (error) {
    return (
      <section className="panel empty-box">
        <h1>文章加载失败</h1>
        <p>{error}</p>
      </section>
    )
  }

  if (!post) {
    return (
      <section className="panel empty-box">
        <h1>正在加载文章...</h1>
      </section>
    )
  }

  const isPdf = post.fileMimeType?.includes('pdf')

  return (
    <div className="post-layout reading-layout-wide">
      <article className="panel article-panel">
        <div className="article-head">
          <Link className="text-link" to="/">
            返回文章列表
          </Link>
        </div>

        <header className="article-header">
          {post.coverImageUrl ? <img className="article-cover" src={post.coverImageUrl} alt={post.title} /> : null}
          <h1>{post.title}</h1>
          <p className="post-summary">{post.summary}</p>
          <div className="meta-row">
            <span>发布时间：{formatDate(post.createdAt)}</span>
            <span>最近更新：{formatDate(post.updatedAt)}</span>
            <span>点击量：{post.clicks}</span>
          </div>
          <div className="tag-row">
            {(post.keywords || []).map((item) => (
              <span key={item} className="tag">
                {item}
              </span>
            ))}
          </div>
        </header>

        <div className="markdown-body article-content">
          {looksLikeHtml(post.content) ? (
            <div dangerouslySetInnerHTML={{ __html: post.content }} />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
          )}
        </div>

        {post.fileUrl ? (
          <section className="source-file-panel">
            <div className="section-head left">
              <h2>原始文件</h2>
              <a className="text-link" href={post.fileUrl} target="_blank" rel="noreferrer">
                打开 / 下载原文件
              </a>
            </div>

            {isPdf && (post.pdfPreviewImages || []).length > 0 ? (
              <div className="pdf-preview-grid">
                {post.pdfPreviewImages.map((image, index) => (
                  <img key={image} src={image} alt={`PDF 第 ${index + 1} 页`} className="pdf-preview-image" />
                ))}
              </div>
            ) : isPdf ? (
              <iframe className="file-frame" src={post.fileUrl} title="PDF 原文预览" />
            ) : post.htmlPreview ? (
              <div className="html-preview" dangerouslySetInnerHTML={{ __html: post.htmlPreview }} />
            ) : (
              <p className="hero-text">当前文件类型暂不支持在线还原预览，但原文件已保留。</p>
            )}
          </section>
        ) : null}

        {(post.attachments || []).length > 0 ? (
          <section className="source-file-panel">
            <div className="section-head left">
              <h2>附件下载</h2>
              <span>文章附带文件</span>
            </div>
            <div className="attachment-list article-attachment-list">
              {post.attachments.map((item) => (
                <div key={item.storedFileName} className="attachment-item">
                  <span>{item.originalFileName}</span>
                  <a className="button button-secondary" href={item.fileUrl} download>
                    下载
                  </a>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="post-nav">
          {navigationPosts.previous ? (
            <Link className="panel post-nav-card" to={`/post/${navigationPosts.previous.id}`}>
              <span>上一篇</span>
              <strong>{navigationPosts.previous.title}</strong>
            </Link>
          ) : (
            <div className="panel post-nav-card disabled">
              <span>上一篇</span>
              <strong>没有了</strong>
            </div>
          )}

          {navigationPosts.next ? (
            <Link className="panel post-nav-card" to={`/post/${navigationPosts.next.id}`}>
              <span>下一篇</span>
              <strong>{navigationPosts.next.title}</strong>
            </Link>
          ) : (
            <div className="panel post-nav-card disabled">
              <span>下一篇</span>
              <strong>没有了</strong>
            </div>
          )}
        </section>
      </article>

      <BlogAssistant posts={posts} currentPost={post} />
    </div>
  )
}

export default PostPage
