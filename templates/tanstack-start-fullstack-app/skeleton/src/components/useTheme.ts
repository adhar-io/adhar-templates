import { useCallback, useEffect, useState } from 'react'

// Light/dark theme: follows the system until the user picks one, then
// remembers it. The root route applies it before first paint. State starts
// false on the server and syncs on mount, so SSR never touches `document`.
export function useTheme() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = useCallback(() => {
    setDark((current) => {
      const next = !current
      document.documentElement.classList.toggle('dark', next)
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light')
      } catch {}
      return next
    })
  }, [])

  return { dark, toggle }
}
