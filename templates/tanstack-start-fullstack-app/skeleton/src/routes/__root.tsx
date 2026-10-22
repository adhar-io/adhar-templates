import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { buttonVariants } from '@adhar-ui/react'
import { useEffect } from 'react'
import { I18nProvider, loadI18n, useTranslate } from '../localisation'
import { startTelemetry } from '../telemetry'
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
  // The language and its texts, read on the server so the first render is
  // already translated (see src/localisation.tsx).
  loader: () => loadI18n(),
  component: RootComponent,
  // Any URL no route matches. The server answers it with a 404 status and this
  // page; without it TanStack Router renders a bare "Not Found" and warns.
  notFoundComponent: NotFound,
})

function RootComponent() {
  const i18n = Route.useLoaderData()
  // Faro RUM and analytics (src/telemetry.ts), configured at runtime by
  // /runtime-config.json. An effect runs in the browser only, after hydration.
  useEffect(() => {
    void startTelemetry()
  }, [])
  return (
    // The theme class is set by the inline script, so it differs from the
    // server render by design.
    <html lang={i18n.language} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <I18nProvider state={i18n}>
          <Outlet />
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  const { t } = useTranslate()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold tracking-tight">{t('notFound.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('notFound.body')}</p>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        {t('notFound.home')}
      </Link>
    </main>
  )
}
