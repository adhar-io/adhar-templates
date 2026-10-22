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
  input,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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

// A language's own name for itself: "Deutsch", "English".
function nativeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

@Component({
  selector: 'app-language-switcher',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (languages.length > 1) {
      <select [attr.aria-label]="'nav.language' | translate" [class]="selectClass() ?? ''" (change)="change($event)">
        @for (language of languages; track language.tag) {
          <option [value]="language.tag" [selected]="language.tag === current()">{{ language.name }}</option>
        }
      </select>
    }
  `,
})
export class LanguageSwitcherComponent {
  readonly selectClass = input<string>();
  private readonly translate = inject(TranslateService);
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
  input,
  makeEnvironmentProviders,
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

@Component({
  selector: 'app-language-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class LanguageSwitcherComponent {
  readonly selectClass = input<string>();
}
{%- endif %}
