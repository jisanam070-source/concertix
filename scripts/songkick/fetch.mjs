// The only module that talks to songkick.com. Browser-like headers (plain curl
// gets HTTP 406), a global rate limit, timeouts and retries on transient errors.
import { gunzipSync } from "node:zlib";

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

  async function request(url) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      let response, error;
      try {
        response = await fetchImpl(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        error = e;
      }
      if (response && response.ok) return response;
      const retryable = error || isTransient(response.status);
      if (!retryable || attempt >= MAX_RETRIES) {
        throw error || new Error(`HTTP ${response.status} ${url}`);
      }
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
