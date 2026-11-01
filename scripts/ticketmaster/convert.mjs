// Converts a Ticketmaster Discovery event into the site's show format.
import { isAddOn, toTicket } from "./match.mjs";

const MUSIC_GENRES = [
  [/rock|metal|punk|hard/i, "rock"], [/pop|alternative|indie|new age/i, "indie"], [/dance|electronic|house|techno/i, "electronic"],
  [/jazz|blues|r&b|soul|funk/i, "jazz"], [/hip-?hop|rap|r&b/i, "hiphop"], [/country|folk|classical|acoustic|bluegrass|world|religious|holiday/i, "acoustic"],
];
const STATUS = { cancelled: "cancelled", canceled: "cancelled", postponed: "postponed", rescheduled: "postponed" };
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// Coarse category for the home page rows. Songkick shows have no category and count as music.
export function tmCategory(classifications) {
  const c = (classifications || []).find(x => x.primary) || (classifications || [])[0];
  const seg = c?.segment?.name || "", genre = c?.genre?.name || "";
  if (seg === "Music") return "music";
  if (seg === "Sports") return "sports";
  if (seg === "Arts & Theatre") return /comedy/i.test(genre) ? "comedy" : "theatre";
  return "other";
}

export function tmGenre(classifications) {
  const c = (classifications || []).find(x => x.primary) || (classifications || [])[0];
  if (!c) return "other";
  if (c.segment?.name !== "Music") return "other";
  const g = c.genre?.name || "";
  // R&B is listed under jazz/soul by the first rule only when it is not rap; check hip-hop first.
  if (/hip-?hop|rap/i.test(g)) return "hiphop";
  if (/r&b/i.test(g)) return "hiphop";
  for (const [re, key] of MUSIC_GENRES) if (re.test(g)) return key;
  return "indie";
}

function bestImage(images) {
  const ok = (images || []).filter(i => /^https:\/\//.test(i.url || "") && (i.width || 0) >= 300);
  const wide = ok.filter(i => i.ratio === "16_9").sort((a, b) => b.width - a.width);
  return (wide[0] || ok.sort((a, b) => b.width - a.width)[0])?.url || "";
}

export function tmToShow(e) {
  if (!e || !SAFE_ID.test(String(e.id || "")) || isAddOn(e.name)) return null;
  const ticket = toTicket(e); if (!ticket) return null;
  const start = e.dates?.start || {}; if (!start.localDate) return null;
  const c = (e.classifications || []).find(x => x.primary) || (e.classifications || [])[0] || {};
  const segment = c.segment?.name || "";
  const acts = (e._embedded?.attractions || []).map(a => a.name).filter(Boolean);
  const music = segment === "Music" && acts.length > 0;
  const v = e._embedded?.venues?.[0] || {};
  const num = x => (x == null || x === "" || !isFinite(Number(x))) ? null : Number(x);
  return {
    id: `tm-${e.id}`,
    artist: music ? acts[0] : (e.name || acts[0] || "Event"),
    support: music && acts.length > 1 ? `with ${acts.slice(1).join(", ")}` : "",
    genre: tmGenre(e.classifications),
    category: tmCategory(e.classifications),
    venue: { name: v.name || "", city: v.city?.name || "", region: v.state?.stateCode || "", country: v.country?.countryCode || "", lat: num(v.location?.latitude), lng: num(v.location?.longitude) },
    date: start.localTime && !start.timeTBA && !start.noSpecificTime ? `${start.localDate}T${start.localTime.slice(0, 8)}` : start.localDate,
    image: bestImage(e.images),
    status: STATUS[e.dates?.status?.code] || "scheduled",
    source: "ticketmaster",
    tickets: [ticket],
  };
}
