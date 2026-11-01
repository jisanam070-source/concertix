#!/usr/bin/env python3
"""Checks the category-row home page (Concerts / Sports / Theatre / Comedy) in headless Chromium.
Serve dist/ first, then: python3 tests/browser/check-home.py http://127.0.0.1:8081/"""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8081/"
ok = True
def check(name, cond, detail=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else "")); ok = ok and cond

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900}); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(URL); pg.evaluate("localStorage.clear()"); pg.goto(URL)
    pg.wait_for_selector("#home .cat-row .hcard", timeout=20000)
    rows = pg.evaluate("[...document.querySelectorAll('#home .cat-row')].map(r=>({cat:r.dataset.cat, title:r.querySelector('h2').textContent.trim(), explore:r.querySelector('[data-explore]')?.textContent.trim(), cards:r.querySelectorAll('.hcard').length}))")
    titles = [r["title"] for r in rows]
    check("home shows category rows", "Concerts" in titles and "Sports" in titles and "Theatre" in titles and "Comedy" in titles, ", ".join(titles))
    check("every row has cards and an Explore link", all(r["cards"] > 0 and r["explore"] and r["explore"].startswith("Explore") for r in rows), json.dumps(rows)[:200])
    check("rows are capped so the page stays light", all(r["cards"] <= 24 for r in rows))
    card = pg.evaluate("""() => { const c=document.querySelector('#home .cat-row[data-cat="music"] .hcard'); return { title:c.querySelector('b').textContent, when:c.querySelector('.hcard-when').textContent, near:c.querySelector('.hcard-near').textContent, img:!!c.querySelector('img, svg'), save:!!c.querySelector('[data-save]') } }""")
    check("a card shows title, date, count and image", card["title"] and card["when"] and card["img"] and card["save"], json.dumps(card))
    check("date reads like 'Sat, 5 Dec • 15:00' or a range '1 Nov - 21 Nov'", bool(re.search(r"^(\w{3}, \d{1,2} \w{3}( \d{4})?( • \d{2}:\d{2}| • Time TBA)?|\d{1,2} \w{3}( \d{4})? - \d{1,2} \w{3}( \d{4})?)$", card["when"])), card["when"])
    check("count reads 'N shows in <city>'", re.match(r"^\d+ shows? in .+", card["near"]) is not None, card["near"])
    check("the old results grid is not drawn on the home page", pg.evaluate("document.querySelectorAll('#results article.card').length") == 0)
    # Carousel arrows scroll the rail
    before = pg.evaluate("document.querySelector('#home .cat-row[data-cat=\"music\"] .rail').scrollLeft")
    pg.click('#home .cat-row[data-cat="music"] [data-dir="next"]'); pg.wait_for_timeout(600)
    check("the arrow scrolls the row", pg.evaluate("document.querySelector('#home .cat-row[data-cat=\"music\"] .rail').scrollLeft") > before)
    # Explore -> full list filtered to that category
    pg.click('#home .cat-row[data-cat="sports"] [data-explore]'); pg.wait_for_selector("#results article.card:not(.skeleton)")
    txt = pg.evaluate("document.querySelector('#resultCount').textContent")
    check("Explore Sports opens the list filtered to sports", pg.evaluate("document.querySelector('#home').hidden") and "sports" in txt.lower(), txt)
    check("list cards after Explore Sports are all sports", pg.evaluate("[...document.querySelectorAll('#results article.card .genre-tag')].every(t=>/sports/i.test(t.textContent))"))
    pg.click("nav a[data-home]"); pg.wait_for_selector("#home:not([hidden]) .hcard")
    check("nav returns to the home rows", pg.evaluate("document.querySelector('#shows').hidden"))
    # Typing in search switches to the list
    pg.fill("#q", "the"); pg.wait_for_selector("#results article.card:not(.skeleton)")
    check("typing a search opens the list view", pg.evaluate("document.querySelector('#home').hidden"))
    # A card with one show opens that show's page; with many shows opens the list filtered to the act
    pg.click("nav a[data-home]"); pg.wait_for_selector("#home:not([hidden]) .hcard")
    pg.click('#home .cat-row[data-cat="music"] .hcard a.hcard-link'); pg.wait_for_timeout(600)
    check("clicking a card opens a show page or the act's list", pg.evaluate("!document.querySelector('#eventPage').hidden || (!document.querySelector('#shows').hidden && document.querySelector('#q').value.length>0)"))
    pg.click("nav a[data-home]"); pg.wait_for_selector("#home:not([hidden]) .hcard")
    one = pg.evaluate("""() => { const a=[...document.querySelectorAll('#home .hcard-link')].find(a=>a.getAttribute('href').startsWith('#/event/')); return a ? a.querySelector('[data-save]').dataset.save : null }""")
    if one:
        before_hash = pg.evaluate("location.hash")
        pg.click(f"#home [data-save='{one}']"); pg.wait_for_timeout(300)
        check("the heart on a home card saves without opening the show", pg.evaluate("location.hash") == before_hash and pg.evaluate(f"document.querySelector(\"#home [data-save='{one}']\").getAttribute('aria-pressed')") == "true" and not pg.evaluate("document.querySelector('#eventPage').hidden") is False)
    pg3 = b.new_page(viewport={"width": 375, "height": 812}); pg3.goto(URL); pg3.wait_for_selector("#home .cat-row .hcard")
    check("no horizontal page overflow on a phone", not pg3.evaluate("document.documentElement.scrollWidth > innerWidth + 1"))
    pg3.screenshot(path=str(Path(__file__).resolve().parents[2] / "dist" / "home-mobile.png"), full_page=False)
    pg.screenshot(path=str(Path(__file__).resolve().parents[2] / "dist" / "home-desktop.png"), full_page=False)
    check("no console errors", not errors, "; ".join(errors[:3]))
    b.close()
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
