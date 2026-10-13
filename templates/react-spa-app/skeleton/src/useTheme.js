import { useCallback, useEffect, useState } from 'react'

// Light/dark theme: follows the system until the user picks one, then
// remembers it. index.html applies it before first paint.
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const toggle = useCallback(() => {
    setDark((current) => {
      try {
        localStorage.setItem('theme', current ? 'light' : 'dark')
      } catch {}
      return !current
    })
  }, [])

  return { dark, toggle }
}
