// The app's translation source, wired to the Pod's environment: TOLGEE_API_URL,
// TOLGEE_PROJECT_ID and TOLGEE_API_KEY from the Secret <app>-tolgee (all
// optional, see deploy/base/rollout.yaml), and the files in src/i18n/ — built
// into the server bundle — as the fallback. Server-only.
import { createTranslationSource, type Texts } from './i18n'

const files = import.meta.glob<Texts>('../i18n/*.json', { eager: true, import: 'default' })

export const bundled: Record<string, Texts> = Object.fromEntries(
  Object.entries(files).map(([path, texts]) => [path.slice('../i18n/'.length, -'.json'.length), texts]),
)

export const translations = createTranslationSource({ env: () => process.env, bundled })
