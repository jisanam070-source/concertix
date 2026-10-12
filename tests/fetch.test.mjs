import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createFetcher, CLIENT_HEADERS, BROWSER_HEADERS } from "../scripts/songkick/fetch.mjs";

const res = (status, body) => ({ ok: status < 300, status, text: async () => body, arrayBuffer: async () => body });
const noSleep = async () => {};

test("sends plain client headers by default and returns text", async () => {
  let seen;
  const f = createFetcher({ fetchImpl: async (u, o) => { seen = o.headers; return res(200, "hi"); }, sleep: noSleep });
  assert.equal(await f.fetchText("https://x/"), "hi");
  assert.deepEqual(seen, CLIENT_HEADERS);
  assert.equal(seen["User-Agent"], "concertix-sync/1.0");
  assert.equal(seen["Accept"], "*/*");
});

test("falls back to browser headers once on HTTP 406", async () => {
  const seen = [];
  const f = createFetcher({ fetchImpl: async (u, o) => { seen.push(o.headers); return seen.length === 1 ? res(406, "") : res(200, "ok"); }, sleep: noSleep });
  assert.equal(await f.fetchText("https://x/"), "ok");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], BROWSER_HEADERS);
  assert.match(seen[1]["User-Agent"], /Chrome\/130/);
  assert.match(seen[1]["Accept"], /text\/html/);
  assert.equal(seen[1]["Accept-Language"], "en-US,en;q=0.9");
});

test("throws HTTP 406 when both header sets are rejected", async () => {
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { n++; return res(406, ""); }, sleep: noSleep });
  await assert.rejects(f.fetchText("https://x/y"), /HTTP 406 https:\/\/x\/y/);
  assert.equal(n, 2);
});

test("retries on 503 then succeeds, with backoff 1s,2s", async () => {
  const calls = []; const waits = []; let n = 0;
  const f = createFetcher({ fetchImpl: async () => { calls.push(++n); return n < 3 ? res(503, "") : res(200, "ok"); }, sleep: async ms => { waits.push(ms); }, minIntervalMs: 0 });
  assert.equal(await f.fetchText("https://x/"), "ok");
  assert.equal(calls.length, 3);
  assert.deepEqual(waits.filter(w => w >= 1000), [1000, 2000]);
});

test("does not retry on 404", async () => {
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { n++; return res(404, ""); }, sleep: noSleep });
  await assert.rejects(f.fetchText("https://x/y"), /HTTP 404 https:\/\/x\/y/);
  assert.equal(n, 1);
});

test("gives up after 3 retries", async () => {
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { n++; return res(500, ""); }, sleep: noSleep });
  await assert.rejects(f.fetchText("https://x/"), /HTTP 500/);
  assert.equal(n, 4);
});

test("retries on network error", async () => {
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { if (++n < 2) throw new Error("ECONNRESET"); return res(200, "ok"); }, sleep: noSleep });
  assert.equal(await f.fetchText("https://x/"), "ok");
  assert.equal(n, 2);
});

test("fetchGzipText gunzips", async () => {
  const f = createFetcher({ fetchImpl: async () => res(200, gzipSync("<x/>")), sleep: noSleep });
  assert.equal(await f.fetchGzipText("https://x/a.gz"), "<x/>");
});

test("spaces requests by minIntervalMs", async () => {
  const waits = [];
  const f = createFetcher({ fetchImpl: async () => res(200, ""), sleep: async ms => { waits.push(ms); }, minIntervalMs: 500 });
  await f.fetchText("https://x/1"); await f.fetchText("https://x/2");
  assert.ok(waits.some(w => w > 0 && w <= 500), `waits: ${waits}`);
});

test("rate limit is global across concurrent callers", async () => {
  const waits = [];
  const f = createFetcher({ fetchImpl: async () => res(200, ""), sleep: async ms => { waits.push(ms); }, minIntervalMs: 500 });
  await Promise.all([1, 2, 3, 4, 5].map(i => f.fetchText(`https://x/${i}`)));
  // Each concurrent caller must reserve its own slot: ~500, 1000, 1500, 2000 ms.
  assert.equal(waits.length, 4, `waits: ${waits}`);
  waits.forEach((w, i) => assert.ok(Math.abs(w - 500 * (i + 1)) < 50, `waits: ${waits}`));
});
