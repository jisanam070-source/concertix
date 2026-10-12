// Orchestrates a full crawl: every metro → per-metro JSON + index + summary.
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseMetroPage } from "./parse.mjs";

const FAILURE_THRESHOLD = 0.2;

// Events are dated in venue-local time and the job runs at 04:17 UTC, when it is
// still the previous evening across the Americas. Keep yesterday (UTC) so
// tonight's shows stay listed; the browser then filters by the viewer's own date.
export function cutoffDate(now = new Date()) {
  return new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
}

export async function crawlMetro(metro, fetchText, today) {
  const first = parseMetroPage(await fetchText(metro.url));
  const all = [...first.events];
  for (let p = 2; p <= first.lastPage; p++) {
    const { events } = parseMetroPage(await fetchText(`${metro.url}?page=${p}`));
    if (events.length === 0) break;
    all.push(...events);
  }
  const seen = new Set();
  const events = all
    .filter(e => e.date.slice(0, 10) >= today)
    .filter(e => !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { events, metroName: first.metroName };
}

async function readPrevious(outDir, id) {
  try { return JSON.parse(await readFile(join(outDir, "metros", `${id}.json`), "utf8")); } catch { return null; }
}

export async function syncMetros({ metros, fetchText, outDir, today, concurrency = 4, log = () => {} }) {
  const metrosDir = join(outDir, "metros");
  await mkdir(metrosDir, { recursive: true });
  const updatedAt = new Date().toISOString();
  const indexEntries = []; const failed = []; let ok = 0; let eventTotal = 0; let done = 0;

  async function one(metro) {
    try {
      const { events, metroName } = await crawlMetro(metro, fetchText, today);
      ok++;
      if (events.length > 0) {
        const name = metroName || metro.slug; const country = events[0].venue.country || "";
        await writeFile(join(metrosDir, `${metro.id}.json`), JSON.stringify({ id: metro.id, slug: metro.slug, name, country, updatedAt, events }));
        indexEntries.push({ id: metro.id, slug: metro.slug, name, country, count: events.length });
        eventTotal += events.length;
      }
    } catch (e) {
      failed.push({ id: metro.id, error: String(e.message || e) });
      // Keep yesterday's data for this metro, minus anything that has since passed.
      const prev = await readPrevious(outDir, metro.id);
      const kept = (prev?.events || []).filter(e => String(e.date).slice(0, 10) >= today);
      if (kept.length) {
        await writeFile(join(metrosDir, `${metro.id}.json`), JSON.stringify({ ...prev, events: kept }));
        indexEntries.push({ id: prev.id, slug: prev.slug, name: prev.name, country: prev.country, count: kept.length });
        eventTotal += kept.length;
      }
    }
    if (++done % 100 === 0) log(`${done}/${metros.length} metros, ${eventTotal} events, ${failed.length} failed`);
  }

  const queue = [...metros];
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) await one(queue.shift());
  }));

  const summary = { updatedAt, total: metros.length, ok, failed, events: eventTotal };
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  if (failed.length > FAILURE_THRESHOLD * metros.length) throw new Error(`Too many failures: ${failed.length} of ${metros.length}`);
  // Drop files for metros that now have no upcoming events or left the sitemap,
  // so stale data restored from the previous run's cache never resurfaces.
  const live = new Set(indexEntries.map(m => `${m.id}.json`));
  for (const f of await readdir(metrosDir)) if (f.endsWith(".json") && !live.has(f)) await unlink(join(metrosDir, f));
  indexEntries.sort((a, b) => b.count - a.count || a.id - b.id);
  await writeFile(join(outDir, "index.json"), JSON.stringify({ updatedAt, metros: indexEntries }));
  return summary;
}
