import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createFetcher } from "../scripts/songkick/fetch.mjs";

const res = (status, body) => ({ ok: status < 300, status, text: async () => body, arrayBuffer: async () => body });
const noSleep = async () => {};

test("sends browser headers and returns text", async () => {
  let seen;
  const f = createFetcher({ fetchImpl: async (u, o) => { seen = o.headers; return res(200, "hi"); }, sleep: noSleep });
  assert.equal(await f.fetchText("https://x/"), "hi");
  assert.match(seen["User-Agent"], /Chrome\/130/);
  assert.match(seen["Accept"], /text\/html/);
  assert.equal(seen["Accept-Language"], "en-US,en;q=0.9");
});

test("retries on 503 then succeeds, with backoff 1s,2s", async () => {
  const calls = []; const waits = []; let n = 0;
  const f = createFetcher({ fetchImpl: async () => { calls.push(++n); return n < 3 ? res(503, "") : res(200, "ok"); }, sleep: async ms => { waits.push(ms); } });
  assert.equal(await f.fetchText("https://x/"), "ok");
  assert.equal(calls.length, 3);
  assert.deepEqual(waits.filter(w => w >= 1000), [1000, 2000]);
});

test("does not retry on 406 and throws HTTP 406", async () => {
  let n = 0;
  const f = createFetcher({ fetchImpl: async () => { n++; return res(406, ""); }, sleep: noSleep });
  await assert.rejects(f.fetchText("https://x/y"), /HTTP 406 https:\/\/x\/y/);
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
