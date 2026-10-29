import test from "node:test";
import assert from "node:assert/strict";
import { parseVenueMarkdown } from "../scripts/ticketmaster/import-venues.mjs";

const md = `# Ticketmaster venues

## Summary by state

| State | Venues | Upcoming events | On sale |
|---|---:|---:|---:|
| [AB](#ab) | 1 | 115 | 106 |

## AB

| | # | Venue | City | Upcoming | On sale | First | Last | Ticketmaster page | TM venue ID |
|---|---:|---|---|---:|---:|---|---|---|---|
| [ ] | 1 | Scotiabank Saddledome | Calgary | 115 | 106 | 2026-10-22 | 2027-07-09 | [open](https://www.ticketmaster.ca/x/venue/139359) | \`KovZpZAFFl7A\` |

## TX

| [ ] | 1 | Moody Center | Austin | 1,234 | 1,200 | 2026-10-22 | 2027-07-09 | [open](https://www.ticketmaster.com/x/venue/1) | \`KovZpZAEkn6A\` |

## Unknown / outside US

| [ ] | 1 | The Hanover Theatre | Worcester | 0 | 0 | - | - | [open](https://www.ticketmaster.com/x/venue/9110) | \`KovZpZAJ6nlA\` |
| [ ] | 2 | Broadview Stage at SPAC |  | 0 | 0 | - | - | - | \`Z7r9jZaADU\` |
| [ ] | 3 | PNC Music Pavilion |  | 0 | 0 | - | - | - | \`tmq:PNC Pavilion\\|NC\` |
`;

test("parses venues under state headings with country from the province list", () => {
  const { venues } = parseVenueMarkdown(md);
  const ab = venues.find(v => v.tmVenueId === "KovZpZAFFl7A");
  assert.deepEqual(ab, { tmVenueId: "KovZpZAFFl7A", name: "Scotiabank Saddledome", city: "Calgary", state: "AB", country: "CA", upcoming: 115 });
  const tx = venues.find(v => v.tmVenueId === "KovZpZAEkn6A");
  assert.equal(tx.country, "US"); assert.equal(tx.upcoming, 1234, "thousands separators are removed");
});

test("rows in the Unknown / outside US section get no state or country, not the previous section's", () => {
  const { venues } = parseVenueMarkdown(md);
  const w = venues.find(v => v.tmVenueId === "KovZpZAJ6nlA");
  assert.deepEqual(w, { tmVenueId: "KovZpZAJ6nlA", name: "The Hanover Theatre", city: "Worcester", state: "", country: "", upcoming: 0 });
});

test("rows without a Discovery venue id are skipped and counted", () => {
  const { venues, skipped } = parseVenueMarkdown(md);
  assert.equal(venues.length, 3);
  assert.deepEqual(skipped.map(s => s.name), ["Broadview Stage at SPAC", "PNC Music Pavilion"]);
});

test("summary-table rows are not venues", () => {
  assert.ok(!parseVenueMarkdown(md).venues.some(v => v.name === "[AB](#ab)" || v.tmVenueId === "115"));
});
