import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAdmin } from '../context/AdminContext.jsx'

function RequireAdmin() {
  const { isAuthenticated, checkingSession } = useAdmin()
  const location = useLocation()

  if (checkingSession) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

export default RequireAdmin
