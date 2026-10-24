{% if values.withLocalisation -%}
// Localisation with Tolgee (https://tolgee.io).
//
// Every user-visible string is a key: `const { t } = useTranslate()` then
// `t('features.heading')`. src/i18n/<language>.json holds the texts; en.json is
// the SOURCE text, and new keys go there first.
//
// Where the texts come from:
//   - The server render: the root route's loader (loadI18n below) picks the
//     language — the `lang` cookie, else the browser's Accept-Language — and
//     reads its texts on the server from Tolgee, or from the built-in files when
//     Tolgee is not configured or not answering (src/server/i18n.ts). They are
//     rendered into the HTML and handed to the browser with it, so the first
//     paint is already translated and hydration matches.
//   - Switching language in the browser: GET /i18n/<language>.json from this
//     app's own server (src/routes/i18n/$file.ts) — the same source, so the
//     Tolgee key never reaches the browser. If even that request fails, the
//     copy bundled into the JavaScript is used.
//   - A key missing in the chosen language falls back to English.
import { useEffect, useState, type ReactNode } from 'react'
import { createServerFn } from '@tanstack/react-start'
import {
  BackendFetch,
  DevTools,
  FormatSimple,
  Tolgee,
  TolgeeProvider,
  type TolgeeStaticData,
  useTolgee,
  useTranslate,
} from '@tolgee/react'

export { useTranslate }

export const BASE_LANGUAGE = 'en'
// The languages chosen when the app was scaffolded; the base language first.
export const LANGUAGES = [
  ...new Set([BASE_LANGUAGE, ...${{ values.languages | dump }}.split(',').map((tag: string) => tag.trim()).filter(Boolean)]),
]
const LANGUAGE_COOKIE = 'lang'

export interface I18nState {
  language: string
  staticData: Record<string, Record<string, string>>
}

/** Runs on the server for the first render, and as an RPC on client navigations. */
export const loadI18n = createServerFn({ method: 'GET' }).handler(async (): Promise<I18nState> => {
  const { getCookie, getRequestHeader } = await import('@tanstack/react-start/server')
  const { translations } = await import('./server/translations')
  const language = (await import('./server/i18n')).pickLanguage(
    LANGUAGES,
    BASE_LANGUAGE,
    getCookie(LANGUAGE_COOKIE),
    getRequestHeader('accept-language'),
  )
  // The chosen language and the base language it falls back to.
  const staticData: I18nState['staticData'] = {}
  for (const tag of new Set([language, BASE_LANGUAGE])) {
    const translation = await translations.get(tag)
    if (translation) staticData[tag] = translation.texts
  }
  return { language: staticData[language] ? language : BASE_LANGUAGE, staticData }
})

// The built-in files, each a lazily loaded chunk the browser fetches only when
// /i18n/<language>.json does not answer.
const bundled = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, string>>('./i18n/*.json', { import: 'default' })).map(
    ([path, load]) => [path.slice('./i18n/'.length, -'.json'.length), load],
  ),
) as TolgeeStaticData

function createTolgee() {
  return (
    Tolgee()
      // In-context editing (Alt + click a text) under `npm run dev` ONLY; a
      // production build contains neither the tools nor a key.
      .use(import.meta.env.DEV ? DevTools() : (instance) => instance)
      .use(FormatSimple())
      .use(BackendFetch({ prefix: '/i18n', timeout: 5000, fallbackOnFail: true }))
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
  )
}

export function I18nProvider({ state, children }: { state: I18nState; children: ReactNode }) {
  // One instance per render tree: per request on the server, once in the browser.
  const [tolgee] = useState(createTolgee)

  useEffect(() => {
    const listener = tolgee.on('language', ({ value }) => {
      document.documentElement.lang = value
      document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`
    })
    return () => listener.unsubscribe()
  }, [tolgee])

  return (
    <TolgeeProvider tolgee={tolgee} fallback={null} ssr={{ language: state.language, staticData: state.staticData }}>
      {children}
    </TolgeeProvider>
  )
}

// A language's own name for itself: "Deutsch", "English".
function nativeName(tag: string) {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** The language the app shows right now, e.g. for content that is fetched per language. */
export function useLanguage(): string {
  return useTolgee(['language']).getLanguage() ?? BASE_LANGUAGE
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslate()
  const tolgee = useTolgee(['language'])
  if (LANGUAGES.length < 2) return null

  return (
    <select
      aria-label={t('nav.language')}
      className={className}
      value={tolgee.getLanguage()}
      onChange={(event) => tolgee.changeLanguage(event.target.value)}
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
import type { ReactNode } from 'react'
import en from './i18n/en.json'

export const BASE_LANGUAGE = 'en'
export const LANGUAGES = [BASE_LANGUAGE]

export interface I18nState {
  language: string
}

const texts: Record<string, string> = en

function translate(key: string, params?: Record<string, unknown>) {
  const text = texts[key] ?? key
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
}

export async function loadI18n(): Promise<I18nState> {
  return { language: BASE_LANGUAGE }
}

export function useTranslate() {
  return { t: translate }
}

export function I18nProvider({ children }: { state: I18nState; children: ReactNode }) {
  return children
}

export function LanguageSwitcher(_props: { className?: string }) {
  return null
}

export function useLanguage(): string {
  return BASE_LANGUAGE
}
{%- endif %}
