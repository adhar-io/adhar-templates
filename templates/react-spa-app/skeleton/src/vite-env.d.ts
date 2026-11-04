/// <reference types="vite/client" />

// The app's version (package.json), injected by vite.config.ts at build time.
declare const __APP_VERSION__: string
{%- if values.withLocalisation %}

interface ImportMetaEnv {
  // In-context editing of translations, `npm run dev` only (src/i18n.tsx, README).
  readonly VITE_TOLGEE_API_URL?: string
  readonly VITE_TOLGEE_API_KEY?: string
}
{%- endif %}
