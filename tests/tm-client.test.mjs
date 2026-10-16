import test from "node:test";
import assert from "node:assert/strict";
import { createTmClient, TmQuotaError, TmBudgetError, collectEvents } from "../scripts/ticketmaster/client.mjs";

const json = (status, body, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: k => headers[k.toLowerCase()] ?? null } });
const noSleep = async () => {};
const evs = (n, prefix = "e") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Show ${i}` }));
const page = (events, total, number = 0) => ({ _embedded: { events }, page: { size: 200, totalElements: total, totalPages: Math.ceil(total / 200), number } });

test("sends the key and size=200, and never asks for milliseconds in dates", async () => {
  let url;
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async u => { url = new URL(u); return json(200, page([], 0)); } });
  await c.searchEvents({ countryCode: "GB", startDateTime: new Date("2026-10-17T10:00:00.123Z"), endDateTime: new Date("2026-10-24T00:00:00Z") });
  assert.equal(url.searchParams.get("apikey"), "K");
  assert.equal(url.searchParams.get("size"), "200");
  assert.equal(url.searchParams.get("startDateTime"), "2026-10-17T10:00:00Z");
  assert.equal(url.searchParams.get("classificationName"), "music");
});

test("a 429 mentioning quota stops with TmQuotaError", async () => {
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async () => json(429, { fault: { faultstring: "Rate limit quota violation. Quota limit exceeded" } }) });
  await assert.rejects(c.get("events.json", {}), TmQuotaError);
});

test("a per-second 429 is retried once", async () => {
  let n = 0;
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async () => (++n === 1 ? json(429, { fault: { faultstring: "Spike arrest violation" } }) : json(200, page([], 0))) });
  await c.get("events.json", {});
  assert.equal(n, 2);
});

test("a 401 is reported as a rejected key", async () => {
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async () => json(401, {}) });
  await assert.rejects(c.get("events.json", {}), /rejected the API key/);
});

test("stops with TmBudgetError once the call budget is used", async () => {
  const c = createTmClient({ key: "K", sleep: noSleep, budget: 2, fetchImpl: async () => json(200, page([], 0)) });
  await c.get("a", {}); await c.get("b", {});
  await assert.rejects(c.get("c", {}), TmBudgetError);
  assert.equal(c.calls(), 2);
});

test("a country under 1,000 events is fetched entirely from the whole-horizon search", async () => {
  const asked = [];
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async u => {
    const p = Number(new URL(u).searchParams.get("page")); asked.push(p);
    return json(200, page(evs(p < 2 ? 200 : 50, `p${p}-`), 450, p));
  } });
  const r = await collectEvents(c, { countries: ["GB"], start: new Date("2026-10-17T00:00:00Z"), days: 30 });
  assert.equal(r.events.length, 450);
  assert.deepEqual(asked, [0, 1, 2]);
  assert.equal(r.complete, true);
  assert.equal(r.coveredUntil, "2026-11-16");
});

test("collectEvents splits a window that reports 1,000 or more results", async () => {
  const windows = [];
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async u => {
    const q = new URL(u).searchParams; const s = q.get("startDateTime"), e = q.get("endDateTime");
    const hours = (new Date(e) - new Date(s)) / 36e5;
    if (q.get("page") === "0") windows.push(hours);
    const total = hours > 48 ? 1500 : 300;
    return json(200, page(evs(Math.min(200, total), s), total, 0));
  } });
  const r = await collectEvents(c, { countries: ["US"], start: new Date("2026-10-17T00:00:00Z"), days: 4 });
  assert.ok(windows.includes(48), `split into 2-day windows: ${windows}`);
  assert.ok(r.events.length > 0);
});

test("collectEvents skips countries with no events after one probe", async () => {
  let calls = 0;
  const c = createTmClient({ key: "K", sleep: noSleep, fetchImpl: async u => { calls++; return json(200, page([], 0)); } });
  const r = await collectEvents(c, { countries: ["XX", "YY"], start: new Date("2026-10-17T00:00:00Z"), days: 30 });
  assert.equal(calls, 2);
  assert.equal(r.events.length, 0);
  assert.equal(r.coveredUntil, "2026-11-16");
});

test("collectEvents reports how far it got when the budget runs out", async () => {
  const c = createTmClient({ key: "K", sleep: noSleep, budget: 3, fetchImpl: async u => {
    const q = new URL(u).searchParams; const days = (new Date(q.get("endDateTime")) - new Date(q.get("startDateTime"))) / 864e5;
    return json(200, page(evs(10), days > 7 ? 5000 : 10));
  } });
  const r = await collectEvents(c, { countries: ["GB"], start: new Date("2026-10-17T00:00:00Z"), days: 21, windowDays: 7 });
  assert.equal(r.complete, false);
  assert.equal(r.coveredUntil, "2026-10-31", "probe, then two 7-day windows fit in a budget of 3");
  assert.equal(r.events.length, 20);
});
