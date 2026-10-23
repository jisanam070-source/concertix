// Adds Ticketmaster-only shows into the per-city files. Each show goes to the
// nearest Songkick metro (by the median position of that metro's events) when
// one is within 80 km; otherwise it goes into a new Ticketmaster-only city.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_KM = 80;
const NEW_METRO_BASE = 9000000;

const median = a => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const located = e => Number.isFinite(e?.venue?.lat) && Number.isFinite(e?.venue?.lng) && Math.abs(e.venue.lat) <= 90 && Math.abs(e.venue.lng) <= 180;

export function metroCentroids(metros) {
  const out = [];
  for (const m of metros) {
    const pts = (m.events || []).filter(located);
    if (pts.length === 0) continue;
    out.push({ id: m.id, name: m.name, country: m.country, lat: median(pts.map(e => e.venue.lat)), lng: median(pts.map(e => e.venue.lng)) });
  }
  return out;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function nearestMetro(lat, lng, centroids, maxKm = MAX_KM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null, bestD = Infinity;
  for (const c of centroids) { const d = distanceKm(lat, lng, c.lat, c.lng); if (d < bestD) { bestD = d; best = c; } }
  return bestD <= maxKm ? best : null;
}

// Ticketmaster spells some cities two ways ("Ft Lauderdale" and "Fort Lauderdale").
export function cityName(city) {
  return String(city || "").trim().replace(/^ft\.?\s+/i, "Fort ").replace(/^st\.?\s+/i, "Saint ").replace(/^mt\.?\s+/i, "Mount ");
}

export function metroIdFor(city, region, country) {
  const key = `${cityName(city)}|${region}|${country}`.toLowerCase();
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return NEW_METRO_BASE + (h % 999999);
}

const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function mergeShows({ dataDir, shows, matchedIds = new Set(), today }) {
  const metrosDir = join(dataDir, "metros");
  const metros = [];
  for (const f of (await readdir(metrosDir)).filter(f => f.endsWith(".json"))) {
    try { metros.push(JSON.parse(await readFile(join(metrosDir, f), "utf8"))); } catch {}
  }
  const byId = new Map(metros.map(m => [m.id, m]));
  // Centroids come from Songkick's events only, so a previous run's Ticketmaster additions cannot drift them.
  const centroids = metroCentroids(metros.map(m => ({ ...m, events: (m.events || []).filter(e => e.source !== "ticketmaster") })));
  const stats = { added: 0, newMetros: 0, skippedMatched: 0, skippedPast: 0 };
  const touched = new Set();
  for (const s of shows) {
    if (String(s.date).slice(0, 10) < today) { stats.skippedPast++; continue; }
    if (matchedIds.has(s.id)) { stats.skippedMatched++; continue; }
    let target = nearestMetro(s.venue?.lat, s.venue?.lng, centroids);
    let metro = target && byId.get(target.id);
    if (!metro) {
      const id = metroIdFor(s.venue.city, s.venue.region, s.venue.country);
      metro = byId.get(id);
      if (!metro) {
        const name = [cityName(s.venue.city), s.venue.region].filter(Boolean).join(", ") || "Unknown";
        metro = { id, slug: slugify(name), name, country: s.venue.country || "", source: "ticketmaster", updatedAt: new Date().toISOString(), events: [] };
        byId.set(id, metro); metros.push(metro); stats.newMetros++;
      }
    }
    if (metro.events.some(e => e.id === s.id)) continue;
    metro.events.push(s); stats.added++; touched.add(metro.id);
  }
  for (const id of touched) {
    const m = byId.get(id);
    m.events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    await writeFile(join(metrosDir, `${id}.json`), JSON.stringify(m));
  }
  // Recount the index from the files, keeping its order rule: most shows first.
  let index; try { index = JSON.parse(await readFile(join(dataDir, "index.json"), "utf8")); } catch { index = { updatedAt: new Date().toISOString(), metros: [] }; }
  const entries = new Map(index.metros.map(m => [m.id, m]));
  for (const m of metros) {
    const count = (m.events || []).filter(e => String(e.date).slice(0, 10) >= today).length;
    if (count === 0) { entries.delete(m.id); continue; }
    entries.set(m.id, { id: m.id, slug: m.slug, name: m.name, country: m.country, count });
  }
  index.metros = [...entries.values()].sort((a, b) => b.count - a.count || a.id - b.id);
  await writeFile(join(dataDir, "index.json"), JSON.stringify(index));
  return stats;
}
