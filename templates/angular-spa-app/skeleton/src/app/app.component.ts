import { Component } from '@angular/core';
import { buttonVariants } from '@adhar-ui/angular';
import { cn } from '@adhar-ui/utils';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <main
      class="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-foreground"
    >
      <h1 class="text-4xl font-bold tracking-tight">${{ values.name }}</h1>
      <p class="text-muted-foreground max-w-md text-center">${{ values.description }}</p>
      <p class="text-sm text-muted-foreground">Built with Adhar UI on the Adhar platform.</p>
      <div class="flex gap-3">
        <button [class]="primary">Get started</button>
        <button [class]="outline">Learn more</button>
      </div>
    </main>
  `,
})
export class AppComponent {
  // Adhar UI style variants (design tokens applied via the Tailwind preset).
  primary = cn(buttonVariants());
  outline = cn(buttonVariants({ variant: 'outline' }));
}
