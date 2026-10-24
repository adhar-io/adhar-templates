{% if values.withCms -%}
// Content from the platform's Strapi CMS (https://strapi.io), read-only.
//
// The browser never talks to Strapi directly: GET /cms/<path> on this app's own
// origin is Strapi's REST API at /api/<path>, proxied by nginx with a read-only
// token the browser never sees (nginx-app.conf), and media URLs Strapi returns
// (/uploads/<file>) are served the same way. So there is nothing to configure in
// the app and no secret in the bundle.
//
//   const result = await fetchCollection('articles', { locale: 'de', pageSize: 6 });
//   result.status   'ok'    — result.entries (Strapi 5 documents), result.pagination
//                   'off'   — this environment has no Strapi token yet (X-Cms: off)
//                   'error' — Strapi refused, failed or did not answer
//
// fetchCollection never throws, so a CMS outage costs a section of a page, never
// the page. Query parameters are Strapi's own:
// https://docs.strapi.io/cms/api/rest/parameters
import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { badgeVariants, cardVariants, cn } from '@adhar-ui/angular';
import { injectLanguage, TranslatePipe } from './i18n';

export const CMS_COLLECTION: string = ${{ values.cmsCollection | dump }};

const TIMEOUT_MS = 8000;

/** A Strapi document: its fields are whatever the content type defines. */
export type CmsEntry = { id?: number; documentId?: string; publishedAt?: string } & Record<string, unknown>;

export type CmsResult =
  | { status: 'ok'; entries: CmsEntry[]; pagination: Record<string, number> | null }
  | { status: 'off' }
  | { status: 'error'; httpStatus?: number };

/** Strapi's bracketed query string, e.g. { sort: ['publishedAt:desc'] } → sort[0]=publishedAt:desc. */
export function toQuery(params: Record<string, unknown> | undefined, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') toQuery(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function get(path: string, params: Record<string, unknown>, signal?: AbortSignal) {
  const query = toQuery(params).toString();
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(`/cms/${path}${query ? `?${query}` : ''}`, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.headers.get('x-cms') === 'off') return { status: 'off' as const };
  if (!response.ok) return { status: 'error' as const, httpStatus: response.status };
  return { status: 'ok' as const, body: await response.json() };
}

export interface CollectionOptions {
  locale?: string;
  pageSize?: number;
  page?: number;
  sort?: string[];
  filters?: Record<string, unknown>;
  populate?: string | Record<string, unknown>;
  signal?: AbortSignal;
}

/** The published entries of a collection type (its plural API ID, e.g. 'articles'), newest first. */
export async function fetchCollection(type: string, options: CollectionOptions = {}): Promise<CmsResult> {
  const { locale, pageSize = 6, page = 1, sort = ['publishedAt:desc'], filters, populate = '*', signal } = options;
  const params = { pagination: { page, pageSize }, sort, filters, populate };
  try {
    let result = await get(encodeURIComponent(type), { ...params, locale }, signal);
    // A content type that is not localised, or not in this language, refuses the
    // locale; the default language's entries are better than none.
    if (result.status === 'error' && locale && (result.httpStatus === 400 || result.httpStatus === 404)) {
      result = await get(encodeURIComponent(type), params, signal);
    }
    if (result.status !== 'ok') return result;
    const entries = Array.isArray(result.body?.data) ? (result.body.data as CmsEntry[]) : [];
    return { status: 'ok', entries, pagination: result.body?.meta?.pagination ?? null };
  } catch {
    return { status: 'error' };
  }
}

/** The first of an entry's fields that holds text, for content types that name them differently. */
export function textField(entry: CmsEntry, ...names: string[]): string {
  for (const name of names) {
    const value = entry[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** The URL of an entry's image (Strapi media field), same-origin, or ''. */
export function imageUrl(entry: CmsEntry, ...names: string[]): string {
  for (const name of names) {
    const field = entry[name] as any;
    const media = Array.isArray(field) ? field[0] : field;
    const url = media?.formats?.small?.url ?? media?.url;
    if (typeof url === 'string' && url.startsWith('/uploads/')) return url;
  }
  return '';
}

type Card = { key: string; title: string; description: string; image: string; publishedAt: string; date: string };

// The latest entries of one Strapi collection type, in the language the app is
// shown in. Each state says what it is, so an empty or unconnected CMS reads as
// a next step rather than a broken page.
@Component({
  selector: 'app-cms-section',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="cms" [attr.aria-busy]="status() === 'loading'">
      <div class="flex items-end justify-between gap-4">
        <div>
          <h2 id="cms" class="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{{ 'cms.heading' | translate }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ 'cms.subtitle' | translate }}</p>
        </div>
        <span [class]="badge">{{ collection }}</span>
      </div>
      @if (status() === 'ok' && cards().length > 0) {
        <ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (card of cards(); track card.key) {
            <li>
              <div [class]="card_">
                @if (card.image) {
                  <img [src]="card.image" alt="" loading="lazy" class="-mx-6 -mt-6 mb-4 aspect-video w-[calc(100%+3rem)] max-w-none object-cover" />
                }
                <h3 class="text-base font-semibold leading-none tracking-tight">{{ card.title || ('cms.untitled' | translate) }}</h3>
                @if (card.description) {
                  <p class="mt-2 line-clamp-3 text-sm text-muted-foreground">{{ card.description }}</p>
                }
                @if (card.date) {
                  <time [attr.datetime]="card.publishedAt" class="mt-3 block text-xs text-muted-foreground">{{ card.date }}</time>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <div [class]="hint" role="status">
          @switch (status()) {
            @case ('loading') { {{ 'cms.loading' | translate }} }
            @case ('ok') { {{ 'cms.empty' | translate: { type: collection } }} }
            @case ('off') { {{ 'cms.off' | translate: { secret: secret } }} }
            @default { {{ 'cms.error' | translate }} }
          }
        </div>
      }
    </section>
  `,
})
export class CmsSectionComponent {
  protected readonly collection = CMS_COLLECTION;
  protected readonly secret = ${{ (values.name + '-strapi') | dump }};
  protected readonly badge = badgeVariants({ variant: 'outline' });
  protected readonly card_ = cn(cardVariants({ padding: 'default' }), 'h-full overflow-hidden');
  protected readonly hint = cn(cardVariants({ padding: 'default' }), 'mt-6 text-sm text-muted-foreground');
  protected readonly status = signal<'loading' | CmsResult['status']>('loading');
  protected readonly cards = signal<Card[]>([]);
  private readonly language = injectLanguage();

  constructor() {
    effect((onCleanup) => {
      const language = this.language();
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      this.status.set('loading');
      void fetchCollection(CMS_COLLECTION, { locale: language, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });
        this.cards.set(
          result.status === 'ok'
            ? result.entries.map((entry) => {
                const published = typeof entry.publishedAt === 'string' ? new Date(entry.publishedAt) : null;
                return {
                  key: String(entry.documentId ?? entry.id),
                  title: textField(entry, 'title', 'name', 'heading'),
                  description: textField(entry, 'description', 'summary', 'excerpt'),
                  image: imageUrl(entry, 'cover', 'image', 'thumbnail'),
                  publishedAt: entry.publishedAt ?? '',
                  date: published && !Number.isNaN(published.valueOf()) ? date.format(published) : '',
                };
              })
            : [],
        );
        this.status.set(result.status);
      });
    });
  }
}
{%- else -%}
// Content from Strapi is off for this app (scaffolded with withCms: false). To
// turn it on later, scaffold a new app with it to see the pieces: this module,
// the /cms/ and /uploads/ locations in nginx-app.conf, and the Secret
// <app>-strapi in deploy/base/rollout.yaml.
export {};
{%- endif %}
