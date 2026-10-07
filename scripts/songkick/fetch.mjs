// The only module that talks to songkick.com. Songkick's edge answers HTTP 406
// to some header combinations: sitemap files reject browser headers, and some
// HTML pages reject them too, while an honest client UA is accepted. We send
// the plain client headers first and fall back to browser-like headers on 406.
import { gunzipSync } from "node:zlib";

export const CLIENT_HEADERS = { "User-Agent": "concertix-sync/1.0", "Accept": "*/*" };
export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MAX_RETRIES = 3;
const isTransient = status => status === 429 || status >= 500;

export function createFetcher({
  fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  minIntervalMs = 500,
  timeoutMs = 30000,
} = {}) {
  let lastRequestAt = 0;

  async function once(url, headers) {
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  }

  async function request(url) {
    let headers = CLIENT_HEADERS;
    for (let attempt = 0; ; attempt++) {
      let response, error;
      try { response = await once(url, headers); } catch (e) { error = e; }
      if (response?.ok) return response;
      if (response?.status === 406 && headers === CLIENT_HEADERS) { headers = BROWSER_HEADERS; continue; }
      const retryable = error || isTransient(response.status);
      if (!retryable || attempt >= MAX_RETRIES) throw error || new Error(`HTTP ${response.status} ${url}`);
      await sleep(1000 * 2 ** attempt);
    }
  }

  return {
    async fetchText(url) {
      return (await request(url)).text();
    },
    async fetchGzipText(url) {
      const buf = await (await request(url)).arrayBuffer();
      return gunzipSync(Buffer.from(buf)).toString("utf8");
    },
  };
}

export default createFetcher();
