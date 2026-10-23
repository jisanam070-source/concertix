import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metroCentroids, nearestMetro, mergeShows, metroIdFor } from "../scripts/ticketmaster/merge.mjs";

const skShow = (id, date, lat, lng, venue = "V") => ({ id, artist: "A " + id, date, genre: "rock", venue: { name: venue, city: "Town", country: "US", lat, lng }, status: "scheduled" });
const tmShow = (id, date, lat, lng, venue = "W", city = "Town", region = "NY") => ({ id: "tm-" + id, artist: "T " + id, support: "", genre: "other", skGenres: [], date, venue: { name: venue, city, region, country: "US", lat, lng }, image: "", url: "https://www.ticketmaster.com/e/" + id, status: "scheduled", source: "ticketmaster", tickets: [] });
function setup(metros) {
  const dir = mkdtempSync(join(tmpdir(), "merge-")); const dataDir = join(dir, "data"); mkdirSync(join(dataDir, "metros"), { recursive: true });
  for (const m of metros) writeFileSync(join(dataDir, "metros", `${m.id}.json`), JSON.stringify(m));
  writeFileSync(join(dataDir, "index.json"), JSON.stringify({ updatedAt: "x", metros: metros.filter(m => m.events.length).map(m => ({ id: m.id, slug: m.slug, name: m.name, country: m.country, count: m.events.length })) }));
  return dataDir;
}
const read = p => JSON.parse(readFileSync(p, "utf8"));

test("metroCentroids takes the median position of a metro's located events", () => {
  const c = metroCentroids([{ id: 1, name: "NYC", country: "US", events: [skShow("a", "2026-11-01", 40.7, -74.0), skShow("b", "2026-11-01", 40.8, -73.9), skShow("c", "2026-11-01", 90, 90), skShow("d", "2026-11-01", null, null)] }]);
  assert.equal(c.length, 1); assert.equal(c[0].id, 1);
  assert.ok(Math.abs(c[0].lat - 40.8) < 0.01 && Math.abs(c[0].lng - (-73.9)) < 0.01, `median, not mean: ${c[0].lat},${c[0].lng}`);
});

test("nearestMetro returns the closest centroid within 80 km, else null", () => {
  const cents = [{ id: 1, lat: 40.75, lng: -73.98 }, { id: 2, lat: 41.88, lng: -87.63 }];
  assert.equal(nearestMetro(40.68, -73.94, cents)?.id, 1, "Brooklyn → NYC");
  assert.equal(nearestMetro(42.36, -71.06, cents), null, "Boston is 300 km from NYC");
  assert.equal(nearestMetro(null, null, cents), null);
});

test("metroIdFor gives a stable numeric id for a new Ticketmaster-only city", () => {
  const a = metroIdFor("Calgary", "AB", "CA");
  assert.equal(a, metroIdFor("Calgary", "AB", "CA"));
  assert.notEqual(a, metroIdFor("Edmonton", "AB", "CA"));
  assert.ok(Number.isInteger(a) && a >= 9000000 && a < 10000000);
});

test("mergeShows adds unmatched shows to the nearest metro and recounts the index", async () => {
  const dataDir = setup([{ id: 1, slug: "nyc", name: "NYC", country: "US", events: [skShow("sk-1", "2026-11-01", 40.75, -73.98), skShow("sk-2", "2026-11-02", 40.76, -73.97)] }]);
  const r = await mergeShows({ dataDir, shows: [tmShow("x", "2026-11-05", 40.68, -73.94), tmShow("y", "2026-11-06", 40.70, -73.95)], matchedIds: new Set(), today: "2026-10-23" });
  const m = read(join(dataDir, "metros", "1.json"));
  assert.deepEqual(m.events.map(e => e.id), ["sk-1", "sk-2", "tm-x", "tm-y"], "appended and still sorted by date");
  assert.equal(read(join(dataDir, "index.json")).metros[0].count, 4);
  assert.deepEqual(r, { added: 4 - 2, newMetros: 0, skippedMatched: 0, skippedPast: 0 });
});

test("mergeShows skips shows already matched to a Songkick show, and past shows", async () => {
  const dataDir = setup([{ id: 1, slug: "nyc", name: "NYC", country: "US", events: [skShow("sk-1", "2026-11-01", 40.75, -73.98)] }]);
  const r = await mergeShows({ dataDir, shows: [tmShow("dup", "2026-11-01", 40.75, -73.98), tmShow("old", "2026-10-01", 40.75, -73.98)], matchedIds: new Set(["tm-dup"]), today: "2026-10-23" });
  assert.equal(read(join(dataDir, "metros", "1.json")).events.length, 1);
  assert.equal(r.skippedMatched, 1); assert.equal(r.skippedPast, 1);
});

test("mergeShows creates a new city for shows far from every Songkick metro", async () => {
  const dataDir = setup([{ id: 1, slug: "nyc", name: "NYC", country: "US", events: [skShow("sk-1", "2026-11-01", 40.75, -73.98)] }]);
  const r = await mergeShows({ dataDir, shows: [tmShow("c1", "2026-11-03", 51.04, -114.05, "Saddledome", "Calgary", "AB"), tmShow("c2", "2026-11-04", 51.05, -114.06, "Palace", "Calgary", "AB")], matchedIds: new Set(), today: "2026-10-23" });
  const id = metroIdFor("Calgary", "AB", "US");
  const m = read(join(dataDir, "metros", `${id}.json`));
  assert.equal(m.name, "Calgary, AB"); assert.equal(m.country, "US"); assert.equal(m.events.length, 2); assert.equal(m.source, "ticketmaster");
  const idx = read(join(dataDir, "index.json")).metros;
  assert.deepEqual(idx.find(x => x.id === id), { id, slug: "calgary-ab", name: "Calgary, AB", country: "US", count: 2 });
  assert.equal(r.newMetros, 1);
});

test("mergeShows is idempotent: running twice does not duplicate shows", async () => {
  const dataDir = setup([{ id: 1, slug: "nyc", name: "NYC", country: "US", events: [skShow("sk-1", "2026-11-01", 40.75, -73.98)] }]);
  const shows = [tmShow("x", "2026-11-05", 40.68, -73.94)];
  await mergeShows({ dataDir, shows, matchedIds: new Set(), today: "2026-10-23" });
  await mergeShows({ dataDir, shows, matchedIds: new Set(), today: "2026-10-23" });
  assert.equal(read(join(dataDir, "metros", "1.json")).events.length, 2);
});

test("metroIdFor treats Ticketmaster's city spellings as one city", () => {
  assert.equal(metroIdFor("Ft Lauderdale", "FL", "US"), metroIdFor("Fort Lauderdale", "FL", "US"));
  assert.equal(metroIdFor("Ft. Worth", "TX", "US"), metroIdFor("Fort Worth", "TX", "US"));
  assert.equal(metroIdFor("St. Louis", "MO", "US"), metroIdFor("Saint Louis", "MO", "US"));
  assert.equal(metroIdFor("Mt Pleasant", "MI", "US"), metroIdFor("Mount Pleasant", "MI", "US"));
});

test("mergeShows names a new city with the full spelling", async () => {
  const dataDir = setup([{ id: 1, slug: "nyc", name: "NYC", country: "US", events: [skShow("sk-1", "2026-11-01", 40.75, -73.98)] }]);
  await mergeShows({ dataDir, shows: [tmShow("f1", "2026-11-03", 26.12, -80.14, "A", "Ft Lauderdale", "FL"), tmShow("f2", "2026-11-04", 26.13, -80.15, "B", "Fort Lauderdale", "FL")], matchedIds: new Set(), today: "2026-10-23" });
  const idx = read(join(dataDir, "index.json")).metros.filter(m => m.id >= 9000000);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].name, "Fort Lauderdale, FL"); assert.equal(idx[0].count, 2);
});
