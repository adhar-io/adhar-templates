import { useCallback, useEffect, useState } from 'react'

// Light/dark theme: follows the system until the user picks one, then
// remembers it. index.html applies it before first paint.
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Until the user picks a theme, keep following the system's while the page
  // is open: an OS that turns dark at sunset turns an open tab dark too, not
  // only the next page load.
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = (event) => {
      let picked = null
      try {
        picked = localStorage.getItem('theme')
      } catch {}
      if (!picked) setDark(event.matches)
    }
    system.addEventListener('change', follow)
    return () => system.removeEventListener('change', follow)
  }, [])

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
