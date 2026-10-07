# Songkick Event Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crawl every Songkick metro area daily, publish per-city event JSON to GitHub Pages, and make `Concertix.html` render those events with a city picker, dropping past events automatically.

**Architecture:** A dependency-free Node crawler (`scripts/songkick/*.mjs`) with one fetch seam, pure parser and sitemap modules, and an orchestrator that writes `dist/data/`. A GitHub Actions workflow runs it on a cron and deploys `dist/` as a Pages artifact. The static site fetches `data/index.json` and `data/metros/{id}.json` at runtime.

**Tech Stack:** Node 22 (built-in `fetch`, `node:test`, `node:zlib`), GitHub Actions, GitHub Pages, vanilla HTML/JS.

**Spec:** `docs/superpowers/specs/2026-10-07-songkick-sync-design.md`

## Global Constraints

- Node `>=22`, zero npm dependencies at runtime or test time. `package.json` has `"type": "module"`.
- Every request to songkick.com goes through `scripts/songkick/fetch.mjs` and carries exactly these headers: `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`, `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`, `Accept-Language: en-US,en;q=0.9`.
- Rate limit 2 requests/second globally; 30 s timeout; 3 retries with backoff 1 s, 2 s, 4 s on network errors and HTTP 429/5xx only.
- Event ids are `"sk-" + <songkick concert id>`. Dates are stored as the ISO string Songkick gives (`YYYY-MM-DDTHH:mm:ss` or `YYYY-MM-DD`). "Past" means `date.slice(0,10) < todayISO` where `todayISO` is `YYYY-MM-DD` in UTC on the server and local time in the browser.
- Genre keys are exactly `indie, electronic, jazz, rock, hiphop, acoustic`.
- `dist/` is gitignored; data is never committed.
- Commit after every task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A metro with zero events (no JSON-LD, no pagination): must produce no file and no index entry, not an empty page crash. Pinned in Task 5 (`skips metros with no events`).
2. A JSON-LD block that is not valid JSON: the rest of the page's events must still parse. Pinned in Task 4 (`ignores malformed ld+json blocks`).
3. A date-only `startDate` like `2026-11-19`: must be kept, sorted correctly, and rendered as "Time TBA". Pinned in Task 4 and Task 8.
4. Browser fetch of `data/metros/{id}.json` returns 404 (metro dropped between runs): the page must show the error state with a retry button, not a blank grid. Pinned in Task 7 (manual check).
5. An event happening today at 19:00 viewed at 20:00: must still show (filter is by date, not time). Pinned in Task 7 (`isUpcoming` check) and Task 5 (`keeps events dated today`).

---

### Task 1: Project scaffold and fetch module

**Files:**
- Create: `package.json`, `.gitignore`, `scripts/songkick/fetch.mjs`
- Test: `tests/fetch.test.mjs`

**Interfaces:**
- Produces: `createFetcher({ fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), minIntervalMs = 500, timeoutMs = 30000 }) => { fetchText(url): Promise<string>, fetchGzipText(url): Promise<string> }`. Both throw `Error` with message `HTTP <status> <url>` on a final non-2xx response. `fetchGzipText` gunzips the body with `node:zlib` `gunzipSync`. Default export: `createFetcher()`.

- [ ] **Step 1: Create `package.json` and `.gitignore`**

`package.json`: `{"name":"concertix","private":true,"type":"module","engines":{"node":">=22"},"scripts":{"test":"node --test tests/","sync":"node scripts/sync-songkick.mjs"}}`. `.gitignore`: `dist/`, `node_modules/`, `.DS_Store`.

- [ ] **Step 2: Write the failing tests**

```js
// tests/fetch.test.mjs
import test from "node:test"; import assert from "node:assert/strict"; import { gzipSync } from "node:zlib";
import { createFetcher } from "../scripts/songkick/fetch.mjs";
const res = (status, body) => ({ ok: status < 300, status, text: async () => body, arrayBuffer: async () => body });
test("sends browser headers and returns text", async () => {
  let seen; const f = createFetcher({ fetchImpl: async (u, o) => { seen = o.headers; return res(200, "hi"); }, sleep: async () => {} });
  assert.equal(await f.fetchText("https://x/"), "hi");
  assert.match(seen["User-Agent"], /Chrome\/130/); assert.match(seen["Accept"], /text\/html/); assert.equal(seen["Accept-Language"], "en-US,en;q=0.9");
});
test("retries on 503 then succeeds, with backoff 1s,2s", async () => {
  const calls = []; const waits = []; let n = 0;
  const f = createFetcher({ fetchImpl: async () => { calls.push(++n); return n < 3 ? res(503, "") : res(200, "ok"); }, sleep: async ms => { waits.push(ms); } });
  assert.equal(await f.fetchText("https://x/"), "ok"); assert.equal(calls.length, 3);
  assert.deepEqual(waits.filter(w => w >= 1000), [1000, 2000]);
});
test("does not retry on 406 and throws HTTP 406", async () => {
  let n = 0; const f = createFetcher({ fetchImpl: async () => { n++; return res(406, ""); }, sleep: async () => {} });
  await assert.rejects(f.fetchText("https://x/y"), /HTTP 406 https:\/\/x\/y/); assert.equal(n, 1);
});
test("gives up after 3 retries", async () => {
  let n = 0; const f = createFetcher({ fetchImpl: async () => { n++; return res(500, ""); }, sleep: async () => {} });
  await assert.rejects(f.fetchText("https://x/")); assert.equal(n, 4);
});
test("fetchGzipText gunzips", async () => {
  const f = createFetcher({ fetchImpl: async () => res(200, gzipSync("<x/>")), sleep: async () => {} });
  assert.equal(await f.fetchGzipText("https://x/a.gz"), "<x/>");
});
test("spaces requests by minIntervalMs", async () => {
  const waits = []; const f = createFetcher({ fetchImpl: async () => res(200, ""), sleep: async ms => { waits.push(ms); }, minIntervalMs: 500 });
  await f.fetchText("https://x/1"); await f.fetchText("https://x/2");
  assert.ok(waits.some(w => w > 0 && w <= 500));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`. Expected: FAIL, cannot find module `fetch.mjs`.

- [ ] **Step 4: Implement `createFetcher` in `scripts/songkick/fetch.mjs`**

Keep `lastRequestAt` in the closure; before each request `await sleep(max(0, lastRequestAt + minIntervalMs - Date.now()))`. Use `AbortSignal.timeout(timeoutMs)`. Retry loop: attempts 0..3, backoff `1000 * 2**attempt` only when the error is a network error or status is 429 or >= 500.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`. Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore scripts/songkick/fetch.mjs tests/fetch.test.mjs
git commit -m "feat: add rate-limited Songkick fetcher with retries"
```

---

### Task 2: Sitemap metro list

**Files:**
- Create: `scripts/songkick/sitemap.mjs`, `tests/fixtures/metro_areas.snippet.xml`
- Test: `tests/sitemap.test.mjs`

**Interfaces:**
- Consumes: `fetchGzipText(url)` from Task 1.
- Produces: `listMetroAreas(fetchGzipText) => Promise<Array<{id: number, slug: string, url: string}>>`, sorted by id, distinct. `url` is `https://www.songkick.com/metro-areas/{id}-{slug}`. Fetches `https://www.songkick.com/sitemap/metro_areas.0.xml.gz` and `.1.xml.gz`. Also exports `parseMetroSitemap(xml) => same array` (pure).

- [ ] **Step 1: Create the fixture**

`tests/fixtures/metro_areas.snippet.xml`: a valid `<urlset>` with these `<loc>` values: `https://www.songkick.com/metro-areas/28-us-brownsville`, `.../28-us-brownsville/this-weekend`, `.../28-us-brownsville/november-2026`, `https://www.songkick.com/metro-areas/11086-us-san-diego/this-month`, `https://www.songkick.com/metro-areas/57563-germany-crailsheim`.

- [ ] **Step 2: Write the failing tests**

```js
test("parseMetroSitemap dedupes and strips suffixes", () => {
  const xml = readFileSync(new URL("./fixtures/metro_areas.snippet.xml", import.meta.url), "utf8");
  assert.deepEqual(parseMetroSitemap(xml), [
    { id: 28, slug: "us-brownsville", url: "https://www.songkick.com/metro-areas/28-us-brownsville" },
    { id: 11086, slug: "us-san-diego", url: "https://www.songkick.com/metro-areas/11086-us-san-diego" },
    { id: 57563, slug: "germany-crailsheim", url: "https://www.songkick.com/metro-areas/57563-germany-crailsheim" }]);
});
test("listMetroAreas fetches both sitemap files and merges", async () => {
  const urls = []; const fake = async u => { urls.push(u); return `<urlset><url><loc>https://www.songkick.com/metro-areas/${urls.length}-a</loc></url></urlset>`; };
  const r = await listMetroAreas(fake);
  assert.deepEqual(urls, ["https://www.songkick.com/sitemap/metro_areas.0.xml.gz", "https://www.songkick.com/sitemap/metro_areas.1.xml.gz"]);
  assert.equal(r.length, 2);
});
```

- [ ] **Step 3: Run tests to verify they fail** — `npm test`, expect module not found.

- [ ] **Step 4: Implement `parseMetroSitemap` and `listMetroAreas` in `scripts/songkick/sitemap.mjs`**

Regex `/<loc>https:\/\/www\.songkick\.com\/metro-areas\/(\d+)-([^<\/]+)/g`; collect into a `Map` keyed by id.

- [ ] **Step 5: Run tests to verify they pass** — `npm test`.

- [ ] **Step 6: Commit** — `git add scripts/songkick/sitemap.mjs tests/sitemap.test.mjs tests/fixtures/metro_areas.snippet.xml && git commit -m "feat: list Songkick metro areas from sitemap"`

---

### Task 3: Genre mapping

**Files:**
- Create: `scripts/songkick/genres.mjs`
- Test: `tests/genres.test.mjs`

**Interfaces:**
- Produces: `mapGenre(skGenres: string[] | undefined) => "indie"|"electronic"|"jazz"|"rock"|"hiphop"|"acoustic"` and `GENRE_MAP: Record<string, key>`.

- [ ] **Step 1: Write the failing tests**

```js
test("maps first matching songkick genre", () => {
  assert.equal(mapGenre(["indie_alternative","rock"]), "indie");
  assert.equal(mapGenre(["rock","indie_alternative"]), "rock");
  assert.equal(mapGenre(["funk_soul"]), "jazz");
  assert.equal(mapGenre(["hip_hop"]), "hiphop");
  assert.equal(mapGenre(["techno"]), "electronic");
  assert.equal(mapGenre(["country"]), "acoustic");
  assert.equal(mapGenre(["classical"]), "acoustic");
});
test("unknown or missing genre falls back to indie", () => {
  assert.equal(mapGenre(["comedy"]), "indie"); assert.equal(mapGenre([]), "indie"); assert.equal(mapGenre(undefined), "indie");
});
```

- [ ] **Step 2: Run tests to verify they fail**, then **Step 3: implement** the map exactly as the spec lists: `indie_alternative, pop → indie`; `electronic, dance, house, techno → electronic`; `jazz, funk_soul, blues → jazz`; `rock, metal, punk → rock`; `hip_hop, rap, rnb → hiphop`; `folk_blues, country, acoustic, singer_songwriter, classical → acoustic`.

- [ ] **Step 4: Run tests to verify they pass**, then **Step 5: Commit** — `git commit -m "feat: map Songkick genres to Concertix genres"`

---

### Task 4: Metro page parser

**Files:**
- Create: `scripts/songkick/parse.mjs`, `tests/fixtures/metro-san-diego.html`, `tests/fixtures/metro-synthetic.html`
- Test: `tests/parse.test.mjs`

**Interfaces:**
- Consumes: `mapGenre` from Task 3.
- Produces: `parseMetroPage(html: string) => { events: NormalizedEvent[], lastPage: number, upcomingCount: number|null, metroName: string|null }`. `NormalizedEvent` is exactly the spec's shape: `{ id, artist, support, genre, skGenres, venue: { name, city, region, country, lat, lng }, date, image, url, status }`. `status` maps `eventStatus` ending in `EventCancelled → "cancelled"`, `EventPostponed → "postponed"`, anything else `"scheduled"`. `support` is `"with " + otherPerformers.join(", ")` or `""`. `url` has the query string removed. `metroName` is the `<title>` text before `" Concerts"` or null.

- [ ] **Step 1: Create fixtures**

Copy the real page: `cp "/private/tmp/claude-501/-Users-pulkit11-Downloads-concertixsss/8c411824-3899-4d6f-99b1-5ea3e409f64c/scratchpad/sd_node.html" tests/fixtures/metro-san-diego.html` (50 events, pagination to page 16, title "San Diego Concerts, Festivals, Tickets & Tour Dates 2026 & 2027 – Songkick", text "752 upcoming"). If that path is gone, fetch it again with `createFetcher().fetchText("https://www.songkick.com/metro-areas/11086-us-san-diego")`.

`tests/fixtures/metro-synthetic.html`: a minimal page containing `<title>Testville Concerts – Songkick</title>`, no pagination, and three `<script type="application/ld+json">` blocks: (a) a MusicEvent with `startDate: "2026-11-19"`, `eventStatus: "https://schema.org/EventCancelled"`, two performers `[{name:"A",genre:["funk_soul"]},{name:"B"}]`, url `https://www.songkick.com/concerts/1-a-at-x?utm_medium=organic&utm_source=microformat`, location with `addressLocality: "Testville", addressRegion: "TS", addressCountry: "US"`, geo lat 1, lng 2; (b) the literal text `{not json` ; (c) a `{"@type":"City"}` object.

- [ ] **Step 2: Write the failing tests**

```js
test("parses 50 events, pagination and metro name from the real page", () => {
  const r = parseMetroPage(read("metro-san-diego.html"));
  assert.equal(r.events.length, 50); assert.equal(r.lastPage, 16); assert.equal(r.upcomingCount, 752); assert.equal(r.metroName, "San Diego");
  const e = r.events[0];
  assert.equal(e.id, "sk-43255357"); assert.equal(e.artist, "Last Dinosaurs"); assert.equal(e.genre, "indie");
  assert.deepEqual(e.skGenres, ["indie_alternative","rock"]); assert.equal(e.date, "2026-10-07T19:00:00");
  assert.equal(e.url, "https://www.songkick.com/concerts/43255357-last-dinosaurs-at-observatory-north-park");
  assert.equal(e.venue.name, "Observatory North Park"); assert.equal(e.venue.city, "San Diego"); assert.equal(e.venue.country, "US");
  assert.equal(e.status, "scheduled"); assert.match(e.image, /^https:\/\/images\.sk-static\.com/);
});
test("synthetic page: date-only, cancelled, support, utm stripped, lastPage 1", () => {
  const r = parseMetroPage(read("metro-synthetic.html"));
  assert.equal(r.lastPage, 1); assert.equal(r.upcomingCount, null); assert.equal(r.metroName, "Testville");
  assert.equal(r.events.length, 1); const e = r.events[0];
  assert.equal(e.date, "2026-11-19"); assert.equal(e.status, "cancelled"); assert.equal(e.support, "with B"); assert.equal(e.genre, "jazz");
  assert.equal(e.url, "https://www.songkick.com/concerts/1-a-at-x"); assert.deepEqual(e.venue, { name: e.venue.name, city: "Testville", region: "TS", country: "US", lat: 1, lng: 2 });
});
test("ignores malformed ld+json blocks and non-MusicEvent types", () => {
  assert.doesNotThrow(() => parseMetroPage(read("metro-synthetic.html")));
});
test("empty page yields no events", () => {
  assert.deepEqual(parseMetroPage("<html><title>Nowhere – Songkick</title></html>"), { events: [], lastPage: 1, upcomingCount: null, metroName: null });
});
```

- [ ] **Step 3: Run tests to verify they fail**, **Step 4: implement `parseMetroPage`** (regex over `<script type="application/ld+json">...</script>`, `JSON.parse` in try/catch, accept arrays or single objects; `lastPage = max(1, ...page=N)`; `upcomingCount` from `/(\d[\d,]*)\s+upcoming/`; concert id from `/\/concerts\/(\d+)/` in `url`), **Step 5: run tests to verify they pass**.

- [ ] **Step 6: Commit** — `git add scripts/songkick/parse.mjs tests/parse.test.mjs tests/fixtures/metro-*.html && git commit -m "feat: parse Songkick metro pages into normalized events"`

---

### Task 5: Sync orchestrator and CLI

**Files:**
- Create: `scripts/songkick/sync.mjs`, `scripts/sync-songkick.mjs`
- Test: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: `listMetroAreas` (Task 2), `parseMetroPage` (Task 4), `createFetcher` (Task 1).
- Produces: `syncMetros({ metros, fetchText, outDir, today, concurrency = 4, log = () => {} }) => Promise<{ total, ok, failed: Array<{id, error}>, events }>` and `crawlMetro(metro, fetchText) => Promise<{ events, metroName }>` (fetches page 1, then `?page=2..lastPage`, stops early on a page with zero events, dedupes by id, filters `date.slice(0,10) >= today`, sorts by `date`). Writes files as the spec defines:
  - `outDir/metros/{id}.json` = `{ id, slug, name, country, updatedAt, events }` (only when `events.length > 0`)
  - `outDir/index.json` = `{ updatedAt, metros: [{ id, slug, name, country, count }] }` sorted by count desc
  - `outDir/summary.json` = `{ updatedAt, total, ok, failed, events }`
  - Throws `Error("Too many failures: X of Y")` when `failed.length > 0.2 * metros.length` (after writing summary.json, before writing index.json).
  - On a failed metro, if `outDir/metros/{id}.json` already exists, it is kept and its `count` is reused in the index.
- CLI `scripts/sync-songkick.mjs`: flags `--out <dir>` (default `dist/data`), `--limit <n>`, `--concurrency <n>`; logs progress every 100 metros; exit code 1 on throw.

- [ ] **Step 1: Write the failing tests** (stub `fetchText` returns synthetic pages built with a helper `page(events, lastPage)` that emits ld+json blocks; use `fs.mkdtempSync` for `outDir`; `today = "2026-10-07"`)

```js
test("crawlMetro follows pagination, dedupes, drops past, keeps today, sorts", async () => {
  const pages = { "https://www.songkick.com/metro-areas/1-x": page([ev("3","2026-10-09"), ev("2","2026-10-06")], 2), "https://www.songkick.com/metro-areas/1-x?page=2": page([ev("3","2026-10-09"), ev("1","2026-10-07")], 2) };
  const r = await crawlMetro({ id:1, slug:"x", url:"https://www.songkick.com/metro-areas/1-x" }, async u => pages[u], "2026-10-07");
  assert.deepEqual(r.events.map(e => e.id), ["sk-1","sk-3"]);
});
test("stops early when a page has zero events", ...); // lastPage 3, page 2 empty → page 3 never requested
test("skips metros with no events and writes index sorted by count", ...); // metro A 2 events, metro B 0 events → no metros/B.json, index has only A
test("keeps previous file for a failed metro and counts it in index", ...); // pre-write metros/9.json with 4 events; fetch throws for 9 → file unchanged, index count 4, summary.failed has id 9
test("throws when more than 20% of metros fail", ...); // 5 metros, 2 fail → rejects /Too many failures: 2 of 5/, summary.json exists, index.json does not
test("keeps events dated today", ...); // ev dated "2026-10-07T23:00:00" with today "2026-10-07" is kept
```

- [ ] **Step 2: Run tests to verify they fail**, **Step 3: implement `scripts/songkick/sync.mjs`** (a small worker pool of `concurrency` promises over the metro array; `country` = first event's `venue.country`; `name` = `metroName` or slug), **Step 4: implement the CLI** (parse `process.argv`, `listMetroAreas(fetcher.fetchGzipText)`, apply `--limit`, call `syncMetros` with `today = new Date().toISOString().slice(0,10)`), **Step 5: run tests to verify they pass**.

- [ ] **Step 6: Live dry run**

Run: `node scripts/sync-songkick.mjs --limit 3 --out dist/data`
Expected: exits 0; `dist/data/index.json` lists up to 3 metros; `ls dist/data/metros` shows their files; `node -e "const i=require('./dist/data/index.json');console.log(i.metros)"` prints names and counts.

- [ ] **Step 7: Commit** — `git add scripts/songkick/sync.mjs scripts/sync-songkick.mjs tests/sync.test.mjs && git commit -m "feat: sync orchestrator and CLI writing per-metro event JSON"`

---

### Task 6: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/sync.yml`, `README.md`

- [ ] **Step 1: Write the workflow**

Name `Sync Songkick and deploy`. Triggers: `schedule: - cron: "17 4 * * *"` and `workflow_dispatch`. `permissions: { contents: read, pages: write, id-token: write }`. `concurrency: { group: pages, cancel-in-progress: false }`. Job `sync` on `ubuntu-latest`, `timeout-minutes: 300`: `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: 22`; `actions/cache/restore@v4` with `path: dist/data`, `key: songkick-data-${{ github.run_id }}`, `restore-keys: songkick-data-`; `run: node scripts/sync-songkick.mjs --out dist/data`; `actions/cache/save@v4` same path and key (`if: always()`); `run: cp Concertix.html dist/index.html`; `actions/configure-pages@v5`; `actions/upload-pages-artifact@v3` with `path: dist`; `actions/deploy-pages@v4` with `id: deployment` and `environment: github-pages`.

- [ ] **Step 2: Validate YAML** — `node -e "console.log(require('fs').readFileSync('.github/workflows/sync.yml','utf8').length)"` and `npx -y yaml-lint .github/workflows/sync.yml` (dev-time only). Expected: no errors.

- [ ] **Step 3: Write README.md** — how to run tests, dry run (`npm run sync -- --limit 3`), serve locally (`python3 -m http.server -d dist 8080` after `cp Concertix.html dist/index.html`), and the GitHub Pages setup: repo Settings → Pages → Source "GitHub Actions"; then run the workflow manually once.

- [ ] **Step 4: Commit** — `git add .github/workflows/sync.yml README.md && git commit -m "ci: daily Songkick sync deployed to GitHub Pages"`

---

### Task 7: Site data loading and city picker

**Files:**
- Modify: `Concertix.html` — filter bar `355-358` (city select), script `441-477` (VENUES/EVENTS), `519-530` (state, genre select), `531-546` (inRange/filtered), `618-650` (event handlers), `654` (initial render)

**Interfaces:**
- Produces, inside the page IIFE: `let EVENTS = []`, `let METROS = []`, `async function loadIndex()`, `async function loadMetro(id)`, `function isUpcoming(e)` (`e.date.slice(0,10) >= localTodayISO()`), `function setEvents(list)` which rebuilds `EVENTS` (each with `d: new Date(e.date)` and `v: e.venue`), `byId`, and calls `render()` and `renderHero()`/`renderTours()` from Task 8.

- [ ] **Step 1: Replace the city `<select>` with a picker**

Markup replacing lines 355-358: `<label class="field"><span class="ms">location_on</span><input id="metroQ" type="search" placeholder="City" aria-label="City" autocomplete="off"><div class="metro-list" id="metroList" hidden role="listbox"></div></label>`. Add CSS for `.metro-list` (absolute, below the field, `var(--card)` background, `var(--shadow)`, max 8 rows of `button.metro-opt` showing `name, country` and a `<span class="n">count</span>`).

- [ ] **Step 2: Remove hardcoded data**

Delete `VENUES` and the `EVENTS` literal (lines 449-477). Keep `GENRES`. Declare `let EVENTS = [], byId = {}, METROS = [], currentMetro = null;`. Remove `city` from `state` and from `filtered()`; remove the `$("#city")` handlers and resets (lines 639, 647, 650).

- [ ] **Step 3: Implement loading**

`loadIndex()` fetches `data/index.json` → `METROS`. Picker: on `input`, show the top 8 metros whose `name + " " + country` includes the query (case-insensitive), ordered by count desc; on click, `selectMetro(m)` sets `currentMetro`, `localStorage["concertix-metro"] = m.id`, writes `m.name` into `#metroQ`, hides the list, calls `loadMetro(m.id)`. `loadMetro(id)` shows a skeleton in `#results` (`<div class="grid">` with 6 `article.card.skeleton` placeholders), fetches `data/metros/${id}.json`, then `setEvents(json.events.filter(isUpcoming))`. On any fetch failure render `#results` as `<div class="empty"><h3>Couldn't load shows</h3><p>Check your connection and try again.</p><button class="btn btn-accent" type="button" id="retryLoad">Retry</button></div>` and handle `#retryLoad` in the click delegator. Startup: `loadIndex()` then select the saved metro id if present in `METROS`, else `METROS[0]`.

- [ ] **Step 4: Fix `inRange` month options**

Replace the three hardcoded month `<option>`s (lines 347-349) with options generated at startup for the next 6 months (`value` = month index, label = month name), so December 2026 and January 2027 both work.

- [ ] **Step 5: Manual verification**

Run: `mkdir -p dist && cp Concertix.html dist/index.html && python3 -m http.server -d dist 8080`, open `http://localhost:8080` (data from Task 5's dry run must exist in `dist/data`). Expected: the picker lists the dry-run metros; choosing one renders its cards; reloading keeps the choice; renaming `dist/data/metros/<id>.json` and reloading shows the "Couldn't load shows" state with a working Retry; an event dated today still appears.

- [ ] **Step 6: Commit** — `git add Concertix.html && git commit -m "feat: load Songkick events per metro with a city picker"`

---

### Task 8: Site templates, hero and tours for Songkick data

**Files:**
- Modify: `Concertix.html` — `fmtTime` (509), `availability` (511), `cardHTML` (548-565), `agendaHTML` (566-575), `filtered` sort (545), sort `<select>` (374-378), tours (588-594), hero (596-607), modal markup (420-436) and modal script (609-627), click handlers for `data-book`/`data-wait` (635-636)

**Interfaces:**
- Consumes: `EVENTS`, `setEvents` from Task 7.
- Produces: `renderHero()`, `renderTours()`, `statusBadge(e)`, `fmtTimeOrTBA(d, e)`.

- [ ] **Step 1: Templates**

In `cardHTML` and `agendaHTML`: venue line `${esc(e.v.name)}, ${esc(e.v.city)}`; time via `fmtTimeOrTBA` which returns `"Time TBA"` when `e.date.length === 10`; replace the price block and availability with `statusBadge(e)` (`<span class="avail out"><i></i>Cancelled</span>` for cancelled, `<span class="avail fast"><i></i>Postponed</span>` for postponed, nothing for scheduled) and the button `<a class="btn btn-accent" href="${esc(e.url)}" target="_blank" rel="noopener">Tickets on Songkick</a>`. Card art: keep `artFor(e)`; when `e.image` is set, prepend `<img class="card-img" src="${esc(e.image)}" alt="" loading="lazy">` styled `position:absolute;inset:0;width:100%;height:100%;object-fit:cover` under the date chip. Remove the `sold` badge.

- [ ] **Step 2: Sort options**

Sort `<select>`: keep `date` only plus `<option value="az">A to Z</option>`; `filtered()` sort map becomes `{date:(a,b)=>a.date.localeCompare(b.date), az:(a,b)=>a.artist.localeCompare(b.artist)}`.

- [ ] **Step 3: Remove the booking modal**

Delete the modal markup (lines 420-436) and its script (`TIERS`, `openBook`, `updateTotal`, `closeBook`, their listeners, the `bookForm` submit). In the click delegator remove the `data-book` and `data-wait` branches. Hero button `#stubBtn` becomes `<a class="btn btn-accent" id="stubBtn" target="_blank" rel="noopener">Get tickets</a>` and `renderHero()` sets its `href` to `next.url`.

- [ ] **Step 4: Hero and tours as functions**

Wrap lines 596-607 in `renderHero()`: `next = EVENTS.filter(isUpcoming).sort(by date)[0]`; if none, hide `.hero-stub` parent via `hidden` and skip the countdown; keep a single interval that reads the current `next`. Wrap lines 588-594 in `renderTours()` building `artists` from `EVENTS` as before but splitting on `" b2b "` is no longer needed; take the 12 artists with the most events. `setEvents` calls `render(); renderHero(); renderTours();`.

- [ ] **Step 5: Manual verification**

Serve as in Task 7. Expected: cards show "Tickets on Songkick" opening the concert page in a new tab; a date-only event shows "Time TBA"; a cancelled event (edit one in the metro JSON to `"status":"cancelled"`) shows the Cancelled badge; hero shows the soonest upcoming show with a live countdown; tours strip lists artists from the chosen city; no console errors (`read_console_messages` or DevTools).

- [ ] **Step 6: Commit** — `git add Concertix.html && git commit -m "feat: render Songkick events with ticket links, status and hero"`

---

### Task 9: Publish and first live run

**Files:** none new.

- [ ] **Step 1: Run the full test suite** — `npm test`, expected all passing.
- [ ] **Step 2: Create the GitHub repository and push** — needs the user's confirmation (outward-facing): `gh repo create concertix --private --source . --push`.
- [ ] **Step 3: Enable Pages** — user sets Settings → Pages → Source: GitHub Actions (or `gh api -X POST repos/{owner}/concertix/pages -f build_type=workflow`).
- [ ] **Step 4: Trigger** — `gh workflow run sync.yml` then `gh run watch`. Expected: job completes in roughly 1 hour, `summary.json` in the deployed site shows `failed` under 20%, and the Pages URL renders the picker with thousands of cities.
