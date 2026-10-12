import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlMetro, syncMetros } from "../scripts/songkick/sync.mjs";

const TODAY = "2026-10-07";
const ev = (id, date, extra = {}) => ({
  "@context": "http://schema.org", "@type": "MusicEvent", name: `Artist ${id} @ V`,
  url: `https://www.songkick.com/concerts/${id}-artist-${id}-at-v`, startDate: date,
  location: { "@type": "Place", name: "V", address: { addressLocality: "Town", addressCountry: "US" } },
  performer: [{ "@type": "MusicGroup", name: `Artist ${id}`, genre: ["rock"] }], ...extra,
});
const page = (events, lastPage = 1, name = "Town") => {
  const pag = lastPage > 1 ? `<a href="?page=${lastPage}">${lastPage}</a>` : "";
  return `<html><title>${name} Concerts – Songkick</title>${events.map(e => `<script type="application/ld+json">${JSON.stringify(e)}</script>`).join("")}${pag}</html>`;
};
const metro = (id, slug = `m${id}`) => ({ id, slug, url: `https://www.songkick.com/metro-areas/${id}-${slug}` });
const fetcherFor = pages => async u => { if (!(u in pages)) throw new Error(`unexpected ${u}`); return pages[u]; };
const tmp = () => mkdtempSync(join(tmpdir(), "sync-"));
const readJson = p => JSON.parse(readFileSync(p, "utf8"));

test("crawlMetro follows pagination, dedupes, drops past, keeps today, sorts", async () => {
  const m = metro(1, "x");
  const pages = { [m.url]: page([ev("3", "2026-10-09"), ev("2", "2026-10-06")], 2), [`${m.url}?page=2`]: page([ev("3", "2026-10-09"), ev("1", "2026-10-07")], 2) };
  const r = await crawlMetro(m, fetcherFor(pages), TODAY);
  assert.deepEqual(r.events.map(e => e.id), ["sk-1", "sk-3"]);
  assert.equal(r.metroName, "Town");
});

test("stops early when a page has zero events", async () => {
  const m = metro(1); const asked = [];
  const pages = { [m.url]: page([ev("1", "2026-10-09")], 3), [`${m.url}?page=2`]: page([], 3), [`${m.url}?page=3`]: page([ev("9", "2026-10-09")], 3) };
  const r = await crawlMetro(m, async u => { asked.push(u); return pages[u]; }, TODAY);
  assert.deepEqual(asked, [m.url, `${m.url}?page=2`]);
  assert.equal(r.events.length, 1);
});

test("keeps events dated today", async () => {
  const m = metro(1);
  const r = await crawlMetro(m, fetcherFor({ [m.url]: page([ev("1", "2026-10-07T23:00:00")]) }), TODAY);
  assert.equal(r.events.length, 1);
});

test("skips metros with no events and writes index sorted by count", async () => {
  const out = tmp(); const a = metro(1, "a"), b = metro(2, "b"), c = metro(3, "c");
  const pages = { [a.url]: page([ev("1", "2026-10-09")], 1, "Aville"), [b.url]: page([]), [c.url]: page([ev("2", "2026-10-09"), ev("3", "2026-10-10")], 1, "Cville") };
  const r = await syncMetros({ metros: [a, b, c], fetchText: fetcherFor(pages), outDir: out, today: TODAY });
  assert.equal(r.ok, 3); assert.equal(r.failed.length, 0); assert.equal(r.events, 3);
  assert.ok(!existsSync(join(out, "metros", "2.json")));
  const index = readJson(join(out, "index.json"));
  assert.deepEqual(index.metros.map(m => [m.id, m.name, m.count]), [[3, "Cville", 2], [1, "Aville", 1]]);
  const f = readJson(join(out, "metros", "1.json"));
  assert.equal(f.name, "Aville"); assert.equal(f.country, "US"); assert.equal(f.slug, "a"); assert.equal(f.events.length, 1); assert.ok(f.updatedAt);
  assert.ok(existsSync(join(out, "summary.json")));
});

test("keeps previous file for a failed metro and counts it in index", async () => {
  const out = tmp(); mkdirSync(join(out, "metros"), { recursive: true });
  const old = { id: 9, slug: "old", name: "Oldtown", country: "US", updatedAt: "x", events: [1, 2, 3, 4].map(i => ({ id: `sk-${i}`, date: "2026-10-09" })) };
  writeFileSync(join(out, "metros", "9.json"), JSON.stringify(old));
  const metros = [metro(9, "old"), ...[1, 2, 3, 4].map(i => metro(i))];
  const pages = Object.fromEntries(metros.slice(1).map(m => [m.url, page([ev(String(m.id), "2026-10-09")])]));
  const r = await syncMetros({ metros, fetchText: fetcherFor(pages), outDir: out, today: TODAY });
  assert.deepEqual(r.failed.map(f => f.id), [9]);
  assert.deepEqual(readJson(join(out, "metros", "9.json")), old);
  const index = readJson(join(out, "index.json"));
  assert.deepEqual(index.metros[0], { id: 9, slug: "old", name: "Oldtown", country: "US", count: 4 });
});

test("throws when more than 20% of metros fail", async () => {
  const out = tmp(); const metros = [1, 2, 3, 4, 5].map(i => metro(i));
  const pages = Object.fromEntries(metros.slice(2).map(m => [m.url, page([ev(String(m.id), "2026-10-09")])]));
  await assert.rejects(syncMetros({ metros, fetchText: fetcherFor(pages), outDir: out, today: TODAY }), /Too many failures: 2 of 5/);
  assert.ok(existsSync(join(out, "summary.json")));
  assert.ok(!existsSync(join(out, "index.json")));
});

test("removes the old file when a metro now crawls with zero events", async () => {
  const out = tmp(); mkdirSync(join(out, "metros"), { recursive: true });
  writeFileSync(join(out, "metros", "1.json"), JSON.stringify({ id: 1, slug: "a", name: "A", country: "US", updatedAt: "x", events: [{ id: "sk-1", date: "2026-10-09" }] }));
  const metros = [metro(1, "a"), ...[2, 3, 4, 5].map(i => metro(i))];
  const pages = Object.fromEntries(metros.map(m => [m.url, page(m.id === 1 ? [] : [ev(String(m.id), "2026-10-09")])]));
  await syncMetros({ metros, fetchText: fetcherFor(pages), outDir: out, today: TODAY });
  assert.ok(!existsSync(join(out, "metros", "1.json")));
  assert.ok(!readJson(join(out, "index.json")).metros.some(m => m.id === 1));
});

test("removes files for metros no longer in the sitemap", async () => {
  const out = tmp(); mkdirSync(join(out, "metros"), { recursive: true });
  writeFileSync(join(out, "metros", "777.json"), JSON.stringify({ id: 777, slug: "gone", name: "Gone", country: "US", updatedAt: "x", events: [{ id: "sk-9", date: "2026-10-09" }] }));
  const a = metro(1, "a");
  await syncMetros({ metros: [a], fetchText: fetcherFor({ [a.url]: page([ev("1", "2026-10-09")]) }), outDir: out, today: TODAY });
  assert.ok(!existsSync(join(out, "metros", "777.json")));
  assert.ok(existsSync(join(out, "metros", "1.json")));
});

test("a kept file for a failed metro drops past events and updates its count", async () => {
  const out = tmp(); mkdirSync(join(out, "metros"), { recursive: true });
  const old = { id: 9, slug: "old", name: "Oldtown", country: "US", updatedAt: "x", events: [
    { id: "sk-1", date: "2026-10-01" }, { id: "sk-2", date: "2026-10-07T20:00:00" }, { id: "sk-3", date: "2026-10-20" }] };
  writeFileSync(join(out, "metros", "9.json"), JSON.stringify(old));
  const metros = [metro(9, "old"), ...[1, 2, 3, 4].map(i => metro(i))];
  const pages = Object.fromEntries(metros.slice(1).map(m => [m.url, page([ev(String(m.id), "2026-10-09")])]));
  await syncMetros({ metros, fetchText: fetcherFor(pages), outDir: out, today: TODAY });
  assert.deepEqual(readJson(join(out, "metros", "9.json")).events.map(e => e.id), ["sk-2", "sk-3"]);
  assert.equal(readJson(join(out, "index.json")).metros.find(m => m.id === 9).count, 2);
});

test("a kept file whose events are all past is removed and not indexed", async () => {
  const out = tmp(); mkdirSync(join(out, "metros"), { recursive: true });
  writeFileSync(join(out, "metros", "9.json"), JSON.stringify({ id: 9, slug: "old", name: "Oldtown", country: "US", updatedAt: "x", events: [{ id: "sk-1", date: "2026-10-01" }] }));
  const metros = [metro(9, "old"), ...[1, 2, 3, 4].map(i => metro(i))];
  const pages = Object.fromEntries(metros.slice(1).map(m => [m.url, page([ev(String(m.id), "2026-10-09")])]));
  await syncMetros({ metros, fetchText: fetcherFor(pages), outDir: out, today: TODAY });
  assert.ok(!existsSync(join(out, "metros", "9.json")));
  assert.ok(!readJson(join(out, "index.json")).metros.some(m => m.id === 9));
});
