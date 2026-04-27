import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  createPostRequest,
  deletePostRequest,
  fetchPostRequest,
  importDocumentRequest,
  incrementClicksRequest,
  listPostsRequest,
  uploadAttachmentRequest,
  uploadImageRequest,
  updatePostRequest,
} from '../services/blogApi.js'

const BlogContext = createContext(null)

export function BlogProvider({ children }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)

  const listPosts = useCallback(async ({ search = '', sort = 'time-desc', admin = false } = {}) => {
    setLoading(true)

    try {
      const data = await listPostsRequest({ search, sort, admin })
      setPosts(data)
      return data
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPost = useCallback(async (id, options = {}) => {
    return fetchPostRequest(id, options)
  }, [])

  const createPost = useCallback(async (payload) => {
    const created = await createPostRequest(payload)
    setPosts((current) => [created, ...current])
    return created
  }, [])

  const updatePost = useCallback(async (id, payload) => {
    const updated = await updatePostRequest(id, payload)
    setPosts((current) => current.map((post) => (post.id === id ? updated : post)))
    return updated
  }, [])

  const deletePost = useCallback(async (id) => {
    await deletePostRequest(id)
    setPosts((current) => current.filter((post) => post.id !== id))
  }, [])

  const incrementClicks = useCallback(async (id) => {
    const updated = await incrementClicksRequest(id)
    setPosts((current) => current.map((post) => (post.id === id ? updated : post)))
    return updated
  }, [])

  const importDocument = useCallback(async (file) => {
    return importDocumentRequest(file)
  }, [])

  const uploadAttachment = useCallback(async (file) => {
    return uploadAttachmentRequest(file)
  }, [])

  const uploadImage = useCallback(async (file) => {
    return uploadImageRequest(file)
  }, [])

  const value = useMemo(
    () => ({
      posts,
      loading,
      listPosts,
      fetchPost,
      createPost,
      updatePost,
      deletePost,
      incrementClicks,
      importDocument,
      uploadAttachment,
      uploadImage,
    }),
    [
      createPost,
      deletePost,
      fetchPost,
      importDocument,
      incrementClicks,
      listPosts,
      loading,
      posts,
      updatePost,
      uploadAttachment,
      uploadImage,
    ],
  )

  return <BlogContext.Provider value={value}>{children}</BlogContext.Provider>
}

export function useBlog() {
  const context = useContext(BlogContext)

  if (!context) {
    throw new Error('useBlog must be used within BlogProvider')
  }

  return context
}
