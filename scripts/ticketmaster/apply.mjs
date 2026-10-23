// Writes Ticketmaster tickets into the per-city show files. Shows dated before
// `coveredUntil` were fully searched this run, so their result is authoritative
// (a link, or none). Later shows keep last run's link from the cache.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { indexTmEvents, matchEvent, toTicket } from "./match.mjs";

async function readJson(p, fallback) { try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; } }

export async function applyTickets({ dataDir, cachePath, tmEvents, coveredUntil, today }) {
  const index = indexTmEvents(tmEvents);
  const oldCache = await readJson(cachePath, {});
  const cache = {};
  for (const [id, t] of Object.entries(oldCache)) if (t && String(t.date) >= today) cache[id] = t;
  const stats = { shows: 0, covered: 0, matched: 0, fromCache: 0, matchedTmIds: new Set() };
  const metrosDir = join(dataDir, "metros");
  for (const f of (await readdir(metrosDir)).filter(f => f.endsWith(".json"))) {
    const p = join(metrosDir, f); const metro = await readJson(p, null);
    if (!metro?.events) continue;
    for (const ev of metro.events) {
      stats.shows++;
      const day = String(ev.date).slice(0, 10);
      delete ev.tickets;
      if (day < coveredUntil) {
        stats.covered++;
        const hit = matchEvent(ev, index); const ticket = hit && toTicket(hit);
        if (ticket) { ev.tickets = [ticket]; cache[ev.id] = { ...ticket, date: day }; stats.matched++; stats.matchedTmIds.add(`tm-${hit.id}`); }
        else delete cache[ev.id];
      } else if (cache[ev.id]) {
        const { date, ...ticket } = cache[ev.id];
        ev.tickets = [ticket]; stats.fromCache++;
      }
    }
    await writeFile(p, JSON.stringify(metro));
  }
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache));
  return stats;
}
