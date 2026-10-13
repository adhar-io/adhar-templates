import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { badgeVariants, buttonVariants, cardVariants, cn } from '@adhar-ui/angular';
import { IconComponent } from './icon.component';

// Adhar UI for Angular ships its styles as variant functions; every styled
// element below composes one of them with Tailwind utilities.
@Component({
  selector: 'app-root',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-screen flex-col' },
  template: `
    <header class="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight">
          <img src="adhar-symbol.svg" alt="" class="size-8" />
          <span>{{ appName }}</span>
        </a>
        <nav class="flex items-center gap-1">
          <a [href]="docsUrl" [class]="navLink">Docs</a>
          <a [href]="repoUrl" [class]="navLink">Repository</a>
          <button
            type="button"
            [class]="iconButton"
            [attr.aria-label]="dark() ? 'Switch to light theme' : 'Switch to dark theme'"
            (click)="toggleTheme()"
          >
            <app-icon [name]="dark() ? 'sun' : 'moon'" />
          </button>
        </nav>
      </div>
    </header>

    <main class="flex-1">
      <section class="relative overflow-hidden">
        <div aria-hidden="true" class="pointer-events-none absolute inset-0 bg-brand-glow"></div>
        <div class="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_1fr]">
          <div class="animate-slide-up motion-reduce:animate-none">
            <span [class]="liveBadge">
              <span aria-hidden="true" class="mr-1 inline-block size-1.5 rounded-full bg-current opacity-70"></span>
              Live on Adhar
            </span>
            <h1 class="mt-6 max-w-3xl break-words text-4xl font-bold tracking-tight sm:text-6xl">
              <span class="text-brand-gradient">{{ appName }}</span>
            </h1>
            <p class="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{{ description }}</p>
            <div class="mt-8 flex flex-wrap gap-3">
              <a href="#get-started" [class]="primaryCta">Get started <app-icon name="arrow-right" size="size-4" /></a>
              <a [href]="docsUrl" [class]="secondaryCta"><app-icon name="book-open" size="size-4" /> Read the docs</a>
            </div>
          </div>

          <div [class]="pipelineCard">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Delivery pipeline</p>
                <p class="text-xs text-muted-foreground">Runs on every push to main</p>
              </div>
              <span [class]="branchBadge">main</span>
            </div>
            <ol class="mt-6 space-y-1">
              @for (stage of pipeline; track stage.name; let last = $last) {
                <li class="relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
                  @if (!last) {
                    <span aria-hidden="true" class="absolute left-[1.15rem] top-9 h-[calc(100%-1rem)] w-px bg-border"></span>
                  }
                  <span class="relative z-[1] inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <app-icon name="check" size="size-3.5" />
                  </span>
                  <span class="text-sm font-medium">{{ stage.name }}</span>
                  <span class="ml-auto text-xs text-muted-foreground">{{ stage.detail }}</span>
                </li>
              }
            </ol>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="platform">
        <h2 id="platform" class="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          What the platform gives you
        </h2>
        <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (feature of features; track feature.title) {
            <div [class]="featureCard">
              <div class="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <app-icon [name]="feature.icon" />
              </div>
              <h3 class="text-base font-semibold leading-none tracking-tight">{{ feature.title }}</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ feature.body }}</p>
            </div>
          }
        </div>
      </section>

      <section id="get-started" class="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <div [class]="stepsCard">
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-1 bg-brand-gradient"></div>
          <div class="flex items-center gap-2 text-primary">
            <app-icon name="code" />
            <h2 class="text-xl font-semibold tracking-tight text-foreground">Get started</h2>
          </div>
          <ol class="mt-6 grid gap-4 md:grid-cols-3">
            @for (step of steps; track step.title; let i = $index) {
              <li class="rounded-lg border bg-muted/40 p-4">
                <div class="flex items-center gap-2 text-sm font-medium">
                  <span class="inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">{{ i + 1 }}</span>
                  {{ step.title }}
                </div>
                <code class="mt-3 block rounded-md bg-background px-3 py-2 font-mono text-xs text-muted-foreground">{{ step.code }}</code>
              </li>
            }
          </ol>
        </div>
      </section>
    </main>

    <footer class="border-t">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <div class="flex items-center gap-2">
          <img src="adhar-symbol.svg" alt="" class="size-5" />
          Built on the Adhar platform
        </div>
        <span>Owned by {{ owner }}</span>
      </div>
    </footer>
  `,
})
export class AppComponent {
  protected readonly appName = ${{ values.name | dump }};
  // JSON-encoded at scaffold time, so quotes in the description are safe.
  protected readonly description: string = ${{
    (values.description or 'An Angular single-page app, scaffolded with Adhar UI and shipped through the Adhar platform.') | dump
  }};
  protected readonly owner = ${{ values.owner | dump }};
  protected readonly repoUrl = 'https://${{ values.giteaHost }}/${{ values.gitOwner }}/${{ values.repoName }}';
  protected readonly docsUrl = this.repoUrl + '/src/branch/main/docs';

  // Light/dark: follows the system until the user picks one, then remembers it.
  protected readonly dark = signal(document.documentElement.classList.contains('dark'));

  constructor() {
    effect(() => document.documentElement.classList.toggle('dark', this.dark()));
  }

  protected toggleTheme(): void {
    this.dark.update((dark) => {
      try {
        localStorage.setItem('theme', dark ? 'light' : 'dark');
      } catch {}
      return !dark;
    });
  }

  protected readonly navLink = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex');
  protected readonly iconButton = buttonVariants({ variant: 'ghost', size: 'icon-sm' });
  protected readonly primaryCta = buttonVariants({ size: 'lg' });
  protected readonly secondaryCta = buttonVariants({ variant: 'outline', size: 'lg' });
  protected readonly liveBadge = badgeVariants({ variant: 'success' });
  protected readonly branchBadge = badgeVariants({ variant: 'outline' });
  protected readonly pipelineCard = cn(
    cardVariants({ padding: 'default' }),
    'animate-fade-in motion-reduce:animate-none shadow-xl shadow-primary/5',
  );
  protected readonly featureCard = cardVariants({ padding: 'default', interactive: true });
  protected readonly stepsCard = cn(cardVariants({ padding: 'lg' }), 'relative overflow-hidden');

  protected readonly pipeline = [
    { name: 'Build', detail: 'Cloud Native Buildpacks' },
    { name: 'Scan', detail: 'Trivy · SBOM' },
    { name: 'Sign', detail: 'cosign' },
    { name: 'Verify', detail: 'Kyverno admission' },
    { name: 'Canary', detail: 'Argo Rollouts' },
  ];

  protected readonly features = [
    {
      icon: 'shield-check',
      title: 'Signed supply chain',
      body: 'Every push is built with buildpacks, scanned, SBOM-attested and cosign-signed. Unsigned images never start.',
    },
    {
      icon: 'git-branch',
      title: 'GitOps delivery',
      body: 'Argo CD syncs deploy/ and Argo Rollouts shifts traffic in canary steps. A revert is the rollback.',
    },
    {
      icon: 'activity',
      title: 'Observable',
      body: 'Served behind the platform gateway with TLS, metrics and logs collected without any setup.',
    },
    {
      icon: 'layers',
      title: 'Adhar UI',
      body: 'Design tokens, Tailwind preset and accessible component variants — light and dark out of the box.',
    },
  ];

  protected readonly steps = [
    { title: 'Run it locally', code: 'npm install && npm start' },
    { title: 'Make it yours', code: 'edit src/app/app.component.ts' },
    { title: 'Ship it', code: 'git push origin main' },
  ];
}
