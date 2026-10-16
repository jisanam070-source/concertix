// Pure matching of Songkick shows to Ticketmaster Discovery events. No I/O.
// A match needs the same venue (normalised name) on the same venue-local date.
// When a venue has several events that day, the artist name decides, then the
// start time (within 90 minutes). Anything still ambiguous is left unmatched:
// no link is better than a link to the wrong show.

const ADD_ON_RE = /\b(parking|upsell|shuttle|valet|vip package|hospitality package|merch|locker)\b/i;
const TIME_TOLERANCE_MIN = 90;

export function normName(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^the\s+/, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export const isAddOn = name => ADD_ON_RE.test(String(name || ""));

const keyOf = (venueName, localDate) => `${normName(venueName)}|${localDate}`;
const minutes = hhmm => (hhmm && /^\d\d:\d\d/.test(hhmm)) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null;

export function indexTmEvents(events) {
  const index = new Map();
  for (const e of events) {
    if (isAddOn(e.name)) continue;
    const venue = e._embedded?.venues?.[0]?.name; const date = e.dates?.start?.localDate;
    if (!venue || !date) continue;
    const k = keyOf(venue, date);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(e);
  }
  return index;
}

export function matchEvent(show, index) {
  const cands = index.get(keyOf(show.venue?.name, String(show.date).slice(0, 10))) || [];
  if (cands.length === 1) return cands[0];
  if (cands.length === 0) return null;
  const artist = normName(show.artist);
  const byName = cands.filter(c => artist && (normName(c.name).includes(artist) || artist.includes(normName(c.name))));
  if (byName.length === 1) return byName[0];
  const skMin = String(show.date).length > 10 ? minutes(String(show.date).slice(11, 16)) : null;
  if (skMin == null) return null;
  const pool = byName.length ? byName : cands;
  const timed = pool.map(c => ({ c, d: Math.abs((minutes(c.dates?.start?.localTime) ?? 1e9) - skMin) }))
    .filter(x => x.d <= TIME_TOLERANCE_MIN).sort((a, b) => a.d - b.d);
  if (timed.length === 0 || (timed.length > 1 && timed[0].d === timed[1].d)) return null;
  return timed[0].c;
}

const SELLERS = [[/(^|\.)universe\.com$/, "Universe"], [/(^|\.)livenation\./, "Live Nation"], [/(^|\.)ticketweb\./, "TicketWeb"], [/(^|\.)frontgatetickets\.com$/, "Front Gate Tickets"]];

export function toTicket(e) {
  let url;
  try { url = new URL(e.url); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const seller = (SELLERS.find(([re]) => re.test(url.hostname)) || [, "Ticketmaster"])[1];
  const ranges = (e.priceRanges || []).filter(r => !/fee/i.test(r.type || ""));
  const std = ranges.find(r => r.type === "standard") || null;
  const pool = std ? [std] : ranges;
  const t = { seller, url: url.href, status: e.dates?.status?.code || "unknown" };
  if (pool.length) {
    t.currency = pool[0].currency;
    t.priceMin = Math.min(...pool.map(r => r.min).filter(Number.isFinite));
    t.priceMax = Math.max(...pool.map(r => r.max).filter(Number.isFinite));
  }
  return t;
}
