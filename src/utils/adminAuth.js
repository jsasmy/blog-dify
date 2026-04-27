const TOKEN_KEY = 'simple-blog-admin-token'
const USERNAME_KEY = 'simple-blog-admin-username'

export function getAdminToken() {
  return window.localStorage.getItem(TOKEN_KEY) || ''
}

export function setAdminToken(token) {
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function getAdminUsername() {
  return window.localStorage.getItem(USERNAME_KEY) || ''
}

export function setAdminUsername(username) {
  window.localStorage.setItem(USERNAME_KEY, username)
}

export function clearAdminToken() {
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(USERNAME_KEY)
}

export function isAdminLoggedIn() {
  return Boolean(getAdminToken())
}
