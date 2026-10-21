// Browser-side cache (localStorage) so a repeat search or a reload shows at
// once instead of waiting on EUDAMED again. Lifetimes match the server cache.
// Storage can be missing or full; every call then quietly does nothing.

const LIST_TTL = 3_600_000; // 1h
const DETAIL_TTL = 24 * 3_600_000;
const LIST_PREFIX = "eud:list:";
const DETAILS_KEY = "eud:details:v2"; // bump when detail fields change

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Most likely full: drop our own entries rather than keep failing.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("eud:"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}

export function loadList<R>(code: string, status: string): { rows: R[]; total: number } | null {
  const hit = read<{ at: number; rows: R[]; total: number }>(`${LIST_PREFIX}${code}|${status}`);
  return hit && Date.now() - hit.at < LIST_TTL ? { rows: hit.rows, total: hit.total } : null;
}

export function saveList(code: string, status: string, rows: unknown[], total: number) {
  // Never remember "no results"; an empty answer may be a one-off EUDAMED hiccup.
  if (!rows.length) return;
  write(`${LIST_PREFIX}${code}|${status}`, { at: Date.now(), rows, total });
}

type Stored = Record<string, { at: number; v: Record<string, any> }>;

export function loadDetails(): Record<string, Record<string, any>> {
  const all = read<Stored>(DETAILS_KEY) ?? {};
  const out: Record<string, Record<string, any>> = {};
  for (const [uuid, e] of Object.entries(all))
    if (Date.now() - e.at < DETAIL_TTL) out[uuid] = e.v;
  return out;
}

// Failed lookups are not kept, so they are tried again next time.
export function saveDetails(map: Record<string, Record<string, any>>) {
  const fresh = Object.entries(map).filter(([, v]) => !v.failed);
  if (fresh.length === 0) return;
  const now = Date.now();
  const all = read<Stored>(DETAILS_KEY) ?? {};
  for (const k of Object.keys(all)) if (now - all[k].at >= DETAIL_TTL) delete all[k];
  for (const [uuid, v] of fresh) all[uuid] = { at: now, v };
  write(DETAILS_KEY, all);
}
