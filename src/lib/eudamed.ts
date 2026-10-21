import { countryName, srnCountry } from "./countries";

// Thin server-side client for EUDAMED's public device API.
// These endpoints block direct browser calls (CORS), so everything goes through
// Next.js API routes that call these helpers.

const BASE = "https://ec.europa.eu/tools/eudamed/api";

const HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en",
  // EUDAMED rejects some default clients; present a browser-like UA.
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Rate limiting ---------------------------------------------------------
// EUDAMED allows about 20 requests per minute per client IP and answers 429
// beyond that. Every upstream call takes a slot from this one shared limiter
// (the service runs a single App Runner instance, so it covers all users).
// Searches jump ahead of detail lookups because a person is waiting on them.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 18;
const BLOCK_PAUSE_MS = 20_000; // after a 429; the block measured ~11s
const starts: number[] = [];
let pausedUntil = 0;
const waiters: { high: boolean; go: () => void }[] = [];
let pumping = false;

function slot(high: boolean): Promise<void> {
  return new Promise((go) => {
    const w = { high, go };
    const at = high ? waiters.findIndex((x) => !x.high) : -1;
    if (at === -1) waiters.push(w);
    else waiters.splice(at, 0, w);
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (waiters.length) {
    const now = Date.now();
    while (starts.length && now - starts[0] >= WINDOW_MS) starts.shift();
    const wait = Math.max(
      pausedUntil - now,
      starts.length >= MAX_PER_WINDOW ? starts[0] + WINDOW_MS - now : 0,
    );
    // Re-check at least every second: a 429 can move pausedUntil.
    if (wait > 0) {
      await sleep(Math.min(wait, 1000));
      continue;
    }
    starts.push(now);
    waiters.shift()!.go();
  }
  pumping = false;
}

// How many upstream calls are waiting for a slot (shown as progress hints).
export const queueLength = () => waiters.length;

// ---- Cache -----------------------------------------------------------------
// Device records rarely change, so repeat views and exports skip EUDAMED.
// Promises are cached, which also merges identical in-flight requests.
const MAX_ENTRIES = 20_000;
const cache = new Map<string, { at: number; v: Promise<any> }>();

function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  keep: (v: T) => boolean = () => true,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  const v = load();
  const entry = { at: Date.now(), v };
  cache.set(key, entry);
  // Drop failures and answers we don't trust, so the next request asks EUDAMED again.
  const drop = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  v.then((r) => {
    if (!keep(r)) drop();
  }, drop);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return v;
}

const HOUR = 3_600_000;

async function getJson<T>(
  url: string,
  { high = false, timeoutMs = 30_000, tries = 5 } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    await slot(high);
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status}`);
      if (res.status === 429) {
        pausedUntil = Math.max(pausedUntil, Date.now() + BLOCK_PAUSE_MS);
        continue;
      }
      if (res.status < 500) throw lastErr; // 4xx other than 429 won't recover
    } catch (err) {
      if (err === lastErr) throw err;
      lastErr = err; // network error or timeout
    }
    await sleep(2000 * (i + 1));
  }
  throw lastErr;
}

export interface SearchParams {
  cndCode?: string;
  deviceStatusCode?: string;
  page?: number;
  pageSize?: number;
}

export interface ListRow {
  uuid: string;
  tradeName: string | null;
  deviceName: string | null;
  deviceModel: string | null;
  riskClass?: { code?: string } | null;
  manufacturerName: string | null;
  manufacturerSrn: string | null;
  deviceStatusType?: { code?: string } | null;
  authorisedRepresentativeName: string | null;
  authorisedRepresentativeSrn: string | null;
  deviceCriterion: string | null;
  reference: string | null;
  basicUdi: string | null;
  primaryDi: string | null;
}

export interface SearchResult {
  content: ListRow[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export async function search(p: SearchParams): Promise<SearchResult> {
  const page = p.page ?? 0;
  const size = p.pageSize ?? 25;
  const q = new URLSearchParams({
    page: String(page),
    pageSize: String(size),
    size: String(size),
    iso2Code: "en",
    languageIso2Code: "en",
  });
  if (p.cndCode) q.set("cndCode", p.cndCode);
  if (p.deviceStatusCode) q.set("deviceStatusCode", p.deviceStatusCode);
  const url = `${BASE}/devices/udiDiData?${q.toString()}`;
  // EUDAMED takes ~30s per search page, so give it room.
  // An empty page is not cached: EUDAMED sometimes returns one by mistake,
  // and keeping it would hide real results for an hour.
  return cached(
    url,
    HOUR,
    () => getJson<SearchResult>(url, { high: true, timeoutMs: 100_000, tries: 2 }),
    (r) => (r.content?.length ?? 0) > 0,
  );
}

// Fields only present in the per-device detail records.
export interface Enrichment {
  deviceName: string | null;
  deviceModel: string | null;
  deviceCriterion: string | null;
  authorisedRepresentativeCountry: string | null;
  additionalDescription: string | null;
  marketDistribution: string | null;
  nbId: string | null;
  nbName: string | null;
  failed: boolean; // a detail lookup failed; fields above may be missing
}

// Multilingual text block -> English text, else the first one given.
function pickText(block: any): string | null {
  const texts: any[] = block?.texts ?? [];
  const en = texts.find((t) => t?.language?.isoCode === "en");
  return (en ?? texts[0])?.text ?? block?.textByDefaultLanguage ?? null;
}

// Member states where the device is or is to be made available.
function marketDistribution(udi: any): string | null {
  const names = ((udi?.marketInfoLink?.msWhereAvailable ?? []) as any[])
    .map((m) => m?.country?.name ?? countryName(m?.country?.iso2Code))
    .filter(Boolean) as string[];
  return names.length ? [...new Set(names)].sort().join(", ") : null;
}

// Notified bodies named on the device's certificates: NB number and name.
function notifiedBodies(basic: any): { nbId: string | null; nbName: string | null } {
  const nbs = new Map<string, string>();
  for (const c of (basic?.deviceCertificateInfoList ?? []) as any[]) {
    const nb = c?.notifiedBody;
    if (nb?.srn || nb?.name) nbs.set(nb.srn ?? nb.name, nb.name ?? "");
  }
  if (nbs.size === 0) return { nbId: null, nbName: null };
  return {
    nbId: [...nbs.keys()].join("; "),
    nbName: [...nbs.values()].filter(Boolean).join("; ") || null,
  };
}

// Basic UDI holds name/model/criterion/AR country/certificates and is shared by every pack
// size (UDI-DI) under it, so it is cached by Basic UDI. The UDI-DI record holds
// the additional product description and the market distribution.
export async function enrich(uuid: string, basicUdi?: string | null): Promise<Enrichment> {
  const basicUrl = `${BASE}/devices/basicUdiData/udiDiData/${uuid}?languageIso2Code=en`;
  const udiUrl = `${BASE}/devices/udiDiData/${uuid}?languageIso2Code=en`;
  const [b, u] = await Promise.all([
    cached(basicUdi ? `basic:${basicUdi}` : basicUrl, 24 * HOUR, () =>
      getJson<any>(basicUrl),
    ).catch(() => undefined),
    cached(udiUrl, 24 * HOUR, () => getJson<any>(udiUrl)).catch(() => undefined),
  ]);
  return {
    deviceName: b?.deviceName ?? null,
    deviceModel: b?.deviceModel ?? null,
    deviceCriterion: b?.deviceCriterion ?? null,
    authorisedRepresentativeCountry:
      b?.authorisedRepresentative?.countryName ?? null,
    additionalDescription: pickText(u?.additionalDescription),
    marketDistribution: marketDistribution(u),
    ...notifiedBodies(b),
    failed: b === undefined || u === undefined,
  };
}

// The flattened row the UI + exports consume.
export interface EnrichedRow {
  uuid: string;
  basicUdi: string | null;
  tradeName: string | null;
  deviceName: string | null;
  deviceModel: string | null;
  riskClassId: string | null;
  manufacturer: string | null;
  manufacturerSrn: string | null;
  deviceStatusId: string | null;
  authorisedRepresentative: string | null;
  authorisedRepresentativeCountry: string | null;
  authorisedRepresentativeSrn: string | null;
  criterion: string | null;
  reference: string | null;
  additionalDescription: string | null;
  marketDistribution: string | null;
  nbId: string | null;
  nbName: string | null;
}

// Run an async mapper over items with a bounded number of concurrent calls.
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Fast map of a list row to the UI shape WITHOUT any extra calls.
// The detail-only fields are left null and filled lazily on the client.
export function mapListRow(r: ListRow): EnrichedRow {
  return {
    uuid: r.uuid,
    basicUdi: r.basicUdi ?? null,
    tradeName: r.tradeName ?? null,
    deviceName: r.deviceName ?? null,
    deviceModel: r.deviceModel ?? null,
    riskClassId: r.riskClass?.code ?? null,
    manufacturer: r.manufacturerName ?? null,
    manufacturerSrn: r.manufacturerSrn ?? null,
    deviceStatusId: r.deviceStatusType?.code ?? null,
    authorisedRepresentative: r.authorisedRepresentativeName ?? null,
    // From the SRN prefix; the detail lookup later confirms it.
    authorisedRepresentativeCountry: countryName(srnCountry(r.authorisedRepresentativeSrn)),
    authorisedRepresentativeSrn: r.authorisedRepresentativeSrn ?? null,
    criterion: r.deviceCriterion ?? null,
    reference: r.reference ?? null,
    additionalDescription: null,
    marketDistribution: null,
    nbId: null,
    nbName: null,
  };
}

// Enrich a small batch of devices, keyed by uuid. Calls go through the shared
// limiter, so concurrency here only decides how soon each is queued.
export async function enrichItems(
  items: { uuid: string; basicUdi?: string | null }[],
): Promise<Record<string, Enrichment>> {
  const res = await pool(items, 4, (it) => enrich(it.uuid, it.basicUdi));
  const out: Record<string, Enrichment> = {};
  items.forEach((it, i) => (out[it.uuid] = res[i]));
  return out;
}

// Same cache keys as enrich(), so a device already shown in the table opens
// without another EUDAMED call.
export async function detail(uuid: string, basicUdi?: string | null) {
  const basicUrl = `${BASE}/devices/basicUdiData/udiDiData/${uuid}?languageIso2Code=en`;
  const udiUrl = `${BASE}/devices/udiDiData/${uuid}?languageIso2Code=en`;
  const [basic, udi] = await Promise.all([
    cached(basicUdi ? `basic:${basicUdi}` : basicUrl, 24 * HOUR, () =>
      getJson<any>(basicUrl, { high: true }),
    ).catch(() => null),
    cached(udiUrl, 24 * HOUR, () => getJson<any>(udiUrl, { high: true })).catch(
      () => null,
    ),
  ]);
  return { basic, udi };
}
