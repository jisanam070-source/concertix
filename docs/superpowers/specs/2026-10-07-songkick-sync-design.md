# Songkick event sync for Concertix — design

Date: 2026-10-07
Status: approved in conversation, pending written review

## Goal

Show every upcoming concert listed on songkick.com, for every Songkick metro area, on the Concertix site. Events must appear without manual work and disappear once their date has passed.

## Constraints and facts

- The site is one static file, `Concertix.html`, with no backend. It stays static.
- Songkick has no public JSON event feed. Event data is embedded in server-rendered HTML as schema.org `MusicEvent` JSON-LD (one `<script type="application/ld+json">` per event).
- Songkick's sitemap index (`/sitemap.xml`) lists `sitemap/metro_areas.{0,1}.xml.gz` (4,895 distinct metro areas) and `sitemap/concerts.{0..5}.xml.gz` (about 115,000 upcoming concerts).
- A metro calendar page `/metro-areas/{id}-{slug}?page=N` lists 50 events per page with full JSON-LD. A full crawl is roughly 7,000 requests.
- Songkick's edge returns HTTP 406 to plain curl. Node `fetch` with browser-like `User-Agent`, `Accept` and `Accept-Language` headers returns 200.
- Browsers cannot fetch songkick.com cross-origin, so the crawl runs server-side on a schedule.
- Scraping songkick.com is against Songkick's terms of use. The user accepts this risk. The fetch layer is isolated so it can be replaced by the official API (`api.songkick.com/api/3.0`, approved key) later.
- Hosting: GitHub Pages, deployed from a GitHub Actions artifact. The project becomes a git repository.

## Architecture

```
GitHub Actions (daily cron + manual)
  └─ node scripts/sync-songkick.mjs
       ├─ fetch sitemaps  → list of metro areas
       ├─ for each metro: fetch calendar pages → parse JSON-LD → normalize
       └─ write dist/data/index.json + dist/data/metros/{id}.json
  └─ copy Concertix.html → dist/index.html
  └─ deploy dist/ to GitHub Pages (actions/deploy-pages)

Browser
  └─ index.html loads data/index.json → city picker
       └─ loads data/metros/{id}.json → filters out past dates → renders
```

Data is never committed to git. Each run rebuilds `dist/` from scratch, so events that Songkick no longer lists (past or cancelled) vanish automatically.

## Components

### 1. `scripts/songkick/fetch.mjs`
Single exported `fetchText(url)` wrapping Node `fetch` with browser-like headers, a 30 s timeout, up to 3 retries with exponential backoff on network errors and HTTP 429/5xx, and a global rate limit of 2 requests per second. Also `fetchGzipText(url)` for sitemaps. This is the only module that talks to Songkick.

### 2. `scripts/songkick/sitemap.mjs`
`listMetroAreas(fetchGzipText)` → reads `sitemap/metro_areas.0.xml.gz` and `.1`, extracts `<loc>` URLs, reduces them to distinct `{id, slug, url}` by stripping `/this-weekend`, `/november-2026` etc. suffixes.

### 3. `scripts/songkick/parse.mjs`
`parseMetroPage(html)` → `{events: NormalizedEvent[], lastPage: number, upcomingCount: number|null}`.
- Events come from every `application/ld+json` block whose `@type` is `MusicEvent`.
- `lastPage` is the maximum `page=N` in pagination links (1 if none).
- Pure function, no I/O, tested against fixture HTML saved from a real metro page.

`NormalizedEvent`:
```
{
  id: "sk-43255357",            // "sk-" + Songkick concert id from the URL
  artist: "Last Dinosaurs",     // first performer name
  support: "with Together PANGEA", // other performers joined, or "" 
  genre: "indie",               // one of Concertix's six keys, see mapping
  skGenres: ["indie_alternative","rock"],
  venue: { name, city, region, country, lat, lng },
  date: "2026-10-07T19:00:00",  // ISO as given; date-only values stay "YYYY-MM-DD"
  image: "https://images.sk-static.com/.../huge_avatar",
  url: "https://www.songkick.com/concerts/43255357-..." // utm params stripped
  status: "scheduled" | "cancelled" | "postponed"
}
```

Genre mapping (Songkick → Concertix): `indie_alternative, pop → indie`; `electronic, dance, house, techno → electronic`; `jazz, funk_soul, blues → jazz`; `rock, metal, punk → rock`; `hip_hop, rap, rnb → hiphop`; `folk_blues, country, acoustic, singer_songwriter, classical → acoustic`. First matching performer genre wins; no match or no genre → `indie`. The mapping lives in `scripts/songkick/genres.mjs` and is unit-tested.

### 4. `scripts/sync-songkick.mjs` (orchestrator)
- Reads options: `--out dist/data` (default), `--limit N` (dry run: only the first N metros), `--concurrency 4`.
- For each metro: fetch page 1, read `lastPage`, fetch remaining pages, concatenate, dedupe by `id`, drop events whose date is before today (UTC), sort by date.
- Writes `metros/{id}.json` as `{id, slug, name, country, updatedAt, events}`. `name` and `country` come from the page `<title>` and the first event's address, falling back to the slug.
- Writes `index.json`: `{updatedAt, metros: [{id, slug, name, country, count}]}` for metros with at least one event, sorted by count desc.
- Writes `summary.json` with totals and a list of failed metros.
- Failure handling: a metro that fails after retries is logged and skipped. If a previous `index.json` exists in `--out` and that metro had data, its old file is kept (the workflow restores the previous deploy's data as a cache before running). If more than 20% of metros fail, the script exits non-zero so the deploy is skipped and yesterday's site stays live.
- Progress is printed every 100 metros; the run must finish within the Actions job limit (6 h). Expected time about 1 h at 2 req/s.

### 5. `.github/workflows/sync.yml`
- Triggers: `schedule: "17 4 * * *"` (daily, UTC) and `workflow_dispatch`.
- Steps: checkout, setup Node 22, restore `dist/data` from the previous run's cache (actions/cache keyed by date, restore-keys fallback), run the sync script, copy `Concertix.html` to `dist/index.html`, upload Pages artifact, deploy.
- Permissions: `pages: write`, `id-token: write`.

### 6. `Concertix.html` changes
- Remove the hardcoded `EVENTS` and `VENUES` arrays. `GENRES` stays.
- Add a city picker in the header: a search input over `index.json` metros (name + country), showing count, with the top 8 matches. The chosen metro id is stored in `localStorage` (`concertix-metro`). First visit defaults to the largest metro in the index.
- On metro change: fetch `data/metros/{id}.json`, build the in-memory list `EVENTS` with `d: new Date(date)` and `v: venue`, filter `d >= today`, and re-render pills, grid, agenda, tours strip, and hero "next show".
- Card and agenda templates: venue line uses `venue.name, venue.city`; the price block is replaced by a "Tickets on Songkick" link (`target=_blank rel=noopener`) to `event.url`; availability badge is replaced by status (`Cancelled` / `Postponed` shown as a badge, scheduled shows nothing). Poster art keeps the existing generative SVG seeded by id, and uses `image` as a background when present.
- Existing city `<select id="city">` filter becomes the metro picker; the sort option "hot" (by sold) is removed.
- Saved shows and follows keep working with the new ids.
- Loading and error states: a skeleton while fetching, and an inline message with a retry button if a fetch fails.
- Everything is relative-path (`data/...`) so it works on GitHub Pages and from a local static server.

## Testing

- `node --test` unit tests (no framework): `parse.test.mjs` on a fixture metro page (50 events, pagination, date-only startDate, cancelled event), `genres.test.mjs`, `sitemap.test.mjs` on a fixture sitemap snippet, and an orchestrator test with a stubbed fetch that checks dedupe, past-date filtering, the keep-old-data-on-failure rule, and the 20% failure threshold.
- Dry run: `node scripts/sync-songkick.mjs --limit 3` against the live site, then `npx serve dist` and open the site to check the picker, cards and filters.
- The workflow is verified by a manual `workflow_dispatch` run after pushing.

## Out of scope

- Prices, ticket availability, and sold percentages (not on Songkick).
- Festivals (`/festivals/...` pages) and livestreams.
- Server-side search across all cities; the picker searches city names only, event search stays within the chosen city.
- The official Songkick API integration (the fetch module is the seam for it).
