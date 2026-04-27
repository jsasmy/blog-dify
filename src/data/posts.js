import { postCatalog } from './postCatalog.js'

const markdownModules = import.meta.glob('../content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const contentBySlug = Object.fromEntries(
  Object.entries(markdownModules).map(([path, content]) => {
    const slug = path.split('/').pop().replace('.md', '')
    return [slug, content]
  }),
)

const posts = postCatalog

const hydratedPosts = posts.map((post) => ({
  ...post,
  content: contentBySlug[post.slug] ?? 'Content coming soon.',
}))

export const categories = [...new Set(hydratedPosts.map((post) => post.category))]

export function getAllPosts() {
  return [...hydratedPosts].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
}

export function getFeaturedPost() {
  return hydratedPosts.find((post) => post.featured) ?? getAllPosts()[0]
}

export function getPostBySlug(slug) {
  return hydratedPosts.find((post) => post.slug === slug)
}

export function getRelatedPosts(slug) {
  const current = getPostBySlug(slug)

  if (!current) {
    return []
  }

  return getAllPosts()
    .filter((post) => post.slug !== slug)
    .filter(
      (post) =>
        post.category === current.category ||
        post.tags.some((tag) => current.tags.includes(tag)),
    )
    .slice(0, 3)
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
