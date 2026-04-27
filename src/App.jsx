import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import './editor-clean.css'
import Layout from './components/Layout.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import { AdminProvider } from './context/AdminContext.jsx'
import { BlogProvider } from './context/BlogContext.jsx'
import { SiteProvider } from './context/SiteContext.jsx'
import AdminDashboardPage from './pages/AdminDashboardPage.jsx'
import AdminLoginPage from './pages/AdminLoginPage.jsx'
import HomePage from './pages/HomePage.jsx'
import PostPage from './pages/PostPage.jsx'

const EditorPage = lazy(() => import('./pages/EditorPage.jsx'))

function App() {
  return (
    <AdminProvider>
      <SiteProvider>
        <BlogProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/post/:id" element={<PostPage />} />
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminDashboardPage />} />
                <Route
                  path="/admin/editor"
                  element={
                    <Suspense fallback={<section className="panel empty-box">正在打开编辑器...</section>}>
                      <EditorPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/admin/editor/:id"
                  element={
                    <Suspense fallback={<section className="panel empty-box">正在打开编辑器...</section>}>
                      <EditorPage />
                    </Suspense>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BlogProvider>
      </SiteProvider>
    </AdminProvider>
  )
}

export default App
