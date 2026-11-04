import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import './index.css'
import { startTelemetry } from './telemetry.ts'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no element with id "root" to render the app into')

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)

// Faro RUM and analytics, configured at runtime (src/telemetry.ts); a no-op
// when /runtime-config.json turns nothing on.
void startTelemetry()
