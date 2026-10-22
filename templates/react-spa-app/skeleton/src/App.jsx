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
import { LanguageSwitcher, useTranslate } from './i18n.jsx'
import { useTheme } from './useTheme.js'

// The app's name is not translated. Every other user-visible string is a key in
// src/i18n/<language>.json, looked up with t() (see src/i18n.jsx).
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

// The platform's delivery chain for every push to main.
const pipeline = ['pipeline.build', 'pipeline.scan', 'pipeline.sign', 'pipeline.verify', 'pipeline.canary']

function Pipeline() {
  const { t } = useTranslate()
  return (
    <Card className={cn(cardVariants({ padding: 'default' }), 'animate-fade-in motion-reduce:animate-none shadow-xl shadow-primary/5')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t('pipeline.title')}</p>
          <p className="text-xs text-muted-foreground">{t('pipeline.subtitle')}</p>
        </div>
        <Badge className={badgeVariants({ variant: 'outline' })}>main</Badge>
      </div>
      <ol className="mt-6 space-y-1">
        {pipeline.map((stage, i) => (
          <li key={stage} className="relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
            {i < pipeline.length - 1 && (
              <span aria-hidden="true" className="absolute left-[1.15rem] top-9 h-[calc(100%-1rem)] w-px bg-border" />
            )}
            <span className="relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
              <Check className="size-3.5" />
            </span>
            <span className="text-sm font-medium">{t(stage)}</span>
            <span className="ml-auto text-xs text-muted-foreground">{t(`${stage}.detail`)}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// Commands are code, not prose, so only their titles are translated.
const steps = [
  { title: 'getStarted.runLocally', code: 'npm install && npm run dev' },
  { title: 'getStarted.makeItYours', code: 'edit src/App.jsx' },
  { title: 'getStarted.ship', code: 'git push origin main' },
]

export default function App() {
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
              <Badge className={badgeVariants({ variant: 'success' })} dot>
                {t('hero.badge')}
              </Badge>
              <h1 className="mt-6 max-w-3xl break-words text-4xl font-bold tracking-tight sm:text-6xl">
                <span className="text-brand-gradient">{APP_NAME}</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {t('app.description')}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#get-started" className={buttonVariants({ size: 'lg' })}>
                  {t('hero.getStarted')} <ArrowRight />
                </a>
                <a href={DOCS_URL} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  <BookOpen /> {t('hero.readDocs')}
                </a>
              </div>
            </div>
            <Pipeline />
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
