#!/usr/bin/env node
// Converts a Pathfinder "Ticketmaster venues" markdown export into data/ticketmaster-venues.json.
//   node scripts/ticketmaster/import-venues.mjs <export.md> [--out data/ticketmaster-venues.json]
// Venue rows sit under "## XX" state headings; the final "## Unknown / outside US"
// section holds venues with no state, which are kept with state and country blank.
import { readFileSync, writeFileSync } from "node:fs";

const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const STATE_HEADING = /^## ([A-Z]{2})\s*$/;
const VENUE_ID = /^Kov[A-Za-z0-9_-]+$/;

export function parseVenueMarkdown(md) {
  let section = null; // null = before any venue section; "" = a section without a state code
  const venues = [], skipped = [];
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) { const m = line.match(STATE_HEADING); section = m ? m[1] : (/^## Summary/i.test(line) ? null : ""); continue; }
    if (section === null || !line.startsWith("| [")) continue;
    const c = line.split("|").map(s => s.trim()); // "", "[ ]", n, name, city, upcoming, onSale, first, last, link, id, ""
    const name = c[3] || "", city = c[4] || "", id = (c[10] || "").replace(/`/g, "");
    if (!VENUE_ID.test(id)) { skipped.push({ name, id }); continue; }
    const state = section, country = state ? (CA_PROVINCES.has(state) ? "CA" : "US") : "";
    venues.push({ tmVenueId: id, name, city, state, country, upcoming: Number(String(c[5] || "0").replace(/[^0-9]/g, "")) || 0 });
  }
  return { venues, skipped };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const src = process.argv[2]; if (!src) { console.error("usage: import-venues.mjs <export.md> [--out file]"); process.exit(1); }
  const i = process.argv.indexOf("--out"); const out = i > -1 ? process.argv[i + 1] : "data/ticketmaster-venues.json";
  const { venues, skipped } = parseVenueMarkdown(readFileSync(src, "utf8"));
  const title = (readFileSync(src, "utf8").match(/^# (.+)$/m) || [])[1] || src;
  writeFileSync(out, JSON.stringify({ source: title, venues }));
  const noState = venues.filter(v => !v.state).length;
  console.log(`${venues.length} venues written to ${out} (${noState} without a state, ${skipped.length} rows skipped for having no Discovery id)`);
}
