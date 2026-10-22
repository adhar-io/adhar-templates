import { createFileRoute } from '@tanstack/react-router'
import { translations } from '../../server/translations'

// GET /i18n/<language>.json — the app's texts for one language, flat JSON. The
// browser loads a language from here when the user switches to it; Tolgee
// first, the built-in file when Tolgee is not configured or not answering, 404
// for a language neither has (src/server/i18n.ts).
export const Route = createFileRoute('/i18n/$file')({
  server: {
    handlers: {
      GET: ({ params }) => translations.respond(params.file),
    },
  },
})
