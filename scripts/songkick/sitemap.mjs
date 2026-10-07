// Enumerates every Songkick metro area from the public sitemap files.
const SITEMAP_FILES = [
  "https://www.songkick.com/sitemap/metro_areas.0.xml.gz",
  "https://www.songkick.com/sitemap/metro_areas.1.xml.gz",
];
const LOC_RE = /<loc>https:\/\/www\.songkick\.com\/metro-areas\/(\d+)-([^<\/]+)/g;

export function parseMetroSitemap(xml) {
  const byId = new Map();
  for (const [, id, slug] of xml.matchAll(LOC_RE)) {
    const n = Number(id);
    if (!byId.has(n)) byId.set(n, { id: n, slug, url: `https://www.songkick.com/metro-areas/${n}-${slug}` });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export async function listMetroAreas(fetchGzipText) {
  const all = [];
  for (const url of SITEMAP_FILES) all.push(...parseMetroSitemap(await fetchGzipText(url)));
  const byId = new Map(all.map(m => [m.id, m]));
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
