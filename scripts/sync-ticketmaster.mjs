#!/usr/bin/env node
// Ticketmaster step of the daily sync, run after the Songkick crawl:
//   1. pulls every upcoming event at the venues in data/ticketmaster-venues.json,
//   2. pulls music events market-wide so Songkick shows elsewhere can get links,
//   3. attaches exact ticket links to Songkick shows that match,
//   4. adds the venue events that match no Songkick show as shows of their own.
// node scripts/sync-ticketmaster.mjs [--data dist/data] [--cache cache/tm-matches.json] [--venues data/ticketmaster-venues.json]
//      [--days 365] [--budget 4500] [--countries GB,US] [--states NY,CA] [--no-markets] [--no-venues]
// The key comes from TICKETMASTER_API_KEY (GitHub secret) or a local .env file. Without a key it does nothing.
import { readFileSync } from "node:fs";
import { createTmClient, collectEvents } from "./ticketmaster/client.mjs";
import { collectVenueEvents } from "./ticketmaster/venues.mjs";
import { applyTickets } from "./ticketmaster/apply.mjs";
import { tmToShow } from "./ticketmaster/convert.mjs";
import { mergeShows } from "./ticketmaster/merge.mjs";

// Ticketmaster's markets. Countries with no events cost one request and are skipped.
const MARKETS = "US,CA,MX,GB,IE,AU,NZ,DE,AT,CH,NL,BE,LU,DK,NO,SE,FI,PL,CZ,ES,FR,IT,PT,AE,ZA,TR,IS".split(",");

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes(`--${name}`);
function keyFromEnv() {
  if (process.env.TICKETMASTER_API_KEY) return process.env.TICKETMASTER_API_KEY.trim();
  try { return (readFileSync(".env", "utf8").match(/^TICKETMASTER_API_KEY=(.+)$/m) || [])[1]?.trim(); } catch { return undefined; }
}
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

const key = keyFromEnv();
if (!key) { log("No TICKETMASTER_API_KEY set; skipping Ticketmaster."); process.exit(0); }
try {
  const client = createTmClient({ key, budget: Number(arg("budget", 4500)) });
  const dataDir = arg("data", "dist/data");
  const days = Number(arg("days", 365));
  const now = new Date(); const start = new Date(now.getTime() - 864e5); // include yesterday (UTC): tonight's shows in the Americas
  const today = start.toISOString().slice(0, 10);

  // 1. Venue events (all event types) for the listed Ticketmaster venues.
  let venueEvents = [], venueStats = null;
  if (!flag("no-venues")) {
    let venues = JSON.parse(readFileSync(arg("venues", "data/ticketmaster-venues.json"), "utf8")).venues;
    const states = arg("states", ""); if (states) { const keep = new Set(states.split(",")); venues = venues.filter(v => keep.has(v.state)); }
    venueStats = await collectVenueEvents(client, venues, { start, days, log });
    venueEvents = venueStats.events;
    log(`venues: ${venues.length} venues, ${venueEvents.length} events, ${venueStats.requests} requests${venueStats.complete ? "" : " (stopped early)"}`);
  }

  // 2. Market-wide music events, for ticket links on Songkick shows at other venues.
  let marketEvents = [], coveredUntil = today, complete = true;
  if (!flag("no-markets")) {
    const countries = arg("countries", MARKETS.join(",")).split(",");
    ({ events: marketEvents, coveredUntil, complete } = await collectEvents(client, { countries, start, days, log }));
    log(`markets: ${marketEvents.length} events, covered until ${coveredUntil}${complete ? "" : " (stopped early)"}`);
  } else if (venueStats?.complete) {
    coveredUntil = new Date(start.getTime() + days * 864e5).toISOString().slice(0, 10);
  }

  // 3. Exact ticket links on matching Songkick shows.
  const all = new Map(); for (const e of [...marketEvents, ...venueEvents]) all.set(e.id, e);
  const stats = await applyTickets({ dataDir, cachePath: arg("cache", "cache/tm-matches.json"), tmEvents: [...all.values()], coveredUntil, today });
  log(`links: shows ${stats.shows}, searched ${stats.covered}, matched ${stats.matched} (${(100 * stats.matched / Math.max(1, stats.covered)).toFixed(1)}%), kept from cache ${stats.fromCache}`);

  // 4. Venue events that match no Songkick show become shows of their own.
  if (venueEvents.length) {
    const shows = venueEvents.map(tmToShow).filter(Boolean);
    const merged = await mergeShows({ dataDir, shows, matchedIds: stats.matchedTmIds, today });
    log(`added: ${merged.added} Ticketmaster shows (${merged.skippedMatched} already on Songkick, ${merged.skippedPast} past, ${merged.newMetros} new cities)`);
  }
  log(`done: ${client.calls()} requests used, quota left ${client.remaining()}`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
