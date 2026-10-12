// Pure parser: Songkick metro calendar HTML → normalized events. No I/O.
import { mapGenre } from "./genres.mjs";

const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const PAGE_RE = /[?&]page=(\d+)/g;
const UPCOMING_RE = /(\d[\d,]*)\s+upcoming/;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/;
const SONGKICK_URL_RE = /^https:\/\/www\.songkick\.com\//;
const CONCERT_ID_RE = /\/(?:concerts|id)\/(\d+)/;

function statusOf(eventStatus = "") {
  if (eventStatus.endsWith("EventCancelled")) return "cancelled";
  if (eventStatus.endsWith("EventPostponed")) return "postponed";
  return "scheduled";
}

function normalize(ev) {
  const url = String(ev.url || "").split("?")[0];
  // Scraped URLs end up in href/src attributes, so only trust Songkick https links.
  if (!SONGKICK_URL_RE.test(url)) return null;
  const idMatch = url.match(CONCERT_ID_RE);
  if (!idMatch) return null;
  const performers = Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : [];
  const [main, ...others] = performers;
  const loc = ev.location || {}; const addr = loc.address || {}; const geo = loc.geo || {};
  return {
    id: `sk-${idMatch[1]}`,
    artist: main?.name || String(ev.name || "").split(" @ ")[0],
    support: others.length ? `with ${others.map(p => p.name).filter(Boolean).join(", ")}` : "",
    genre: mapGenre(main?.genre),
    skGenres: main?.genre || [],
    venue: {
      name: loc.name || "", city: addr.addressLocality || "", region: addr.addressRegion || "",
      country: addr.addressCountry || "", lat: geo.latitude ?? null, lng: geo.longitude ?? null,
    },
    date: String(ev.startDate || ""),
    image: /^https:\/\//.test(String(ev.image || "")) ? ev.image : "",
    url,
    status: statusOf(ev.eventStatus),
  };
}

export function parseMetroPage(html) {
  const events = [];
  for (const [, raw] of html.matchAll(LD_RE)) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    for (const obj of Array.isArray(parsed) ? parsed : [parsed]) {
      if (obj && obj["@type"] === "MusicEvent") {
        const ev = normalize(obj);
        if (ev && ev.date) events.push(ev);
      }
    }
  }
  const pages = [...html.matchAll(PAGE_RE)].map(m => Number(m[1]));
  const lastPage = Math.max(1, ...pages);
  const up = html.match(UPCOMING_RE);
  const upcomingCount = up ? Number(up[1].replace(/,/g, "")) : null;
  const title = html.match(TITLE_RE)?.[1] ?? "";
  const nameMatch = title.match(/^\s*(.*?)\s+Concerts\b/);
  const metroName = nameMatch ? nameMatch[1].replace(/&amp;/g, "&") : null;
  return { events, lastPage, upcomingCount, metroName };
}
