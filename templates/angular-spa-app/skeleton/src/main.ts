import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideI18n } from './app/i18n';

bootstrapApplication(AppComponent, { providers: [provideI18n()] }).catch((err) => console.error(err));
