// Ticketmaster Discovery API v2 client (official, free key). Paces requests
// under the 5/s limit, stops at the daily quota or a per-run budget, and
// splits date ranges so no search runs into the 1,000-result paging cap.
const BASE = "https://app.ticketmaster.com/discovery/v2/";
const PAGE_SIZE = 200;
const MAX_RESULTS = 1000; // size * page must stay under 1,000

export class TmQuotaError extends Error {}
export class TmBudgetError extends Error {}

const tmDate = d => new Date(d).toISOString().slice(0, 19) + "Z"; // no milliseconds, or the API returns 400
const isoDay = d => new Date(d).toISOString().slice(0, 10);

export function createTmClient({ key, fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), minIntervalMs = 260, budget = Infinity } = {}) {
  if (!key) throw new Error("Missing Ticketmaster API key");
  let nextSlotAt = 0, calls = 0, remaining = null;

  async function get(path, params, retried = false) {
    if (calls >= budget) throw new TmBudgetError(`Ticketmaster call budget of ${budget} used`);
    const now = Date.now(); const slot = Math.max(now, nextSlotAt); nextSlotAt = slot + minIntervalMs;
    if (slot > now) await sleep(slot - now);
    calls++;
    const q = new URLSearchParams({ ...params, apikey: key });
    const r = await fetchImpl(`${BASE}${path}?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    const left = r.headers?.get?.("rate-limit-available"); if (left != null) remaining = Number(left);
    if (r.status === 429) {
      let msg = ""; try { msg = (await r.json())?.fault?.faultstring || ""; } catch {}
      if (/quota/i.test(msg)) throw new TmQuotaError(msg);
      if (!retried) { await sleep(1500); return get(path, params, true); }
    }
    if (r.status === 401 || r.status === 403) throw new Error(`Ticketmaster rejected the API key (HTTP ${r.status})`);
    if (!r.ok) throw new Error(`Ticketmaster HTTP ${r.status} for ${path}`);
    return r.json();
  }

  function searchEvents({ countryCode, startDateTime, endDateTime, page = 0 }) {
    return get("events.json", {
      classificationName: "music", countryCode, startDateTime: tmDate(startDateTime), endDateTime: tmDate(endDateTime),
      size: String(PAGE_SIZE), page: String(page), sort: "date,asc", includeTBA: "yes", includeTBD: "yes", includeTest: "no",
    });
  }

  return { get, searchEvents, calls: () => calls, remaining: () => remaining };
}

// All events in one window, splitting it in half while it reports >= 1,000 results.
async function windowEvents(client, countryCode, start, end, first) {
  const p0 = first || await client.searchEvents({ countryCode, startDateTime: start, endDateTime: end });
  const total = p0.page?.totalElements || 0;
  if (total >= MAX_RESULTS && end - start > 36e5) {
    const mid = new Date(start.getTime() + Math.floor((end - start) / 2 / 36e5) * 36e5);
    return [...await windowEvents(client, countryCode, start, mid), ...await windowEvents(client, countryCode, mid, end)];
  }
  const out = [...(p0._embedded?.events || [])];
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_RESULTS / PAGE_SIZE);
  for (let page = 1; page < pages; page++) {
    const p = await client.searchEvents({ countryCode, startDateTime: start, endDateTime: end, page });
    out.push(...(p._embedded?.events || []));
  }
  return out;
}

// Music events for every country over [start, start + days). Countries under
// 1,000 events are fetched from one whole-horizon search; bigger ones week by
// week, soonest first, so a budget cut still leaves the nearest dates covered.
export async function collectEvents(client, { countries, start, days = 365, windowDays = 7, log = () => {} }) {
  const begin = new Date(start), horizon = new Date(begin.getTime() + days * 864e5);
  const events = []; const big = [];
  let coveredUntil = isoDay(begin), complete = false;
  try {
    for (const cc of countries) {
      const probe = await client.searchEvents({ countryCode: cc, startDateTime: begin, endDateTime: horizon });
      const total = probe.page?.totalElements || 0;
      if (total === 0) continue;
      if (total < MAX_RESULTS) { events.push(...await windowEvents(client, cc, begin, horizon, probe)); log(`${cc}: ${total} events`); }
      else big.push(cc);
    }
    if (big.length === 0) { coveredUntil = isoDay(horizon); complete = true; return { events, coveredUntil, complete }; }
    log(`windowed countries: ${big.join(", ")}`);
    for (let ws = begin; ws < horizon; ws = new Date(ws.getTime() + windowDays * 864e5)) {
      const we = new Date(Math.min(ws.getTime() + windowDays * 864e5, horizon.getTime()));
      for (const cc of big) events.push(...await windowEvents(client, cc, ws, we));
      coveredUntil = isoDay(we);
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof TmBudgetError || e instanceof TmQuotaError)) throw e;
    log(`stopped early: ${e.message}`);
  }
  return { events, coveredUntil, complete };
}
