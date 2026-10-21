import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { buttonVariants } from '@adhar-ui/react'
import appCss from '../styles.css?url'

// Applied before first paint so the saved (or system) theme never flashes.
const themeScript = `try{const s=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches)}catch{}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#2563eb' },
      { title: ${{ values.name | dump }} },
      { name: 'description', content: ${{ (values.description or values.name) | dump }} },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/adhar-symbol.svg' },
    ],
  }),
  component: RootComponent,
  // Any URL no route matches. The server answers it with a 404 status and this
  // page; without it TanStack Router renders a bare "Not Found" and warns.
  notFoundComponent: NotFound,
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

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="max-w-md text-muted-foreground">There is nothing at this address.</p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Back to the home page
      </Link>
    </main>
  )
}
