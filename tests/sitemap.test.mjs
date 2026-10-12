import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMetroSitemap, listMetroAreas } from "../scripts/songkick/sitemap.mjs";

test("parseMetroSitemap dedupes and strips suffixes", () => {
  const xml = readFileSync(new URL("./fixtures/metro_areas.snippet.xml", import.meta.url), "utf8");
  assert.deepEqual(parseMetroSitemap(xml), [
    { id: 28, slug: "us-brownsville", url: "https://www.songkick.com/metro-areas/28-us-brownsville" },
    { id: 11086, slug: "us-san-diego", url: "https://www.songkick.com/metro-areas/11086-us-san-diego" },
    { id: 57563, slug: "germany-crailsheim", url: "https://www.songkick.com/metro-areas/57563-germany-crailsheim" },
  ]);
});

test("listMetroAreas fetches both sitemap files and merges", async () => {
  const urls = [];
  const fake = async u => { urls.push(u); return `<urlset><url><loc>https://www.songkick.com/metro-areas/${urls.length}-a</loc></url></urlset>`; };
  const r = await listMetroAreas(fake);
  assert.deepEqual(urls, ["https://www.songkick.com/sitemap/metro_areas.0.xml.gz", "https://www.songkick.com/sitemap/metro_areas.1.xml.gz"]);
  assert.equal(r.length, 2);
});
