#!/usr/bin/env python3
"""End-to-end checks of the built site in headless Chromium.

Needs Playwright for Python with Chromium installed. Serve dist/ first, e.g.
    cp Concertix.html dist/index.html && python3 -m http.server -d dist 8081
then run:
    python3 tests/browser/check-site.py http://127.0.0.1:8081/
"""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8081/"
DATA = Path(__file__).resolve().parents[2] / "dist" / "data"
ok = True
def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else "")); ok = ok and cond

index = json.loads((DATA / "index.json").read_text())
metro = next(m for m in index.metros if False) if False else max(index["metros"], key=lambda m: m["count"])
events = json.loads((DATA / "metros" / f"{metro['id']}.json").read_text())["events"]
def today_js(pg): return pg.evaluate("(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})()")

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True); pg = ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "loadMetro" not in m.text else None)
    pg.goto(URL); pg.evaluate("localStorage.clear()"); pg.goto(URL); pg.wait_for_selector("#home .hcard")
    pg.click("nav a[data-explore='music']"); pg.wait_for_selector("#results article.card:not(.skeleton)")  # the list view, filtered to concerts
    today = today_js(pg)
    upcoming = [e for e in events if e["date"][:10] >= today and (e.get("category") or ("other" if e.get("genre") == "other" else "music")) == "music"]
    with_ticket = next((e for e in upcoming if e.get("tickets")), None)
    without_ticket = next((e for e in upcoming if not e.get("tickets")), None)
    tm_only = next((e for e in upcoming if e.get("source") == "ticketmaster"), None)

    # List view
    check("page loads the largest city by default", metro["name"] in pg.evaluate("document.querySelector('#resultCount').textContent"))
    check("no songkick links in grid view", pg.evaluate("[...document.querySelectorAll('a[href]')].filter(a=>/songkick\\.com/.test(a.href)).length") == 0)
    pg.click("#viewAgenda"); check("no songkick links in agenda view", pg.evaluate("[...document.querySelectorAll('a[href]')].filter(a=>/songkick\\.com/.test(a.href)).length") == 0); pg.click("#viewGrid")
    check("hero button opens an on-site event page", (pg.evaluate("document.querySelector('#stubBtn').getAttribute('href')") or "").startswith("#/event/"))
    shown_text = pg.evaluate("document.querySelector('#resultCount').textContent")
    check("past events are hidden (concert count in the summary line)", f"{len(upcoming):,}" in shown_text, f"{len(upcoming):,} expected; got {shown_text}")
    check("only the first page of cards is drawn", 0 < pg.evaluate("document.querySelectorAll('#results article.card').length") <= 48)
    if len(upcoming) > 48:
        pg.click("#showMore"); pg.wait_for_function("document.querySelectorAll('#results article.card').length > 48")
        check("Show more draws the next page", True)
    hero_title = pg.evaluate("document.querySelector('#stubTitle').textContent")
    hero_ev = next((e for e in upcoming if e["artist"] == hero_title), None)
    check("hero Next up is not a sports/comedy show when music exists", hero_ev is not None and (hero_ev["genre"] != "other" or all(e["genre"] == "other" for e in upcoming)), hero_title)
    check("tours strip has no 'vs.' sports fixtures", not any(" vs" in t for t in pg.evaluate("[...document.querySelectorAll('#tourList .tour b')].map(b=>b.textContent)")))

    # Card -> event page -> back
    target = "#results article.card:nth-child(10) .card-foot a"
    pg.click("#viewGrid"); pg.wait_for_selector(target)
    pg.locator(target).scroll_into_view_if_needed(); y_before = pg.evaluate("scrollY")
    first = pg.evaluate("(s)=>{const a=document.querySelector(s); return {artist:a.closest('article').querySelector('h3').textContent, href:a.getAttribute('href'), label:a.textContent}}", target)
    check("card button is View details and links on-site", first["label"].strip() == "View details" and first["href"].startswith("#/event/"), first["href"])
    pg.click(target); pg.wait_for_selector("#eventPage:not([hidden]) h1")
    ev = pg.evaluate("""() => ({ h1: document.querySelector('#eventPage h1').textContent, hidden: document.querySelector('#shows').hidden, title: document.title, hash: location.hash,
      sk: [...document.querySelectorAll('a[href]')].filter(a=>/songkick\\.com/.test(a.href)).length, text: document.querySelector('#eventPage').innerText.toLowerCase(),
      cal: !!document.querySelector('#eventPage [data-ics]'), map: !!document.querySelector('#eventPage iframe.ev-map'), more: document.querySelectorAll('#eventPage article.card').length, top: scrollY })""")
    check("event page shows the artist and hides the list", ev["h1"] == first["artist"] and ev["hidden"])
    check("event page has no songkick links", ev["sk"] == 0)
    check("event page shows date, time, venue, calendar, map, more shows", all(k in ev["text"] for k in ("date", "time", "venue")) and ev["cal"] and ev["map"] and ev["more"] > 0)
    check("event page opens at the top", ev["top"] < 50)
    with pg.expect_download() as d: pg.click("#eventPage [data-ics]")
    check("add to calendar downloads a VEVENT", "BEGIN:VEVENT" in open(d.value.path()).read())
    pg.go_back(); pg.wait_for_selector("#shows:not([hidden]) article.card")
    pg.wait_for_timeout(300)
    check("back restores the list scroll position", abs(pg.evaluate("scrollY") - y_before) < 150, f"{pg.evaluate('scrollY')} vs {y_before}")
    direct = URL + ev["hash"]; pg2 = ctx.new_page(); pg2.goto(direct); pg2.wait_for_selector("#eventPage:not([hidden]) h1")
    check("direct link opens the event page", pg2.evaluate("document.querySelector('#eventPage h1').textContent") == first["artist"])
    pg2.goto(URL + f"#/event/{metro['id']}/sk-1"); pg2.wait_for_selector("#eventPage:not([hidden]) h1")
    check("missing event shows a not-found message", "no longer listed" in pg2.evaluate("document.querySelector('#eventPage').innerText").lower())

    # Tickets panel
    if with_ticket:
        pg2.goto(URL + f"#/event/{metro['id']}/{with_ticket['id']}"); pg2.wait_for_function(f"document.querySelector('#eventPage h1')?.textContent==={json.dumps(with_ticket['artist'])}")
        links = pg2.evaluate("[...document.querySelectorAll('#eventPage .ev-tickets a')].map(a=>({href:a.href,target:a.target,rel:a.rel}))")
        check("Buy tickets panel links to the exact seller page in a new tab", len(links) == len(with_ticket["tickets"]) and links[0]["href"] == with_ticket["tickets"][0]["url"] and links[0]["target"] == "_blank" and "noopener" in links[0]["rel"])
    if without_ticket:
        pg2.goto(URL + f"#/event/{metro['id']}/{without_ticket['id']}"); pg2.wait_for_function(f"document.querySelector('#eventPage h1')?.textContent==={json.dumps(without_ticket['artist'])}")
        check("show without a link says so", "No ticket link" in pg2.evaluate("document.querySelector('#eventPage .ev-tickets')?.innerText||''"))
    if tm_only:
        pg2.goto(URL + f"#/event/{metro['id']}/{tm_only['id']}"); pg2.wait_for_function(f"document.querySelector('#eventPage h1')?.textContent==={json.dumps(tm_only['artist'])}")
        pg2.wait_for_function("(()=>{const i=document.querySelector('#eventPage .ev-art img'); return !i || i.complete})()")
        check("Ticketmaster-only show renders with its photo", (not tm_only["image"]) or pg2.evaluate("document.querySelector('#eventPage .ev-art img').naturalWidth") > 0)

    # 404 for a city file, then retry
    pg.route("**/metros/*.json", lambda r: r.fulfill(status=404, body="nope"))
    other = next(m for m in index["metros"] if m["id"] != metro["id"])
    pg.fill("#metroQ", other["name"][:6]); pg.wait_for_selector("#metroList:not([hidden]) .metro-opt"); pg.click(f".metro-opt[data-metro='{other['id']}']")
    pg.wait_for_selector("#retryLoad"); check("missing city file shows the error state", True)
    pg.unroute("**/metros/*.json"); pg.click("#retryLoad")
    pg.wait_for_timeout(500); pg.evaluate("document.querySelector('#shows').hidden && document.querySelector(\"nav a[data-explore='music']\").click()")
    try: pg.wait_for_selector("#results article.card:not(.skeleton)", timeout=20000); recovered = True
    except Exception: recovered = False
    check("retry recovers", recovered and other["name"] in pg.evaluate("document.querySelector('#resultCount').textContent"), pg.evaluate("document.querySelector('#resultCount').textContent + ' | ' + document.querySelector('#results').innerText.slice(0,80)"))

    pg3 = ctx.new_page(); pg3.set_viewport_size({"width": 375, "height": 812}); pg3.goto(direct); pg3.wait_for_selector("#eventPage:not([hidden]) h1")
    check("no horizontal overflow on a phone", not pg3.evaluate("document.documentElement.scrollWidth > innerWidth"))
    check("no console errors", not errors, "; ".join(errors[:3]))
    b.close()
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
