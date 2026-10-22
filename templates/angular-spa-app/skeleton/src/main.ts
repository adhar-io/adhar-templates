import { ErrorHandler } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideI18n } from './app/i18n';
import { startTelemetry, TelemetryErrorHandler } from './app/telemetry';

bootstrapApplication(AppComponent, {
  providers: [provideI18n(), { provide: ErrorHandler, useClass: TelemetryErrorHandler }],
}).catch((err) => console.error(err));

// Faro RUM and analytics, configured at runtime (src/app/telemetry.ts); a no-op
// when /runtime-config.json turns nothing on.
startTelemetry();
