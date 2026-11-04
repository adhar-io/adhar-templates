import { useCallback, useEffect, useState } from 'react'

export interface Theme {
  /** True while the dark theme is shown. */
  dark: boolean
  /** Switches to the other theme and remembers the choice in this browser. */
  toggle: () => void
}

// Light/dark theme: follows the system until the user picks one, then
// remembers it. index.html applies it before first paint.
export function useTheme(): Theme {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Until the user picks a theme, keep following the system's while the page
  // is open: an OS that turns dark at sunset turns an open tab dark too, not
  // only the next page load.
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = (event: MediaQueryListEvent) => {
      let picked: string | null = null
      try {
        picked = localStorage.getItem('theme')
      } catch {
        // Storage refused (a private mode, or blocked): follow the system.
      }
      if (!picked) setDark(event.matches)
    }
    system.addEventListener('change', follow)
    return () => system.removeEventListener('change', follow)
  }, [])

  const toggle = useCallback(() => {
    setDark((current) => {
      try {
        localStorage.setItem('theme', current ? 'light' : 'dark')
      } catch {
        // Storage refused: the choice lasts until the page is closed.
      }
      return !current
    })
  }, [])

  return { dark, toggle }
}
