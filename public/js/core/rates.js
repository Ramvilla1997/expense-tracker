// @ts-check
// CAD→INR reference rate from the European Central Bank via Frankfurter (free, no key).
export const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=CAD&symbols=INR';
export const FALLBACK_RATE = 61; // used only before the first successful fetch
const STORAGE_KEY = 'tally.rate.v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * @typedef {Object} RateInfo
 * @property {number} rate INR per 1 CAD
 * @property {string} date the rate's publication date, or ''
 * @property {number} fetchedAt epoch ms, 0 when never fetched
 * @property {'live'|'saved'|'fallback'} source
 */

/** @param {any} json @returns {{rate:number, date:string}|null} */
export function parseRateResponse(json) {
  const rate = Number(json?.rates?.INR);
  if (!Number.isFinite(rate) || rate < 10 || rate > 500) return null; // sanity band
  return { rate, date: typeof json?.date === 'string' ? json.date : '' };
}

/** @param {Pick<Storage,'getItem'>|null} storage @returns {RateInfo} */
export function readSavedRate(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    const parsed = parseRateResponse({ rates: { INR: saved?.rate }, date: saved?.date });
    if (parsed && Number.isFinite(saved.fetchedAt)) return { ...parsed, fetchedAt: saved.fetchedAt, source: 'saved' };
  } catch { /* corrupt or unavailable storage: fall through */ }
  return { rate: FALLBACK_RATE, date: '', fetchedAt: 0, source: 'fallback' };
}

/** @param {RateInfo} info @param {number} now */
export const isStale = (info, now) => info.source === 'fallback' || now - info.fetchedAt > MAX_AGE_MS;

/**
 * Returns a fresh rate when possible, otherwise the saved or fallback one. Never throws.
 * @param {{ fetchFn?: typeof fetch, storage?: Pick<Storage,'getItem'|'setItem'>|null, now?: number }} [deps]
 * @returns {Promise<RateInfo>}
 */
export async function loadRate({ fetchFn = globalThis.fetch, storage = safeStorage(), now = Date.now() } = {}) {
  const saved = readSavedRate(storage);
  if (!isStale(saved, now)) return saved;
  try {
    const response = await fetchFn(RATE_URL, { cache: 'no-store' });
    if (!response.ok) return saved;
    const parsed = parseRateResponse(await response.json());
    if (!parsed) return saved;
    const info = /** @type {RateInfo} */ ({ ...parsed, fetchedAt: now, source: 'live' });
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(info)); } catch { /* quota/private mode */ }
    return info;
  } catch {
    return saved;
  }
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
