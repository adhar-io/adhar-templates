import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'

// Applied before first paint so the saved (or system) theme never flashes.
const themeScript = `try{const s=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches)}catch{}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#4f46e5' },
      { title: ${{ values.name | dump }} },
      { name: 'description', content: ${{ (values.description or values.name) | dump }} },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/adhar-mark.svg' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    // The theme class is set by the inline script, so it differs from the
    // server render by design.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
