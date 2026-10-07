#!/usr/bin/env node
// CLI: node scripts/sync-songkick.mjs [--out dist/data] [--limit N] [--concurrency 4]
import { createFetcher } from "./songkick/fetch.mjs";
import { listMetroAreas } from "./songkick/sitemap.mjs";
import { syncMetros } from "./songkick/sync.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outDir = arg("out", "dist/data");
const limit = Number(arg("limit", 0));
const concurrency = Number(arg("concurrency", 4));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

try {
  const fetcher = createFetcher();
  let metros = await listMetroAreas(fetcher.fetchGzipText);
  if (limit > 0) metros = metros.slice(0, limit);
  log(`crawling ${metros.length} metro areas → ${outDir}`);
  const today = new Date().toISOString().slice(0, 10);
  const summary = await syncMetros({ metros, fetchText: fetcher.fetchText, outDir, today, concurrency, log });
  log(`done: ${summary.ok} ok, ${summary.failed.length} failed, ${summary.events} events`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
