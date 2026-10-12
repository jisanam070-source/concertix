import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMetroPage } from "../scripts/songkick/parse.mjs";

const read = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("parses 50 events, pagination and metro name from the real page", () => {
  const r = parseMetroPage(read("metro-san-diego.html"));
  assert.equal(r.events.length, 50);
  assert.equal(r.lastPage, 16);
  assert.equal(r.upcomingCount, 752);
  assert.equal(r.metroName, "San Diego");
  const e = r.events[0];
  assert.equal(e.id, "sk-43255357");
  assert.equal(e.artist, "Last Dinosaurs");
  assert.equal(e.genre, "indie");
  assert.deepEqual(e.skGenres, ["indie_alternative", "rock"]);
  assert.equal(e.date, "2026-10-07T19:00:00");
  assert.equal(e.url, "https://www.songkick.com/concerts/43255357-last-dinosaurs-at-observatory-north-park");
  assert.equal(e.venue.name, "Observatory North Park");
  assert.equal(e.venue.city, "San Diego");
  assert.equal(e.venue.country, "US");
  assert.equal(e.status, "scheduled");
  assert.match(e.image, /^https:\/\/images\.sk-static\.com/);
});

test("synthetic page: date-only, cancelled, support, utm stripped, lastPage 1", () => {
  const r = parseMetroPage(read("metro-synthetic.html"));
  assert.equal(r.lastPage, 1);
  assert.equal(r.upcomingCount, null);
  assert.equal(r.metroName, "Testville");
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.date, "2026-11-19");
  assert.equal(e.status, "cancelled");
  assert.equal(e.support, "with B");
  assert.equal(e.genre, "jazz");
  assert.equal(e.url, "https://www.songkick.com/concerts/1-a-at-x");
  assert.deepEqual(e.venue, { name: "X Hall", city: "Testville", region: "TS", country: "US", lat: 1, lng: 2 });
});

test("ignores malformed ld+json blocks and non-MusicEvent types", () => {
  assert.doesNotThrow(() => parseMetroPage(read("metro-synthetic.html")));
  assert.equal(parseMetroPage(read("metro-synthetic.html")).events.length, 1);
});

test("empty page yields no events", () => {
  assert.deepEqual(parseMetroPage("<html><title>Nowhere – Songkick</title></html>"),
    { events: [], lastPage: 1, upcomingCount: null, metroName: null });
});

test("drops events whose url is not an https songkick.com url, and non-https images", () => {
  const block = (url, image) => `<script type="application/ld+json">${JSON.stringify({ "@type": "MusicEvent", url, image, startDate: "2026-11-01", performer: [{ name: "A" }] })}</script>`;
  const r = parseMetroPage(`<html>${block("javascript:alert(1)//concerts/1", "")}${block("https://evil.example/concerts/2", "")}${block("https://www.songkick.com/concerts/3-ok", "javascript:x")}</html>`);
  assert.deepEqual(r.events.map(e => e.id), ["sk-3"]);
  assert.equal(r.events[0].image, "");
});
