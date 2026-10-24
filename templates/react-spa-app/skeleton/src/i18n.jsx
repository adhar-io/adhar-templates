{% if values.withLocalisation -%}
// Localisation with Tolgee (https://tolgee.io).
//
// Every user-visible string is a key: `const { t } = useTranslate()` then
// `t('features.heading')`. src/i18n/<language>.json holds the texts; en.json is
// the SOURCE text, and new keys go there first.
//
// Where the texts come from at runtime, in order:
//   1. GET /i18n/<language>.json from this app's own origin. nginx proxies it to
//      Tolgee's export API with a read-only key the browser never sees, and
//      answers with the copy built into the image when Tolgee is not configured
//      or not answering (nginx-app.conf).
//   2. If even that request fails, the copy bundled into the JavaScript (a lazily
//      loaded chunk per language, fetched only in that case).
//   3. A key missing in the chosen language falls back to English.
import { useEffect } from 'react'
import {
  BackendFetch,
  DevTools,
  FormatSimple,
  LanguageDetector,
  LanguageStorage,
  Tolgee,
  TolgeeProvider,
  useTolgee,
  useTranslate,
} from '@tolgee/react'

export { useTranslate }

export const BASE_LANGUAGE = 'en'
// The languages chosen when the app was scaffolded; the base language first.
export const LANGUAGES = [
  ...new Set([BASE_LANGUAGE, ...${{ values.languages | dump }}.split(',').map((tag) => tag.trim()).filter(Boolean)]),
]

// src/i18n/*.json — whatever `tolgee pull` left there at build time.
const bundled = Object.fromEntries(
  Object.entries(import.meta.glob('./i18n/*.json', { import: 'default' })).map(([path, load]) => [
    path.slice('./i18n/'.length, -'.json'.length),
    load,
  ]),
)

const tolgee = Tolgee()
  // In-context editing (Alt + click a text) in `npm run dev` ONLY. A production
  // build contains neither the tools nor a key.
  .use(import.meta.env.DEV ? DevTools() : (instance) => instance)
  .use(FormatSimple())
  .use(BackendFetch({ prefix: '/i18n', timeout: 5000, fallbackOnFail: true }))
  .use(LanguageStorage())
  .use(LanguageDetector())
  .init({
    availableLanguages: LANGUAGES,
    defaultLanguage: BASE_LANGUAGE,
    fallbackLanguage: BASE_LANGUAGE,
    staticData: bundled,
    // Set VITE_TOLGEE_API_URL and VITE_TOLGEE_API_KEY in .env.development.local
    // (git-ignored) to edit texts in place while developing; see README.
    ...(import.meta.env.DEV
      ? { apiUrl: import.meta.env.VITE_TOLGEE_API_URL, apiKey: import.meta.env.VITE_TOLGEE_API_KEY }
      : {}),
  })

export function I18nProvider({ children }) {
  useEffect(() => {
    const setLang = () => (document.documentElement.lang = tolgee.getLanguage() ?? BASE_LANGUAGE)
    setLang()
    const listener = tolgee.on('language', setLang)
    return () => listener.unsubscribe()
  }, [])

  return (
    <TolgeeProvider tolgee={tolgee} fallback={null}>
      {children}
    </TolgeeProvider>
  )
}

/** The language the app shows right now, e.g. for content that is fetched per language. */
export function useLanguage() {
  return useTolgee(['language']).getLanguage() ?? BASE_LANGUAGE
}

// A language's own name for itself: "Deutsch", "English".
function nativeName(tag) {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

export function LanguageSwitcher({ className }) {
  const { t } = useTranslate()
  const instance = useTolgee(['language'])
  if (LANGUAGES.length < 2) return null

  return (
    <select
      aria-label={t('nav.language')}
      className={className}
      value={instance.getLanguage()}
      onChange={(event) => instance.changeLanguage(event.target.value)}
    >
      {LANGUAGES.map((tag) => (
        <option key={tag} value={tag}>
          {nativeName(tag)}
        </option>
      ))}
    </select>
  )
}
{%- else -%}
// The app's string table. Every user-visible string is a key looked up in
// src/i18n/en.json, so turning on localisation later is a dependency and a
// provider, not a rewrite of every component.
import en from './i18n/en.json'

export const BASE_LANGUAGE = 'en'
export const LANGUAGES = [BASE_LANGUAGE]

function translate(key, params) {
  const text = en[key] ?? key
  return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text
}

export function useTranslate() {
  return { t: translate }
}

export function I18nProvider({ children }) {
  return children
}

export function LanguageSwitcher() {
  return null
}

export function useLanguage() {
  return BASE_LANGUAGE
}
{%- endif %}
