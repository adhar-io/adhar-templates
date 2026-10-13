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

export const Route = createFileRoute('/')({
  component: Home,
})

const APP_NAME = ${{ values.name | dump }}
// JSON-encoded at scaffold time, so quotes in the description are safe.
const DESCRIPTION = ${{
  (values.description or 'A full-stack TanStack Start app: server-rendered React and API routes in one service, styled with Adhar UI.') | dump
}}
const OWNER = ${{ values.owner | dump }}
const REPO_URL = 'https://${{ values.giteaHost }}/${{ values.gitOwner }}/${{ values.repoName }}'
const DOCS_URL = `${REPO_URL}/src/branch/main/docs`

// Adhar UI components are unstyled shells; the look comes from its variant
// functions, so every styled element composes one of them.
const features = [
  {
    icon: ShieldCheck,
    title: 'Signed supply chain',
    body: 'Every push is built with buildpacks, scanned, SBOM-attested and cosign-signed. Unsigned images never start.',
  },
  {
    icon: GitBranch,
    title: 'GitOps delivery',
    body: 'Argo CD syncs deploy/ and Argo Rollouts shifts traffic in canary steps. A revert is the rollback.',
  },
  {
    icon: Activity,
    title: 'Observable',
    body: 'OpenTelemetry auto-instrumentation sends traces and metrics from the server to the platform collector.',
  },
  {
    icon: Palette,
    title: 'Adhar UI',
    body: 'Design tokens, Tailwind preset and accessible component variants — light and dark out of the box.',
  },
]

const steps = [
  { title: 'Run it locally', code: 'npm install && npm run dev' },
  { title: 'Add a page or API', code: 'src/routes/…' },
  { title: 'Ship it', code: 'git push origin main' },
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
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Rendering', value: 'Server-side (SSR) + hydration' },
    {
      label: 'API',
      value:
        state.kind === 'loading' ? (
          <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
        ) : state.kind === 'ok' ? (
          <code className="font-mono text-xs">GET /api/hello · {state.ms} ms</code>
        ) : (
          <span className="text-destructive">unreachable</span>
        ),
    },
{%- if values.withDatabase %}
    {
      label: 'PostgreSQL',
      value:
        state.kind === 'ok' && state.health.db && state.health.db !== 'error' ? (
          <code className="font-mono text-xs">{new Date(state.health.db).toLocaleTimeString()}</code>
        ) : state.kind === 'loading' ? (
          <span className="inline-block h-4 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-destructive">not connected</span>
        ),
    },
{%- endif %}
  ]

  return (
    <Card className={cn(cardVariants({ padding: 'default' }), 'animate-fade-in motion-reduce:animate-none shadow-xl shadow-primary/5')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Service status</p>
          <p className="text-xs text-muted-foreground">Live from this app's server route</p>
        </div>
        {state.kind === 'ok' ? (
          // Keyed so each state mounts fresh rather than color-morphing from grey.
          <Badge key="ok" className={badgeVariants({ variant: 'success' })} dot>
            Healthy
          </Badge>
        ) : state.kind === 'error' ? (
          <Badge key="down" className={badgeVariants({ variant: 'destructive' })}>
            Down
          </Badge>
        ) : (
          <Badge key="checking" className={badgeVariants({ variant: 'secondary' })}>
            Checking…
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img src="/adhar-mark.svg" alt="" className="size-8" />
            <span>{APP_NAME}</span>
          </a>
          <nav className="flex items-center gap-1">
            <a href={DOCS_URL} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              Docs
            </a>
            <a href={REPO_URL} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>
              Repository
            </a>
            <Button
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
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
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{DESCRIPTION}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#get-started" className={buttonVariants({ size: 'lg' })}>
                  Get started <ArrowRight />
                </a>
                <a href={DOCS_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  <BookOpen /> Read the docs
                </a>
              </div>
            </div>
            <ServiceStatus />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="platform">
          <h2 id="platform" className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            What the platform gives you
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: FeatureIcon, title, body }) => (
              <Card key={title} className={cardVariants({ padding: 'default', interactive: true })}>
                <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <FeatureIcon />
                </div>
                <h3 className={cn(cardTitleVariants(), 'text-base')}>{title}</h3>
                <p className={cn(cardDescriptionVariants(), 'mt-2')}>{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="get-started" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
          <Card className={cn(cardVariants({ padding: 'lg' }), 'relative overflow-hidden')}>
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
            <div className="flex items-center gap-2 text-primary">
              <Code />
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Get started</h2>
            </div>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title} className="rounded-lg border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
                      {i + 1}
                    </span>
                    {step.title}
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
            <img src="/adhar-mark.svg" alt="" className="size-5" />
            Built on the Adhar platform
          </div>
          <span>Owned by {OWNER}</span>
        </div>
      </footer>
    </div>
  )
}
