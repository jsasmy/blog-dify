import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  adminLoginRequest,
  validateAdminSessionRequest,
} from '../services/blogApi.js'
import {
  clearAdminToken,
  getAdminToken,
  getAdminUsername,
  setAdminToken,
  setAdminUsername,
} from '../utils/adminAuth.js'

const AdminContext = createContext(null)

export function AdminProvider({ children }) {
  const [token, setToken] = useState(() => getAdminToken())
  const [username, setUsername] = useState(() => getAdminUsername())
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let active = true

    async function validateSession() {
      if (!token) {
        if (active) {
          setCheckingSession(false)
        }
        return
      }

      try {
        const result = await validateAdminSessionRequest()

        if (!active) {
          return
        }

        setUsername(result.username)
      } catch {
        if (!active) {
          return
        }

        clearAdminToken()
        setToken('')
        setUsername('')
      } finally {
        if (active) {
          setCheckingSession(false)
        }
      }
    }

    validateSession()

    return () => {
      active = false
    }
  }, [token])

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(token),
      checkingSession,
      username,
      async login({ username: loginName, password }) {
        const result = await adminLoginRequest({ username: loginName, password })
        setAdminToken(result.token)
        setAdminUsername(result.username)
        setToken(result.token)
        setUsername(result.username)
      },
      logout() {
        clearAdminToken()
        setToken('')
        setUsername('')
      },
    }),
    [checkingSession, token, username],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const context = useContext(AdminContext)

  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider')
  }

  return context
}
