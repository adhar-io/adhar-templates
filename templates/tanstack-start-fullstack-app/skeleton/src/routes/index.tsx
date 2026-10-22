import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Badge,
  Button,
  Card,
  badgeVariants,
  buttonVariants,
  cardDescriptionVariants,
  cardTitleVariants,
  cardVariants,
} from '@adhar-ui/react'
import { cn } from '@adhar-ui/utils'
import { Activity, ArrowRight, BookOpen, Check, Code, GitBranch, Moon, Palette, ShieldCheck, Sun } from '../components/icons'
import { useTheme } from '../components/useTheme'
import { LanguageSwitcher, useTranslate } from '../localisation'

export const Route = createFileRoute('/')({
  component: Home,
})

// The app's name is not translated. Every other user-visible string is a key in
// src/i18n/<language>.json, looked up with t() (see src/localisation.tsx).
const APP_NAME = ${{ values.name | dump }}
const OWNER = ${{ values.owner | dump }}
const REPO_URL = 'https://${{ values.giteaHost }}/${{ values.gitOwner }}/${{ values.repoName }}'
const DOCS_URL = `${REPO_URL}/src/branch/main/docs`

// Adhar UI components are unstyled shells; the look comes from its variant
// functions, so every styled element composes one of them.
const features = [
  { icon: ShieldCheck, key: 'features.supplyChain' },
  { icon: GitBranch, key: 'features.gitops' },
  { icon: Activity, key: 'features.observable' },
  { icon: Palette, key: 'features.adharUi' },
]

// Commands are code, not prose, so only their titles are translated.
const steps = [
  { title: 'getStarted.runLocally', code: 'npm install && npm run dev' },
  { title: 'getStarted.addPage', code: 'src/routes/…' },
  { title: 'getStarted.ship', code: 'git push origin main' },
]

type Health = { service: string; status: string; db?: string }
type HealthState = { kind: 'loading' } | { kind: 'ok'; health: Health; ms: number } | { kind: 'error' }

// Calls this app's own server route — the request goes browser → server → back.
function useHealth() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    const started = performance.now()
    fetch('/api/hello')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((health: Health) => {
        if (!cancelled) setState({ kind: 'ok', health, ms: Math.round(performance.now() - started) })
      })
      .catch(() => !cancelled && setState({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

function ServiceStatus() {
  const state = useHealth()
  const { t } = useTranslate()
  const rows: { label: string; value: ReactNode }[] = [
    { label: t('status.rendering'), value: t('status.rendering.value') },
    {
      label: t('status.api'),
      value:
        state.kind === 'loading' ? (
          <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
        ) : state.kind === 'ok' ? (
          <code className="font-mono text-xs">GET /api/hello · {state.ms} ms</code>
        ) : (
          <span className="text-destructive">{t('status.unreachable')}</span>
        ),
    },
{%- if values.withDatabase %}
    {
      label: t('status.database'),
      value:
        state.kind === 'ok' && state.health.db && state.health.db !== 'error' ? (
          <code className="font-mono text-xs">{new Date(state.health.db).toLocaleTimeString()}</code>
        ) : state.kind === 'loading' ? (
          <span className="inline-block h-4 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-destructive">{t('status.notConnected')}</span>
        ),
    },
{%- endif %}
  ]

  return (
    <Card className={cn(cardVariants({ padding: 'default' }), 'animate-fade-in motion-reduce:animate-none shadow-xl shadow-primary/5')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t('status.title')}</p>
          <p className="text-xs text-muted-foreground">{t('status.subtitle')}</p>
        </div>
        {state.kind === 'ok' ? (
          // Keyed so each state mounts fresh rather than color-morphing from grey.
          <Badge key="ok" className={badgeVariants({ variant: 'success' })} dot>
            {t('status.healthy')}
          </Badge>
        ) : state.kind === 'error' ? (
          <Badge key="down" className={badgeVariants({ variant: 'destructive' })}>
            {t('status.down')}
          </Badge>
        ) : (
          <Badge key="checking" className={badgeVariants({ variant: 'secondary' })}>
            {t('status.checking')}
          </Badge>
        )}
      </div>
      <dl className="mt-6 divide-y rounded-lg border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="size-4 text-primary" />
              {row.label}
            </dt>
            <dd className="text-right text-sm font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function Home() {
  const { dark, toggle } = useTheme()
  const { t } = useTranslate()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img src="/adhar-symbol.svg" alt="" className="size-8" />
            <span>{APP_NAME}</span>
          </a>
          <nav className="flex items-center gap-1">
            <a href={DOCS_URL} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              {t('nav.docs')}
            </a>
            <a href={REPO_URL} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              {t('nav.repository')}
            </a>
            <LanguageSwitcher className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'cursor-pointer bg-transparent')} />
            <Button
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={dark ? t('theme.switchToLight') : t('theme.switchToDark')}
              onClick={toggle}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-brand-glow" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_1fr]">
            <div className="animate-slide-up motion-reduce:animate-none">
              <Badge className={badgeVariants({ variant: 'outline' })}>TanStack Start · Adhar UI</Badge>
              <h1 className="mt-6 max-w-3xl break-words text-4xl font-bold tracking-tight sm:text-6xl">
                <span className="text-brand-gradient">{APP_NAME}</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{t('app.description')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#get-started" className={buttonVariants({ size: 'lg' })}>
                  {t('hero.getStarted')} <ArrowRight />
                </a>
                <a href={DOCS_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  <BookOpen /> {t('hero.readDocs')}
                </a>
              </div>
            </div>
            <ServiceStatus />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="platform">
          <h2 id="platform" className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {t('features.heading')}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: FeatureIcon, key }) => (
              <Card key={key} className={cardVariants({ padding: 'default', interactive: true })}>
                <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <FeatureIcon />
                </div>
                <h3 className={cn(cardTitleVariants(), 'text-base')}>{t(`${key}.title`)}</h3>
                <p className={cn(cardDescriptionVariants(), 'mt-2')}>{t(`${key}.body`)}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="get-started" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
          <Card className={cn(cardVariants({ padding: 'lg' }), 'relative overflow-hidden')}>
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
            <div className="flex items-center gap-2 text-primary">
              <Code />
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('getStarted.heading')}</h2>
            </div>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title} className="rounded-lg border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
                      {i + 1}
                    </span>
                    {t(step.title)}
                  </div>
                  <code className="mt-3 block rounded-md bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                    {step.code}
                  </code>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <img src="/adhar-symbol.svg" alt="" className="size-5" />
            {t('footer.builtOn')}
          </div>
          <span>{t('footer.ownedBy', { owner: OWNER })}</span>
        </div>
      </footer>
    </div>
  )
}
