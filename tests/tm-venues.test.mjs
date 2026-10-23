import test from "node:test";
import assert from "node:assert/strict";
import { batchVenues, collectVenueEvents } from "../scripts/ticketmaster/venues.mjs";

const v = (id, upcoming) => ({ tmVenueId: id, name: id, city: "C", state: "NY", country: "US", upcoming });

test("batchVenues packs venues by expected events, capped by count and ids per request", () => {
  const venues = [v("a", 500), v("b", 500), v("c", 100), v("d", 100), ...Array.from({ length: 30 }, (_, i) => v(`s${i}`, 1))];
  const batches = batchVenues(venues, { maxExpected: 600, maxIds: 20 });
  assert.ok(batches.every(b => b.length <= 20), "no batch has more than 20 ids");
  assert.ok(batches.every(b => b.reduce((n, x) => n + x.upcoming, 0) <= 600 || b.length === 1), "expected events per batch stay under the cap");
  assert.equal(batches.flat().length, venues.length, "every venue is in exactly one batch");
});

test("batchVenues skips venues without a Ticketmaster id", () => {
  assert.deepEqual(batchVenues([v("", 5), v("ok", 5)], { maxExpected: 600, maxIds: 20 }).flat().map(x => x.tmVenueId), ["ok"]);
});

const page = (events, total, number = 0) => ({ _embedded: { events }, page: { size: 200, totalElements: total, totalPages: Math.ceil(total / 200), number } });
const ev = (id, venueId) => ({ id, name: `E${id}`, _embedded: { venues: [{ id: venueId }] }, dates: { start: { localDate: "2026-11-01" } } });
const fakeClient = (handler) => {
  const calls = [];
  return { calls, get: async (path, params) => { calls.push(params); return handler(params, calls.length); } };
};

test("collectVenueEvents asks for each batch's ids and pages through results", async () => {
  const client = fakeClient(params => {
    const ids = params.venueId.split(","); const p = Number(params.page);
    const evs = p === 0 ? Array.from({ length: 200 }, (_, i) => ev(`${ids[0]}-${i}`, ids[0])) : [ev("last", ids[0])];
    return page(evs, 201, p);
  });
  const r = await collectVenueEvents(client, [v("a", 150), v("b", 50)], { start: new Date("2026-10-23T00:00:00Z") });
  assert.equal(client.calls[0].venueId, "a,b");
  assert.equal(client.calls[0].size, "200");
  assert.equal(r.events.length, 201);
  assert.equal(r.requests, 2);
});

test("collectVenueEvents splits a batch that reports 1,000 or more results", async () => {
  const seen = [];
  const client = fakeClient(params => { const ids = params.venueId.split(","); seen.push(ids.length); return page(ids.map(i => ev(i, i)), ids.length > 1 ? 1500 : 1); });
  const r = await collectVenueEvents(client, [v("a", 10), v("b", 10), v("c", 10), v("d", 10)], { start: new Date("2026-10-23T00:00:00Z") });
  assert.ok(seen.includes(1), `batches were split down to single venues: ${seen}`);
  assert.equal(r.events.length, 4);
});

test("collectVenueEvents dedupes events returned twice and reports per-venue counts", async () => {
  const client = fakeClient(() => page([ev("x", "a"), ev("x", "a"), ev("y", "a")], 3));
  const r = await collectVenueEvents(client, [v("a", 3)], { start: new Date("2026-10-23T00:00:00Z") });
  assert.equal(r.events.length, 2);
  assert.deepEqual(r.perVenue, { a: 2 });
});

test("collectVenueEvents keeps what it has when the budget runs out", async () => {
  let n = 0;
  const client = fakeClient(() => { if (++n > 2) { const e = new Error("budget"); e.name = "TmBudgetError"; throw e; } return page([ev(`e${n}`, "a")], 1); });
  const r = await collectVenueEvents(client, [v("a", 1), v("b", 1), v("c", 1)], { start: new Date("2026-10-23T00:00:00Z"), maxExpected: 1, maxIds: 1 });
  assert.equal(r.events.length, 2);
  assert.equal(r.complete, false);
});
