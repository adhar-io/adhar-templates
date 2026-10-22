import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'
import './index.css'
import { startTelemetry } from './telemetry.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)

// Faro RUM and analytics, configured at runtime (src/telemetry.js); a no-op
// when /runtime-config.json turns nothing on.
startTelemetry()
