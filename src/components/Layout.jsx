import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAdmin } from '../context/AdminContext.jsx'
import { useSite } from '../context/SiteContext.jsx'

function Layout() {
  const location = useLocation()
  const { isAuthenticated } = useAdmin()
  const { settings, fetchSettings } = useSite()

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const isAdminArea = location.pathname.startsWith('/admin')
  const brandTarget = isAdminArea && isAuthenticated ? '/admin' : '/'

  return (
    <div className="site-shell">
      <header className="site-header">
        <NavLink className="brand" to={brandTarget}>
          <span className="brand-mark">{settings.blog_mark}</span>
          <span>
            <strong>{settings.blog_name}</strong>
            <em>{settings.blog_description}</em>
          </span>
        </NavLink>

      </header>

      <main className="site-main">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
