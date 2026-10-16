import test from "node:test";
import assert from "node:assert/strict";
import { normName, isAddOn, indexTmEvents, matchEvent, toTicket } from "../scripts/ticketmaster/match.mjs";

const tm = (id, name, venue, localDate, localTime, extra = {}) => ({
  id, name, url: `https://www.ticketmaster.co.uk/x/event/${id}`,
  dates: { start: { localDate, ...(localTime ? { localTime } : {}) }, status: { code: "onsale" } },
  _embedded: { venues: [{ name: venue }] }, ...extra,
});
const sk = (artist, venue, date) => ({ id: "sk-1", artist, date, venue: { name: venue } });

test("normName strips case, accents, leading 'the', punctuation and &", () => {
  assert.equal(normName("The O2 Academy Brixton"), "o2 academy brixton");
  assert.equal(normName("Café de la Danse"), "cafe de la danse");
  assert.equal(normName("Rock & Roll Hotel!"), "rock and roll hotel");
});

test("isAddOn flags parking, upsell and package listings", () => {
  assert.ok(isAddOn("Parking: Behemoth"));
  assert.ok(isAddOn("VIP Package - Doja Cat"));
  assert.ok(!isAddOn("Behemoth & Dimmu Borgir"));
});

test("single candidate at the same venue and date matches", () => {
  const idx = indexTmEvents([tm("A", "Warren Zeiders", "Roundhouse", "2026-10-18", "19:00:00")]);
  assert.equal(matchEvent(sk("Warren Zeiders", "Roundhouse", "2026-10-18T19:00:00"), idx)?.id, "A");
});

test("different date or venue does not match", () => {
  const idx = indexTmEvents([tm("A", "Warren Zeiders", "Roundhouse", "2026-10-19", "19:00:00")]);
  assert.equal(matchEvent(sk("Warren Zeiders", "Roundhouse", "2026-10-18T19:00:00"), idx), null);
  assert.equal(matchEvent(sk("Warren Zeiders", "Scala", "2026-10-19T19:00:00"), idx), null);
});

test("several shows at one venue on one day: pick by artist name, then by start time", () => {
  const idx = indexTmEvents([
    tm("EARLY", "Matinee Kids Show", "Roundhouse", "2026-10-18", "14:00:00"),
    tm("LATE", "Night Set", "Roundhouse", "2026-10-18", "21:00:00"),
    tm("NAMED", "Behemoth & Dimmu Borgir", "Roundhouse", "2026-10-18", "18:30:00"),
  ]);
  assert.equal(matchEvent(sk("Behemoth", "Roundhouse", "2026-10-18T19:00:00"), idx)?.id, "NAMED");
  assert.equal(matchEvent(sk("Someone Else", "Roundhouse", "2026-10-18T20:30:00"), idx)?.id, "LATE");
  assert.equal(matchEvent(sk("Someone Else", "Roundhouse", "2026-10-18"), idx), null, "no name match and no time: ambiguous");
});

test("add-on listings are never matched", () => {
  const idx = indexTmEvents([tm("P", "Parking - Roundhouse", "Roundhouse", "2026-10-18", "19:00:00")]);
  assert.equal(matchEvent(sk("Warren Zeiders", "Roundhouse", "2026-10-18T19:00:00"), idx), null);
});

test("toTicket names the seller from the url host and keeps status and price", () => {
  const t = toTicket(tm("A", "X", "V", "2026-10-18", null, { priceRanges: [{ type: "standard", currency: "GBP", min: 25, max: 40.5 }] }));
  assert.deepEqual(t, { seller: "Ticketmaster", url: "https://www.ticketmaster.co.uk/x/event/A", status: "onsale", currency: "GBP", priceMin: 25, priceMax: 40.5 });
  const u = toTicket({ ...tm("B", "X", "V", "2026-10-18"), url: "https://www.universe.com/events/x?ref=ticketmaster" });
  assert.equal(u.seller, "Universe");
  assert.equal(toTicket({ ...tm("C", "X", "V", "2026-10-18"), url: "javascript:alert(1)" }), null);
});
