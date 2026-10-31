{% if values.withLocalisation -%}
// Localisation with Tolgee (https://tolgee.io).
//
// Every user-visible string is a key: `{{ 'features.heading' | translate }}`.
// src/i18n/<language>.json holds the texts; en.json is the SOURCE text, and new
// keys go there first.
//
// Where the texts come from at runtime, in order:
//   1. GET /i18n/<language>.json from this app's own origin. nginx proxies it to
//      Tolgee's export API with a read-only key the browser never sees, and
//      answers with the copy built into the image when Tolgee is not configured
//      or not answering (nginx-app.conf).
//   2. If even that request fails, the English copy bundled into the JavaScript
//      (a lazily loaded chunk, fetched only in that case).
//   3. A key missing in the chosen language falls back to English.
import {
  ChangeDetectionStrategy,
  Component,
  type EnvironmentProviders,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { buttonVariants, cn } from '@adhar-ui/angular';
import {
  BackendFetch,
  DevTools,
  FormatSimple,
  LanguageDetector,
  LanguageStorage,
  Tolgee,
  type TolgeePlugin,
  TranslatePipe,
  TranslateService,
  provideTolgee,
} from '@tolgee/ngx';
import { IconComponent } from './icon.component';

export { TranslatePipe };

export const BASE_LANGUAGE = 'en';
// The languages chosen when the app was scaffolded; the base language first.
export const LANGUAGES: string[] = [
  ...new Set([BASE_LANGUAGE, ...${{ values.languages | dump }}.split(',').map((tag) => tag.trim()).filter(Boolean)]),
];

// In-context editing (Alt + click a text) under `ng serve` ONLY. Its Tolgee
// credentials come from the Tolgee Tools browser extension (see README), so no
// key is ever written into the app; a production build does not even load it.
const devTools: TolgeePlugin = isDevMode() ? DevTools() : (tolgee) => tolgee;

export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideTolgee(() =>
      Tolgee()
        .use(devTools)
        .use(FormatSimple())
        .use(BackendFetch({ prefix: '/i18n', timeout: 5000, fallbackOnFail: true }))
        .use(LanguageStorage())
        .use(LanguageDetector())
        .init({
          availableLanguages: LANGUAGES,
          defaultLanguage: BASE_LANGUAGE,
          fallbackLanguage: BASE_LANGUAGE,
          staticData: {
            [BASE_LANGUAGE]: () => import('../i18n/en.json').then((texts) => texts.default),
          },
        }),
    ),
    // Keep <html lang> on the language being shown.
    provideEnvironmentInitializer(() => {
      inject(TranslateService).languageAsync.subscribe((language) => (document.documentElement.lang = language));
    }),
  ]);
}

/** The language the app shows right now, e.g. for content that is fetched per language. */
export function injectLanguage(): Signal<string> {
  return toSignal(inject(TranslateService).languageAsync, { initialValue: BASE_LANGUAGE });
}

// A language's own name for itself: "Deutsch", "English".
function nativeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// A native <select>, so keyboards, screen readers and phones get the browser's
// own picker, styled as one of the ghost buttons beside it. Its built-in arrow
// and inner spacing never line up with a button, so appearance-none removes
// both and a chevron is drawn over the right-hand padding instead: pr-7 with
// the chevron at right-2 puts it about as far from the text as from the edge,
// the way an icon sits in a button. A select is as wide as its LONGEST option,
// which strands the chevron after a shorter one ("English" beside "Deutsch");
// field-sizing-content fits it to the language shown, where the browser
// supports it. The open list is drawn by the browser, so
// the options get the theme's popover colours, or a dark page can get light
// text on a light list. The host takes no box of its own (display: contents):
// the wrapper is the header's flex item, and an app with one language leaves no
// empty slot (and no extra gap) in the header.
@Component({
  selector: 'app-language-switcher',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (languages.length > 1) {
      <div class="relative inline-flex items-center">
        <select [attr.aria-label]="'nav.language' | translate" [class]="selectClass" (change)="change($event)">
          @for (language of languages; track language.tag) {
            <option
              class="bg-popover text-popover-foreground"
              [value]="language.tag"
              [attr.lang]="language.tag"
              [selected]="language.tag === current()"
            >{{ language.name }}</option>
          }
        </select>
        <app-icon
          name="chevron-down"
          size="size-3.5"
          class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors peer-hover:text-accent-foreground"
        />
      </div>
    }
  `,
})
export class LanguageSwitcherComponent {
  private readonly translate = inject(TranslateService);
  protected readonly selectClass = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'peer appearance-none bg-transparent pr-7 field-sizing-content');
  protected readonly current = toSignal(this.translate.languageAsync);
  protected readonly languages = LANGUAGES.map((tag) => ({ tag, name: nativeName(tag) }));

  protected change(event: Event): void {
    void this.translate.changeLanguage((event.target as HTMLSelectElement).value);
  }
}
{%- else -%}
// The app's string table. Every user-visible string is a key looked up in
// src/i18n/en.json with the `translate` pipe, so turning on localisation later
// is a dependency and a provider, not a rewrite of every template.
import {
  ChangeDetectionStrategy,
  Component,
  type EnvironmentProviders,
  Pipe,
  type PipeTransform,
  makeEnvironmentProviders,
  type Signal,
  signal,
} from '@angular/core';
import en from '../i18n/en.json';

const texts: Record<string, string> = en;

@Pipe({ name: 'translate' })
export class TranslatePipe implements PipeTransform {
  transform(key: string, params?: Record<string, unknown>): string {
    const text = texts[key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;
  }
}

export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([]);
}

export function injectLanguage(): Signal<string> {
  return signal('en').asReadonly();
}

// One language, so nothing to switch. display: contents keeps the empty element
// out of the header's flex layout, where it would add a gap.
@Component({
  selector: 'app-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: '',
})
export class LanguageSwitcherComponent {}
{%- endif %}
