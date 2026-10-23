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

## Ticketmaster shows and ticket links

After the crawl, `scripts/sync-ticketmaster.mjs` talks to the official Ticketmaster Discovery API and does two things:

1. **Adds shows.** It pulls every upcoming event at the venues listed in `data/ticketmaster-venues.json` (2,145 US and Canadian venues, from the Pathfinder export of 2026-10-20) and adds the ones Songkick does not have. Each goes into the nearest Songkick city within 80 km, or into a new city named after the venue's town. Sports, comedy and theatre land in the "Comedy, Sports & More" genre. Events are refetched from today onward on every run, so past ones disappear automatically.
2. **Links tickets.** It matches Ticketmaster events to Songkick shows by venue, date, artist and start time and puts a "Buy tickets" link to the exact Ticketmaster page on the show page. Only confident matches are linked.

Details:
- The key comes from `TICKETMASTER_API_KEY`: a GitHub Actions secret for the daily run, or a git-ignored `.env` file locally. Without it the step is skipped.
- Venue ids are sent in batches, so all venues cost roughly 400 requests a run. The market-wide pull for ticket links costs about 2,000 more. The run is capped at 4,500 of the key's 5,000 daily requests. If it stops early, shows beyond that date keep the previous run's links from `cache/tm-matches.json`.
- Ticket-link coverage is highest in the US and UK. Germany and Austria are mostly sold by Eventim, and France is not in the API.

Try it locally on a few states and 60 days:

```bash
node scripts/sync-ticketmaster.mjs --days 60 --states NY,CA,IL --countries US,GB
```

Flags: `--no-venues` skips adding shows, `--no-markets` skips the market-wide pull, `--budget N` caps requests.

## Deploy with GitHub Pages

1. Push this repository to GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Sync Songkick and deploy" → Run workflow. It then runs every day at 04:17 UTC.

If more than 20% of metro areas fail to crawl, the job fails and the previous deploy stays live.

## Note on data source

The crawler reads public songkick.com pages, which Songkick's terms of use do not permit. `scripts/songkick/fetch.mjs` is the single seam to replace with the official API (https://www.songkick.com/developer) once you have a key.
