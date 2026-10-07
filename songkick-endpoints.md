# Songkick endpoints extracted from HAR captures

Source: `www.songkick.com.har` (78 entries, 2026-10-04) and `www.songkick.com.har 2` (1173 entries, 2026-10-05), both recorded with Chrome DevTools (mobile emulation).
Static assets (JS/CSS/images on `sk-static.com`) are omitted.

## 1. JSON API (the only true API call in the capture)

| Method | URL | Returns |
|---|---|---|
| GET | `https://www.songkick.com/api/universal_search?query=<text>` | JSON. `data.attributes.search_results` has `artists[]`, `venues[]`, `locations[]` (metro areas) with `primary_key_id`, `name`, `number_of_events`, `popularity`. Also echoes the raw Elasticsearch query. |

Request headers that mattered: `accept: */*`, `referer: https://www.songkick.com/`. No auth, no cookies required.
Note: this endpoint returns **artists / venues / metro areas**, not events. It is useful for resolving a city name to a `metro-areas/{id}`.

## 2. HTML pages containing structured event data (schema.org JSON-LD)

| Method | URL pattern | Structured data inside |
|---|---|---|
| GET | `https://www.songkick.com/concerts/{id}-{slug}` | `<script type="application/ld+json">` with one `MusicEvent`: `name`, `startDate` (ISO, sometimes date-only), `location` (Place: name, address, geo), `performer[]` (name, genre[], Songkick artist URL), `image`, `eventStatus`, `url`. |
| GET | `https://www.songkick.com/metro-areas/{id}-{slug}` | JSON-LD list of `MusicEvent` for upcoming shows in that metro (the captured Jind page had no events, so only a `City` object). |
| GET | `https://www.songkick.com/artists/{id}-{slug}` | Artist page with upcoming events (JSON-LD `MusicEvent[]`). `/artists/{id}/calendar` is the full upcoming list. |
| GET | `https://www.songkick.com/venues/{id}-{slug}` | Venue page with upcoming events. |
| GET | `https://www.songkick.com/search?query=<text>&type=` | HTML search results (`li.venue`, `li.small-city`, `li.artist`, `li.event`) with `data-id` and `data-resource-name`. |

## 3. HTML fragments (server-rendered partials loaded by the homepage)

| Method | URL | Content |
|---|---|---|
| GET | `/fragments/trending_metro_events` | Cards `button.related-events-v2__event-card` with `data-event-id`, `data-event-url`, artist image, title, date. Metro comes from cookie/geo. |
| GET | `/fragments/popular_artists_in_metro` | Popular artists list for the current metro. |
| GET | `/fragments/biggest_tours_carousel` | Carousel of big tours. |
| GET | `/en/artists/{id}/fragments/best_bet_box` | "Best bet" box for an artist. |
| GET | `/metro-areas/nearby` | 302 redirect to the geo-detected metro page. |

## 4. Observed example IDs

- Concert 42815766: Doja Cat @ Madison Square Garden, 2026-12-01T19:30
- Concert 43407555: Stevie Wonder @ Madison Square Garden, 2026-11-19
- Concert 43400483: Mason Jennings @ Cafe Wha?, 2026-11-20T18:30
- Metro 29694: India / Jind; Metro 11086: US / San Diego
- Artist 460: Mason Jennings; Artist 402912: Boney M

## 5. Not in the capture

The official Songkick REST API (`https://api.songkick.com/api/3.0/...`, needs an approved `apikey`) does not appear. The website itself is rendered server-side; event lists come as HTML + JSON-LD, not JSON. Songkick's terms of use do not permit scraping the website, so a production integration should request an API key at https://www.songkick.com/developer.
