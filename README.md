# Concertix

A static concert listings site fed by a daily crawl of songkick.com. Every Songkick metro area is crawled, upcoming events are written to one JSON file per city, and the site loads the chosen city's file at runtime. Past events disappear on each run because Songkick only lists upcoming shows, and the page also filters by date.

## Layout

- `Concertix.html` — the site (single file, no build step).
- `scripts/sync-songkick.mjs` — the crawler CLI.
- `scripts/songkick/` — `fetch.mjs` (the only module that talks to Songkick), `sitemap.mjs`, `parse.mjs`, `genres.mjs`, `sync.mjs`.
- `tests/` — `node --test` unit tests with HTML fixtures.
- `.github/workflows/sync.yml` — daily crawl + GitHub Pages deploy.
- `songkick-endpoints.md` — endpoints observed in the HAR captures.

## Run locally

```bash
npm test
```

Crawl three metro areas only (about a minute):

```bash
npm run sync -- --limit 3
```

Serve the site with that data:

```bash
cp Concertix.html dist/index.html && python3 -m http.server -d dist 8080
```

Then open http://localhost:8080.

Full crawl (about 7,000 requests at 2 per second, roughly an hour):

```bash
npm run sync
```

Output goes to `dist/data/index.json`, `dist/data/metros/<id>.json` and `dist/data/summary.json`.

## Deploy with GitHub Pages

1. Push this repository to GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Sync Songkick and deploy" → Run workflow. It then runs every day at 04:17 UTC.

If more than 20% of metro areas fail to crawl, the job fails and the previous deploy stays live.

## Note on data source

The crawler reads public songkick.com pages, which Songkick's terms of use do not permit. `scripts/songkick/fetch.mjs` is the single seam to replace with the official API (https://www.songkick.com/developer) once you have a key.
