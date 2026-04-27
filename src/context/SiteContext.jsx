import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { fetchSiteSettingsRequest, updateSiteSettingsRequest } from '../services/blogApi.js'

const SiteContext = createContext(null)

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState({
    blog_name: '简博客',
    blog_mark: '简',
    blog_description: '记录想法、经验与长期写作',
    home_title: '欢迎来到我的博客',
    home_intro: '这里展示我发布的文章。',
  })

  const fetchSettings = useCallback(async () => {
    const data = await fetchSiteSettingsRequest()
    setSettings(data)
    return data
  }, [])

  const updateSettings = useCallback(async (payload) => {
    const data = await updateSiteSettingsRequest(payload)
    setSettings(data)
    return data
  }, [])

  const value = useMemo(
    () => ({ settings, fetchSettings, updateSettings }),
    [fetchSettings, settings, updateSettings],
  )

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const context = useContext(SiteContext)

  if (!context) {
    throw new Error('useSite must be used within SiteProvider')
  }

  return context
}
