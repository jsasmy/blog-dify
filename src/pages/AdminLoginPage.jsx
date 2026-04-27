import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAdmin } from '../context/AdminContext.jsx'

function AdminLoginPage() {
  const { isAuthenticated, checkingSession, login } = useAdmin()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!checkingSession && isAuthenticated) {
      navigate(location.state?.from || '/admin', { replace: true })
    }
  }, [checkingSession, isAuthenticated, location.state, navigate])

  if (checkingSession) {
    return (
      <section className="panel login-panel">
        <h1>正在检查登录状态...</h1>
      </section>
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login({ username, password })
      navigate(location.state?.from || '/admin', { replace: true })
    } catch (loginError) {
      setError(loginError.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel login-panel">
      <p className="eyebrow">后台登录</p>
      <h1>请输入后台密码</h1>
      <p className="hero-text">登录后即可持续停留在后台，不需要每次回到首页再重新进入。</p>

      <form className="editor-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>账号</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>

        <label className="field">
          <span>后台密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入后台密码"
          />
        </label>

        <button type="submit" className="button button-primary" disabled={loading}>
          {loading ? '登录中...' : '进入后台'}
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  )
}

export default AdminLoginPage
