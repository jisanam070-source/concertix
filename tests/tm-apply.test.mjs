import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTickets } from "../scripts/ticketmaster/apply.mjs";

const tm = (id, venue, localDate, localTime = "19:00:00") => ({ id, name: `Show ${id}`, url: `https://www.ticketmaster.com/x/event/${id}`,
  dates: { start: { localDate, localTime }, status: { code: "onsale" } }, _embedded: { venues: [{ name: venue }] } });
const show = (id, venue, date) => ({ id, artist: `Artist ${id}`, date, venue: { name: venue }, status: "scheduled" });
function setup(events, cache) {
  const dir = mkdtempSync(join(tmpdir(), "tm-")); mkdirSync(join(dir, "data", "metros"), { recursive: true });
  writeFileSync(join(dir, "data", "metros", "1.json"), JSON.stringify({ id: 1, name: "Town", events }));
  if (cache) { mkdirSync(join(dir, "cache"), { recursive: true }); writeFileSync(join(dir, "cache", "tm.json"), JSON.stringify(cache)); }
  return { dir, dataDir: join(dir, "data"), cachePath: join(dir, "cache", "tm.json") };
}
const read = p => JSON.parse(readFileSync(p, "utf8"));

test("adds a Ticketmaster ticket to matched shows within the covered dates", async () => {
  const { dataDir, cachePath } = setup([show("sk-1", "Roundhouse", "2026-10-18T19:00:00"), show("sk-2", "Scala", "2026-10-18T20:00:00")]);
  const stats = await applyTickets({ dataDir, cachePath, tmEvents: [tm("A", "Roundhouse", "2026-10-18")], coveredUntil: "2026-11-01", today: "2026-10-17" });
  const ev = read(join(dataDir, "metros", "1.json")).events;
  assert.deepEqual(ev[0].tickets, [{ seller: "Ticketmaster", url: "https://www.ticketmaster.com/x/event/A", status: "onsale" }]);
  assert.equal(ev[1].tickets, undefined);
  assert.deepEqual(stats, { shows: 2, covered: 2, matched: 1, fromCache: 0 });
  assert.equal(read(cachePath)["sk-1"].url, "https://www.ticketmaster.com/x/event/A");
});

test("shows beyond the covered dates keep their cached ticket", async () => {
  const cached = { seller: "Ticketmaster", url: "https://www.ticketmaster.com/x/event/OLD", status: "onsale", date: "2026-12-01" };
  const { dataDir, cachePath } = setup([show("sk-9", "Roundhouse", "2026-12-01T19:00:00")], { "sk-9": cached });
  const stats = await applyTickets({ dataDir, cachePath, tmEvents: [], coveredUntil: "2026-11-01", today: "2026-10-17" });
  assert.equal(read(join(dataDir, "metros", "1.json")).events[0].tickets[0].url, cached.url);
  assert.equal(stats.fromCache, 1);
});

test("inside the covered dates a show that no longer matches loses its old ticket", async () => {
  const cached = { seller: "Ticketmaster", url: "https://www.ticketmaster.com/x/event/OLD", status: "onsale", date: "2026-10-20" };
  const { dataDir, cachePath } = setup([show("sk-9", "Roundhouse", "2026-10-20T19:00:00")], { "sk-9": cached });
  await applyTickets({ dataDir, cachePath, tmEvents: [], coveredUntil: "2026-11-01", today: "2026-10-17" });
  assert.equal(read(join(dataDir, "metros", "1.json")).events[0].tickets, undefined);
  assert.equal(read(cachePath)["sk-9"], undefined);
});

test("past shows are dropped from the cache", async () => {
  const { dataDir, cachePath } = setup([], { "sk-old": { url: "https://www.ticketmaster.com/x", date: "2026-10-01" } });
  await applyTickets({ dataDir, cachePath, tmEvents: [], coveredUntil: "2026-10-17", today: "2026-10-17" });
  assert.deepEqual(read(cachePath), {});
});

test("creates the cache folder when it does not exist", async () => {
  const { dataDir, dir } = setup([show("sk-1", "Roundhouse", "2026-10-18T19:00:00")]);
  const cachePath = join(dir, "new", "tm.json");
  await applyTickets({ dataDir, cachePath, tmEvents: [tm("A", "Roundhouse", "2026-10-18")], coveredUntil: "2026-11-01", today: "2026-10-17" });
  assert.ok(existsSync(cachePath));
});
