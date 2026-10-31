import test from "node:test";
import assert from "node:assert/strict";
import { tmToShow, tmGenre } from "../scripts/ticketmaster/convert.mjs";

const base = (over = {}) => ({
  id: "G5vYZ1", name: "Calgary Hitmen vs. Medicine Hat Tigers", url: "https://www.ticketmaster.ca/x/event/110064FBA59A53F0",
  images: [{ ratio: "3_2", url: "https://s1.ticketm.net/a.jpg", width: 640 }, { ratio: "16_9", url: "https://s1.ticketm.net/b.jpg", width: 1024 }, { ratio: "16_9", url: "https://s1.ticketm.net/small.jpg", width: 205 }],
  dates: { start: { localDate: "2026-10-23", localTime: "19:00:00" }, status: { code: "onsale" }, timezone: "America/Edmonton" },
  classifications: [{ primary: true, segment: { name: "Sports" }, genre: { name: "Hockey" } }],
  _embedded: { venues: [{ id: "KovZpZAFFl7A", name: "Scotiabank Saddledome", city: { name: "Calgary" }, state: { stateCode: "AB" }, country: { countryCode: "CA" }, location: { latitude: "51.0385626", longitude: "-114.0524879" } }],
    attractions: [{ name: "Calgary Hitmen" }, { name: "Medicine Hat Tigers" }] },
  ...over,
});

test("tmGenre maps Ticketmaster music genres to the site's keys and everything else to other", () => {
  const g = (segment, genre) => tmGenre([{ primary: true, segment: { name: segment }, genre: { name: genre } }]);
  assert.equal(g("Music", "Rock"), "rock"); assert.equal(g("Music", "Metal"), "rock");
  assert.equal(g("Music", "Pop"), "indie"); assert.equal(g("Music", "Alternative"), "indie");
  assert.equal(g("Music", "Dance/Electronic"), "electronic");
  assert.equal(g("Music", "Jazz"), "jazz"); assert.equal(g("Music", "Blues"), "jazz"); assert.equal(g("Music", "R&B"), "hiphop");
  assert.equal(g("Music", "Hip-Hop/Rap"), "hiphop");
  assert.equal(g("Music", "Country"), "acoustic"); assert.equal(g("Music", "Folk"), "acoustic"); assert.equal(g("Music", "Classical"), "acoustic");
  assert.equal(g("Music", "Latin"), "indie", "unknown music genre falls back to indie");
  assert.equal(g("Sports", "Hockey"), "other"); assert.equal(g("Arts & Theatre", "Comedy"), "other");
  assert.equal(tmGenre(undefined), "other");
});

test("tmToShow converts a sports event: title is the event name, no support act", () => {
  const s = tmToShow(base());
  assert.equal(s.id, "tm-G5vYZ1");
  assert.equal(s.artist, "Calgary Hitmen vs. Medicine Hat Tigers");
  assert.equal(s.support, "");
  assert.equal(s.genre, "other");
  assert.equal(s.date, "2026-10-23T19:00:00");
  assert.deepEqual(s.venue, { name: "Scotiabank Saddledome", city: "Calgary", region: "AB", country: "CA", lat: 51.0385626, lng: -114.0524879 });
  assert.equal(s.image, "https://s1.ticketm.net/b.jpg", "widest 16:9 image at least 300px");
  assert.equal(s.status, "scheduled");
  assert.equal(s.source, "ticketmaster");
  assert.deepEqual(s.tickets, [{ seller: "Ticketmaster", url: "https://www.ticketmaster.ca/x/event/110064FBA59A53F0", status: "onsale" }]);
});

test("tmToShow converts a concert: headliner from attractions, support from the rest", () => {
  const s = tmToShow(base({ name: "Behemoth: The Unholy Trinity Tour", classifications: [{ primary: true, segment: { name: "Music" }, genre: { name: "Metal" } }],
    _embedded: { ...base()._embedded, attractions: [{ name: "Behemoth" }, { name: "Dimmu Borgir" }] } }));
  assert.equal(s.artist, "Behemoth"); assert.equal(s.support, "with Dimmu Borgir"); assert.equal(s.genre, "rock");
});

test("tmToShow handles time TBA, cancelled and postponed statuses", () => {
  assert.equal(tmToShow(base({ dates: { start: { localDate: "2026-12-01", timeTBA: true }, status: { code: "onsale" } } })).date, "2026-12-01");
  assert.equal(tmToShow(base({ dates: { start: { localDate: "2026-12-01", localTime: "20:00:00" }, status: { code: "cancelled" } } })).status, "cancelled");
  assert.equal(tmToShow(base({ dates: { start: { localDate: "2026-12-01", localTime: "20:00:00" }, status: { code: "rescheduled" } } })).status, "postponed");
});

test("tmToShow returns null for add-ons, missing dates and non-https urls", () => {
  assert.equal(tmToShow(base({ name: "Parking: Flames vs Bruins" })), null);
  assert.equal(tmToShow(base({ dates: { start: {}, status: { code: "onsale" } } })), null);
  assert.equal(tmToShow(base({ url: "http://insecure.example/x" })), null, "no ticket link means no show");
  assert.equal(tmToShow(base({ id: "bad id/with*chars" })), null);
});
