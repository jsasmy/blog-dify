const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE = configuredApiBase || (import.meta.env.DEV ? 'http://localhost:4000/api' : '/api')
const DEFAULT_API_ERROR = '后端服务暂时不可用，请确认 API 地址是否已配置'

function getAdminToken() {
  return window.localStorage.getItem('simple-blog-admin-token') || ''
}

async function request(url, options = {}) {
  const isFormData = options.body instanceof FormData
  const adminToken = options.requireAdmin ? getAdminToken() : ''
  let response

  try {
    response = await fetch(`${API_BASE}${url}`, {
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(adminToken ? { 'x-admin-token': adminToken } : {}),
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch {
    throw new Error(DEFAULT_API_ERROR)
  }

  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')

  if (!response.ok) {
    const error = isJson
      ? await response.json().catch(() => ({ message: DEFAULT_API_ERROR }))
      : { message: DEFAULT_API_ERROR }
    throw new Error(error.message || '请求失败')
  }

  if (!isJson) {
    throw new Error(DEFAULT_API_ERROR)
  }

  return response.json()
}

export function listPostsRequest({ search = '', sort = 'time-desc', admin = false } = {}) {
  const params = new URLSearchParams({ search, sort })
  return request(`/posts?${params.toString()}`, {
    requireAdmin: admin,
  })
}

export function fetchPostRequest(id, { admin = false } = {}) {
  return request(`/posts/${id}`, {
    requireAdmin: admin,
  })
}

export function fetchSiteSettingsRequest() {
  return request('/site-settings')
}

export function updateSiteSettingsRequest(payload) {
  return request('/site-settings', {
    method: 'PUT',
    requireAdmin: true,
    body: JSON.stringify(payload),
  })
}

export function validateAdminSessionRequest() {
  return request('/admin/session', {
    requireAdmin: true,
  })
}

export function createPostRequest(payload) {
  return request('/posts', {
    method: 'POST',
    requireAdmin: true,
    body: JSON.stringify(payload),
  })
}

export function updatePostRequest(id, payload) {
  return request(`/posts/${id}`, {
    method: 'PUT',
    requireAdmin: true,
    body: JSON.stringify(payload),
  })
}

export function deletePostRequest(id) {
  return request(`/posts/${id}`, {
    method: 'DELETE',
    requireAdmin: true,
  })
}

export function incrementClicksRequest(id) {
  return request(`/posts/${id}/click`, {
    method: 'POST',
  })
}

export function assistantChatRequest(payload, options = {}) {
  return request('/assistant/chat', {
    method: 'POST',
    requireAdmin: Boolean(options.requireAdmin),
    body: JSON.stringify(payload),
  })
}

export async function importDocumentRequest(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/import', {
    method: 'POST',
    body: formData,
    requireAdmin: true,
  })
}

export async function uploadAttachmentRequest(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/upload/attachment', {
    method: 'POST',
    body: formData,
    requireAdmin: true,
  })
}

export async function uploadImageRequest(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/upload/image', {
    method: 'POST',
    body: formData,
    requireAdmin: true,
  })
}

export function adminLoginRequest({ username, password }) {
  return request('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}
