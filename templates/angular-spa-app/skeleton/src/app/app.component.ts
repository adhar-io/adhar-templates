import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { badgeVariants, buttonVariants, cardVariants, cn } from '@adhar-ui/angular';
{%- if values.withCms %}
import { CmsSectionComponent } from './cms';
{%- endif %}
import { IconComponent } from './icon.component';
import { LanguageSwitcherComponent, TranslatePipe } from './i18n';

// Adhar UI for Angular ships its styles as variant functions; every styled
// element below composes one of them with Tailwind utilities.
@Component({
  selector: 'app-root',
  imports: [{% if values.withCms %}CmsSectionComponent, {% endif %}IconComponent, LanguageSwitcherComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-screen flex-col' },
  template: `
    <header class="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <!-- The same focus ring as the header's buttons; the browser's own
             outline hugs the text and clips the name's descenders. A long
             name stays on one line and ends in an ellipsis (min-w-0 lets the
             link shrink, truncate cuts the text): on a phone it would
             otherwise wrap out of the 4rem header, or push the page sideways.
             The heading below shows it in full. -->
        <a
          href="/"
          class="flex min-w-0 items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <img src="adhar-symbol.svg" alt="" class="size-8" />
          <span class="truncate">{{ appName }}</span>
        </a>
        <nav class="flex items-center gap-1">
          <a [href]="docsUrl" [class]="navLink">{{ 'nav.docs' | translate }}</a>
          <a [href]="repoUrl" [class]="navLink">{{ 'nav.repository' | translate }}</a>
          <app-language-switcher />
          <button
            type="button"
            [class]="iconButton"
            [attr.aria-label]="(dark() ? 'theme.switchToLight' : 'theme.switchToDark') | translate"
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
              {{ 'hero.badge' | translate }}
            </span>
            <h1 class="mt-6 max-w-3xl break-words text-4xl font-bold tracking-tight sm:text-6xl">
              <span class="text-brand-gradient">{{ appName }}</span>
            </h1>
            <p class="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{{ 'app.description' | translate }}</p>
            <div class="mt-8 flex flex-wrap gap-3">
              <a href="#get-started" [class]="primaryCta">{{ 'hero.getStarted' | translate }} <app-icon name="arrow-right" size="size-4" /></a>
              <a [href]="docsUrl" [class]="secondaryCta"><app-icon name="book-open" size="size-4" /> {{ 'hero.readDocs' | translate }}</a>
            </div>
          </div>

          <div [class]="pipelineCard">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">{{ 'pipeline.title' | translate }}</p>
                <p class="text-xs text-muted-foreground">{{ 'pipeline.subtitle' | translate }}</p>
              </div>
              <span [class]="branchBadge">main</span>
            </div>
            <ol class="mt-6 space-y-1">
              @for (stage of pipeline; track stage; let last = $last) {
                <li class="relative flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
                  @if (!last) {
                    <span aria-hidden="true" class="absolute left-[1.15rem] top-9 h-[calc(100%-1rem)] w-px bg-border"></span>
                  }
                  <span class="relative z-[1] inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <app-icon name="check" size="size-3.5" />
                  </span>
                  <span class="text-sm font-medium">{{ stage | translate }}</span>
                  <span class="ml-auto text-xs text-muted-foreground">{{ stage + '.detail' | translate }}</span>
                </li>
              }
            </ol>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="platform">
        <h2 id="platform" class="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {{ 'features.heading' | translate }}
        </h2>
        <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          @for (feature of features; track feature.key) {
            <div [class]="featureCard">
              <div class="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <app-icon [name]="feature.icon" />
              </div>
              <h3 class="text-base font-semibold leading-none tracking-tight">{{ feature.key + '.title' | translate }}</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ feature.key + '.body' | translate }}</p>
            </div>
          }
        </div>
      </section>
{% if values.withCms %}
      <app-cms-section />
{% endif %}
      <section id="get-started" class="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <div [class]="stepsCard">
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-1 bg-brand-gradient"></div>
          <div class="flex items-center gap-2 text-primary">
            <app-icon name="code" />
            <h2 class="text-xl font-semibold tracking-tight text-foreground">{{ 'getStarted.heading' | translate }}</h2>
          </div>
          <ol class="mt-6 grid gap-4 md:grid-cols-3">
            @for (step of steps; track step.title; let i = $index) {
              <li class="rounded-lg border bg-muted/40 p-4">
                <div class="flex items-center gap-2 text-sm font-medium">
                  <span class="inline-flex size-6 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">{{ i + 1 }}</span>
                  {{ step.title | translate }}
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
          {{ 'footer.builtOn' | translate }}
        </div>
        <span>{{ 'footer.ownedBy' | translate: { owner: owner } }}</span>
      </div>
    </footer>
  `,
})
export class AppComponent {
  // The app's name is not translated. Every other user-visible string is a key
  // in src/i18n/<language>.json, shown with the translate pipe (see ./i18n.ts).
  protected readonly appName = ${{ values.name | dump }};
  protected readonly owner = ${{ values.owner | dump }};
  protected readonly repoUrl = 'https://${{ values.giteaHost }}/${{ values.gitOwner }}/${{ values.repoName }}';
  protected readonly docsUrl = this.repoUrl + '/src/branch/main/docs';

  // Light/dark: follows the system until the user picks one, then remembers it.
  protected readonly dark = signal(document.documentElement.classList.contains('dark'));

  constructor() {
    effect(() => document.documentElement.classList.toggle('dark', this.dark()));

    // Until the user picks a theme, keep following the system's while the page
    // is open: an OS that turns dark at sunset turns an open tab dark too, not
    // only the next page load.
    const system = matchMedia('(prefers-color-scheme: dark)');
    const follow = (event: MediaQueryListEvent) => {
      let picked: string | null = null;
      try {
        picked = localStorage.getItem('theme');
      } catch {}
      if (!picked) this.dark.set(event.matches);
    };
    system.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => system.removeEventListener('change', follow));
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

  protected readonly pipeline = ['pipeline.build', 'pipeline.scan', 'pipeline.sign', 'pipeline.verify', 'pipeline.canary'];

  protected readonly features = [
    { icon: 'shield-check', key: 'features.supplyChain' },
    { icon: 'git-branch', key: 'features.gitops' },
    { icon: 'activity', key: 'features.observable' },
    { icon: 'layers', key: 'features.adharUi' },
  ] as const;

  // Commands are code, not prose, so only their titles are translated.
  protected readonly steps = [
    { title: 'getStarted.runLocally', code: 'npm install && npm start' },
    { title: 'getStarted.makeItYours', code: 'edit src/app/app.component.ts' },
    { title: 'getStarted.ship', code: 'git push origin main' },
  ];
}
