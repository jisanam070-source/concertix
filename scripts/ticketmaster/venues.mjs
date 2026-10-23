// Pulls every upcoming event at a list of Ticketmaster venues. The Discovery
// API accepts several venue ids per request, so venues are packed into batches
// sized by their expected event count. A batch that turns out to hold 1,000 or
// more events (the API's paging cap) is split in half and refetched.
const PAGE_SIZE = 200;
const MAX_RESULTS = 1000;
const tmDate = d => new Date(d).toISOString().slice(0, 19) + "Z";

export function batchVenues(venues, { maxExpected = 600, maxIds = 20 } = {}) {
  const usable = venues.filter(v => v.tmVenueId).sort((a, b) => (b.upcoming || 0) - (a.upcoming || 0));
  const batches = [];
  for (const v of usable) {
    const n = v.upcoming || 0;
    const fit = batches.find(b => b.length < maxIds && b.reduce((s, x) => s + (x.upcoming || 0), 0) + n <= maxExpected);
    if (fit) fit.push(v); else batches.push([v]);
  }
  return batches;
}

async function fetchBatch(client, batch, params, out, stats) {
  const venueId = batch.map(v => v.tmVenueId).join(",");
  const first = await client.get("events.json", { ...params, venueId, page: "0" }); stats.requests++;
  const total = first.page?.totalElements || 0;
  if (total >= MAX_RESULTS && batch.length > 1) {
    const half = Math.ceil(batch.length / 2);
    await fetchBatch(client, batch.slice(0, half), params, out, stats);
    await fetchBatch(client, batch.slice(half), params, out, stats);
    return;
  }
  const add = page => { for (const e of page._embedded?.events || []) out.set(e.id, e); };
  add(first);
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_RESULTS / PAGE_SIZE);
  for (let p = 1; p < pages; p++) { add(await client.get("events.json", { ...params, venueId, page: String(p) })); stats.requests++; }
}

export async function collectVenueEvents(client, venues, { start, days = 365, maxExpected = 600, maxIds = 20, log = () => {} }) {
  const params = {
    startDateTime: tmDate(start), endDateTime: tmDate(new Date(new Date(start).getTime() + days * 864e5)),
    size: String(PAGE_SIZE), sort: "date,asc", includeTBA: "yes", includeTBD: "yes", includeTest: "no",
  };
  const out = new Map(); const stats = { requests: 0 }; let complete = true;
  const batches = batchVenues(venues, { maxExpected, maxIds });
  try {
    for (let i = 0; i < batches.length; i++) {
      await fetchBatch(client, batches[i], params, out, stats);
      if ((i + 1) % 25 === 0) log(`venues: batch ${i + 1}/${batches.length}, ${out.size} events, ${stats.requests} requests`);
    }
  } catch (e) {
    if (!(e.name === "TmBudgetError" || e.name === "TmQuotaError")) throw e;
    complete = false; log(`venues: stopped early: ${e.message}`);
  }
  const perVenue = {};
  for (const e of out.values()) { const id = e._embedded?.venues?.[0]?.id; if (id) perVenue[id] = (perVenue[id] || 0) + 1; }
  return { events: [...out.values()], perVenue, requests: stats.requests, complete };
}
