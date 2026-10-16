#!/usr/bin/env node
// Adds exact Ticketmaster ticket links to the crawled shows.
// node scripts/sync-ticketmaster.mjs [--data dist/data] [--cache cache/tm-matches.json] [--days 365] [--budget 4500] [--countries GB,US]
// The key comes from TICKETMASTER_API_KEY (GitHub secret) or a local .env file. Without a key it does nothing.
import { readFileSync } from "node:fs";
import { createTmClient, collectEvents } from "./ticketmaster/client.mjs";
import { applyTickets } from "./ticketmaster/apply.mjs";

// Ticketmaster's markets. Countries with no events cost one request and are skipped.
const MARKETS = "US,CA,MX,GB,IE,AU,NZ,DE,AT,CH,NL,BE,LU,DK,NO,SE,FI,PL,CZ,ES,FR,IT,PT,AE,ZA,TR,IS".split(",");

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
function keyFromEnv() {
  if (process.env.TICKETMASTER_API_KEY) return process.env.TICKETMASTER_API_KEY.trim();
  try { return (readFileSync(".env", "utf8").match(/^TICKETMASTER_API_KEY=(.+)$/m) || [])[1]?.trim(); } catch { return undefined; }
}
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

const key = keyFromEnv();
if (!key) { log("No TICKETMASTER_API_KEY set; skipping Ticketmaster links."); process.exit(0); }
try {
  const client = createTmClient({ key, budget: Number(arg("budget", 4500)) });
  const days = Number(arg("days", 365));
  const countries = arg("countries", MARKETS.join(",")).split(",");
  const now = new Date(); const start = new Date(now.getTime() - 864e5); // include yesterday (UTC): tonight's shows in the Americas
  const { events, coveredUntil, complete } = await collectEvents(client, { countries, start, days, log });
  log(`${events.length} Ticketmaster events, ${client.calls()} requests, quota left ${client.remaining()}, covered until ${coveredUntil}${complete ? "" : " (stopped early)"}`);
  const stats = await applyTickets({ dataDir: arg("data", "dist/data"), cachePath: arg("cache", "cache/tm-matches.json"), tmEvents: events, coveredUntil, today: start.toISOString().slice(0, 10) });
  log(`shows ${stats.shows}, searched ${stats.covered}, matched ${stats.matched} (${(100 * stats.matched / Math.max(1, stats.covered)).toFixed(1)}%), kept from cache ${stats.fromCache}`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
