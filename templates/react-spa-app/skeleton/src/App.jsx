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
import { Activity, ArrowRight, BookOpen, Check, Code, GitBranch, Moon, Palette, ShieldCheck, Sun } from './icons.jsx'
import { useTheme } from './useTheme.js'

const APP_NAME = ${{ values.name | dump }}
// JSON-encoded at scaffold time, so quotes in the description are safe.
const DESCRIPTION = ${{
  (values.description or 'A React single-page app, scaffolded with Adhar UI and shipped through the Adhar platform.') | dump
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
    body: 'Served behind the platform gateway with TLS, metrics and logs collected without any setup.',
  },
  {
    icon: Palette,
    title: 'Adhar UI',
    body: 'Design tokens, Tailwind preset and accessible component variants — light and dark out of the box.',
  },
]

// The platform's delivery chain for every push to main.
const pipeline = [
  { name: 'Build', detail: 'Cloud Native Buildpacks' },
  { name: 'Scan', detail: 'Trivy · SBOM' },
  { name: 'Sign', detail: 'cosign' },
  { name: 'Verify', detail: 'Kyverno admission' },
  { name: 'Canary', detail: 'Argo Rollouts' },
]

function Pipeline() {
  return (
    <Card className={cn(cardVariants({ padding: 'default' }), 'animate-fade-in motion-reduce:animate-none shadow-xl shadow-primary/5')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Delivery pipeline</p>
          <p className="text-xs text-muted-foreground">Runs on every push to main</p>
        </div>
        <Badge className={badgeVariants({ variant: 'outline' })}>main</Badge>
      </div>
      <ol className="mt-6 space-y-1">
        {pipeline.map((stage, i) => (
          <li key={stage.name} className="relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
            {i < pipeline.length - 1 && (
              <span aria-hidden="true" className="absolute left-[1.15rem] top-9 h-[calc(100%-1rem)] w-px bg-border" />
            )}
            <span className="relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
              <Check className="size-3.5" />
            </span>
            <span className="text-sm font-medium">{stage.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{stage.detail}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

const steps = [
  { title: 'Run it locally', code: 'npm install && npm run dev' },
  { title: 'Make it yours', code: 'edit src/App.jsx' },
  { title: 'Ship it', code: 'git push origin main' },
]

export default function App() {
  const { dark, toggle } = useTheme()

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
              <Badge className={badgeVariants({ variant: 'success' })} dot>
                Live on Adhar
              </Badge>
              <h1 className="mt-6 max-w-3xl break-words text-4xl font-bold tracking-tight sm:text-6xl">
                <span className="text-brand-gradient">{APP_NAME}</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {DESCRIPTION}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#get-started" className={buttonVariants({ size: 'lg' })}>
                  Get started <ArrowRight />
                </a>
                <a href={DOCS_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  <BookOpen /> Read the docs
                </a>
              </div>
            </div>
            <Pipeline />
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
            <img src="/adhar-symbol.svg" alt="" className="size-5" />
            Built on the Adhar platform
          </div>
          <span>Owned by {OWNER}</span>
        </div>
      </footer>
    </div>
  )
}
