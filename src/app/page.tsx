"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { exportXlsx, exportPdf, HEADERS, SOURCE_COL, toCells } from "@/lib/exporters";
import {
  Overview,
  FACET_LABELS,
  matchesFacets,
  type FacetKey,
  type Facets,
} from "@/components/Overview";
import { DeviceSheet } from "@/components/DeviceSheet";
import { loadDetails, loadList, saveDetails, saveList } from "@/lib/browserCache";

interface Row {
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
  detail?: "pending" | "done" | "failed";
}

// Result of a detail lookup for one device (see /api/enrich).
type Detail = Record<string, any> & { failed?: boolean };

interface ListState {
  rows: Row[];
  total: number;
  loading: boolean; // more pages still coming
}

interface ExportProgress {
  kind: "xlsx" | "pdf";
  done: number;
  total: number;
}

const STATUSES = [
  { value: "refdata.device-model-status.on-the-market", label: "On the market" },
  { value: "refdata.device-model-status.not-marketed", label: "No longer on market" },
  { value: "all", label: "All statuses" },
];
const DEFAULT_CODE = "W0105090601";

// Table columns (toCells order) that come from the detail lookups.
const DETAIL_COLS = new Set([2, 3, 11, 13, 14]);
const PAGE_SIZE = 25;
const LIST_PAGE = 100; // EUDAMED list page size; ~20-40s each
const LIST_CAP = 1000; // stop loading the list beyond this many devices
// EUDAMED allows ~20 requests a minute, so details trickle in; asking for a
// few devices per request lets each batch show up as soon as it is ready.
const PAGE_BATCH = 3;
const EXPORT_BATCH = 5;

function applyDetail(r: Row, e: Detail | undefined, pending: boolean): Row {
  if (!e) return pending ? { ...r, detail: "pending" } : r;
  return {
    ...r,
    deviceName: r.deviceName ?? e.deviceName ?? null,
    deviceModel: r.deviceModel ?? e.deviceModel ?? null,
    criterion: r.criterion ?? e.deviceCriterion ?? null,
    authorisedRepresentativeCountry:
      e.authorisedRepresentativeCountry ?? r.authorisedRepresentativeCountry,
    additionalDescription: e.additionalDescription ?? null,
    marketDistribution: e.marketDistribution ?? null,
    detail: e.failed ? "failed" : "done",
  };
}

// Look up details for `rows` in batches, reporting each batch as it lands.
// A batch whose request fails marks its rows failed instead of aborting.
async function fetchDetails(
  rows: Row[],
  batch: number,
  onBatch: (map: Record<string, Detail>) => void,
  cancelled: () => boolean,
) {
  for (let i = 0; i < rows.length && !cancelled(); i += batch) {
    const slice = rows.slice(i, i + batch);
    let map: Record<string, Detail>;
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: slice.map((r) => ({ uuid: r.uuid, basicUdi: r.basicUdi })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      map = (await res.json()).data ?? {};
    } catch {
      map = {};
    }
    for (const r of slice) map[r.uuid] ??= { failed: true };
    saveDetails(map);
    if (!cancelled()) onBatch(map);
  }
}

// Shareable links: code, status and chart filters live in the URL.
function readUrl() {
  const sp = new URLSearchParams(window.location.search);
  const facets: Facets = {};
  for (const k of Object.keys(FACET_LABELS) as FacetKey[]) {
    const v = sp.get(k);
    if (v) facets[k] = v;
  }
  return {
    code: sp.get("code")?.trim() || null,
    status: STATUSES.some((s) => s.value === sp.get("status")) ? sp.get("status")! : null,
    facets,
  };
}

function writeUrl(code: string, status: string, facets: Facets) {
  const sp = new URLSearchParams({ code });
  if (status !== STATUSES[0].value) sp.set("status", status);
  for (const [k, v] of Object.entries(facets)) if (v) sp.set(k, v);
  window.history.replaceState(null, "", `?${sp}`);
}

export default function Home() {
  const [cnd, setCnd] = useState(DEFAULT_CODE);
  const [status, setStatus] = useState(STATUSES[0].value);
  // The query whose results are on screen (inputs may have been edited since).
  const [query, setQuery] = useState<{ code: string; status: string } | null>(null);
  const [list, setList] = useState<ListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [facets, setFacets] = useState<Facets>({});
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [openUuid, setOpenUuid] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const exportCancel = useRef(false);
  const searchGen = useRef(0);

  // ---- Device list: every page, 100 at a time ------------------------------
  const runSearch = useCallback(async (code: string, st: string, keepFacets?: Facets) => {
    const gen = ++searchGen.current;
    setQuery({ code, status: st });
    setError(null);
    setNotice(null);
    setFacets(keepFacets ?? {});
    setFilter("");
    setSort(null);
    setPage(0);
    setList({ rows: [], total: 0, loading: true });
    writeUrl(code, st, keepFacets ?? {});
    const capNotice = (shownCount: number, total: number) => {
      if (total > shownCount)
        setNotice(`Showing the first ${shownCount.toLocaleString()} of ${total.toLocaleString()} devices.`);
    };
    // Seen in this browser within the hour: show it without asking EUDAMED.
    const hit = loadList<Row>(code, st);
    if (hit) {
      setList({ rows: hit.rows, total: hit.total, loading: false });
      capNotice(hit.rows.length, hit.total);
      return;
    }
    const rows: Row[] = [];
    try {
      for (let p = 0; ; p++) {
        const q = new URLSearchParams({
          cndCode: code,
          status: st,
          page: String(p),
          pageSize: String(LIST_PAGE),
        });
        const res = await fetch(`/api/search?${q}`);
        const json = await res.json();
        if (gen !== searchGen.current) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        rows.push(...json.rows);
        const done = json.rows.length === 0 || rows.length >= json.totalElements || rows.length >= LIST_CAP;
        setList({ rows: [...rows], total: json.totalElements, loading: !done });
        if (done) {
          capNotice(rows.length, json.totalElements);
          saveList(code, st, rows, json.totalElements);
          return;
        }
      }
    } catch (e) {
      if (gen !== searchGen.current) return;
      setError((e as Error).message);
      setList(rows.length ? { rows, total: rows.length, loading: false } : null);
    }
  }, []);

  // Open a shared link on first load, with details this browser already has.
  useEffect(() => {
    setDetails((d) => ({ ...loadDetails(), ...d }));
    const u = readUrl();
    if (u.code) {
      setCnd(u.code);
      if (u.status) setStatus(u.status);
      runSearch(u.code, u.status ?? STATUSES[0].value, u.facets);
    }
  }, [runSearch]);

  useEffect(() => {
    if (query) writeUrl(query.code, query.status, facets);
  }, [query, facets]);

  // ---- Filtering, sorting, paging (all in the browser) ---------------------
  const merged = useMemo(
    () =>
      (list?.rows ?? []).map((r) =>
        applyDetail(r, details[r.uuid], requested.has(r.uuid)),
      ),
    [list, details, requested],
  );
  // Row number = position in the EUDAMED list, so it stays put when sorting.
  const position = useMemo(() => new Map(merged.map((r, i) => [r.uuid, i])), [merged]);

  const facetRows = useMemo(() => merged.filter((r) => matchesFacets(r, facets)), [merged, facets]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let out = needle
      ? facetRows.filter((r) =>
          [
            r.tradeName,
            r.deviceName,
            r.deviceModel,
            r.manufacturer,
            r.manufacturerSrn,
            r.authorisedRepresentative,
            r.reference,
            r.additionalDescription,
            r.marketDistribution,
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : facetRows;
    if (sort && sort.col > 0) {
      const key = (r: Row) => toCells(r, 0)[sort.col];
      out = [...out].sort((a, b) => {
        const x = key(a),
          y = key(b);
        if (!x !== !y) return x ? -1 : 1; // blanks last either way
        return x.localeCompare(y, undefined, { numeric: true }) * sort.dir;
      });
    } else if (sort?.dir === -1) {
      out = [...out].reverse();
    }
    return out;
  }, [facetRows, filter, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageNow = Math.min(page, pages - 1);
  const visible = useMemo(
    () => shown.slice(pageNow * PAGE_SIZE, (pageNow + 1) * PAGE_SIZE),
    [shown, pageNow],
  );

  // ---- Details for the rows on screen --------------------------------------
  // One client-side worker; rows on the current page go to the front.
  const queue = useRef<Row[]>([]);
  const working = useRef(false);

  const pump = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    while (queue.current.length) {
      const batch = queue.current.splice(0, PAGE_BATCH);
      await fetchDetails(batch, PAGE_BATCH, (map) => setDetails((d) => ({ ...d, ...map })), () => false);
    }
    working.current = false;
  }, []);

  useEffect(() => {
    const fresh = (rows: Row[]) => rows.filter((r) => !details[r.uuid] && !requested.has(r.uuid));
    let need = fresh(visible);
    // Nothing waiting: look up the next page too, so paging forward is instant.
    if (need.length === 0 && queue.current.length === 0 && !working.current)
      need = fresh(shown.slice((pageNow + 1) * PAGE_SIZE, (pageNow + 2) * PAGE_SIZE));
    if (need.length === 0) return;
    setRequested((s) => new Set([...s, ...need.map((r) => r.uuid)]));
    const ids = new Set(need.map((r) => r.uuid));
    queue.current = [...need, ...queue.current.filter((r) => !ids.has(r.uuid))];
    pump();
  }, [visible, shown, pageNow, details, requested, pump]);

  const pendingOnPage = visible.filter((r) => r.detail === "pending").length;
  const failedOnPage = visible.filter((r) => r.detail === "failed");

  const retryFailed = () => {
    const ids = new Set(failedOnPage.map((r) => r.uuid));
    setDetails((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !ids.has(k))));
    setRequested((s) => new Set([...s].filter((k) => !ids.has(k))));
  };

  const toggleFacet = (key: FacetKey, value: string) => {
    setFacets((f) => {
      const next = { ...f };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(0);
  };

  const toggleSort = (col: number) =>
    setSort((s) =>
      !s || s.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null,
    );

  // ---- Export: the rows currently shown (all pages) ------------------------
  // Runs from the browser in small steps so no request nears App Runner's 120s
  // limit; details already looked up (here or by anyone) come from cache.
  const runExport = useCallback(
    async (kind: "xlsx" | "pdf") => {
      if (!query || shown.length === 0) return;
      exportCancel.current = false;
      setError(null);
      setNotice(null);
      const local: Record<string, Detail> = { ...details };
      const need = shown.filter((r) => !local[r.uuid] || local[r.uuid].failed);
      let done = shown.length - need.length;
      setExportProgress({ kind, done, total: shown.length });
      try {
        await fetchDetails(
          need,
          EXPORT_BATCH,
          (map) => {
            Object.assign(local, map);
            setDetails((d) => ({ ...d, ...map }));
            done += Object.keys(map).length;
            setExportProgress({ kind, done, total: shown.length });
          },
          () => exportCancel.current,
        );
        if (exportCancel.current) return;
        const rows = shown.map((r) => applyDetail(r, local[r.uuid], false));
        const name = query.code + (Object.keys(facets).length ? "_filtered" : "");
        if (kind === "xlsx") exportXlsx(rows, name);
        else exportPdf(rows, name);
        const failed = rows.filter((r) => r.detail === "failed").length;
        if (failed)
          setNotice(
            `Exported ${rows.length} devices; details could not be loaded for ${failed}, so some of their fields are blank.`,
          );
      } finally {
        setExportProgress(null);
      }
    },
    [query, shown, details, facets],
  );

  const loading = list?.loading ?? false;
  const openRow = openUuid ? merged.find((r) => r.uuid === openUuid) : undefined;
  const activeFacets = Object.entries(facets) as [FacetKey, string][];

  return (
    <div className="pdf-sheet">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cnd.trim()) runSearch(cnd.trim(), status);
        }}
        className="pdf-controls"
      >
        <span className="brand">EUDAMED Explorer</span>
        <input
          value={cnd}
          onChange={(e) => setCnd(e.target.value)}
          placeholder="EMDN / CND code, e.g. W0105090601"
          aria-label="EMDN / CND code"
          className="w-56"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={!cnd.trim()}>
          {loading && <Spinner light />}
          Search
        </button>
        <span className="flex-1" />
        {query && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              setNotice("Link copied — it opens this search with the same filters.");
            }}
          >
            Copy link
          </button>
        )}
        {exportProgress ? (
          <>
            <span className="pdf-muted">
              <Spinner />
              Exporting {exportProgress.kind.toUpperCase()} · device details {exportProgress.done}/
              {exportProgress.total}
            </span>
            <progress
              className="pdf-progress"
              value={exportProgress.done}
              max={Math.max(exportProgress.total, 1)}
            />
            <button type="button" onClick={() => (exportCancel.current = true)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => runExport("xlsx")} disabled={!shown.length || loading}>
              Export XLSX
            </button>
            <button type="button" onClick={() => runExport("pdf")} disabled={!shown.length || loading}>
              Export PDF
            </button>
          </>
        )}
      </form>

      <h1 className="pdf-title">EUDAMED devices — EMDN {query?.code ?? (cnd.trim() || "…")}</h1>
      <p className="pdf-subtitle">
        {list
          ? `${(list.total || list.rows.length).toLocaleString()} devices · ${new Date().toLocaleDateString()} · source: EUDAMED public API`
          : "Enter an EMDN / CND code and press Search · source: EUDAMED public API"}
        {loading && list!.rows.length > 0 && (
          <>
            {" · "}
            <Spinner />
            {`loading device list ${list!.rows.length}/${list!.total || "…"} (EUDAMED takes ~30s per 100)`}
          </>
        )}
      </p>

      {error && <p className="pdf-error">Error: {error}</p>}
      {notice && <p className="pdf-subtitle">{notice}</p>}
      {!list && !error && (
        <div className="empty">
          <p>Search EU medical-device registrations by EMDN code.</p>
          <button type="button" className="pdf-link" onClick={() => runSearch(DEFAULT_CODE, STATUSES[0].value)}>
            Try {DEFAULT_CODE} — COVID-19 / influenza rapid tests
          </button>
        </div>
      )}
      {list && list.rows.length === 0 && loading && (
        <>
          <p className="pdf-subtitle" role="status">
            <Spinner />
            Fetching the device list from EUDAMED… the first page takes about 30 seconds.
          </p>
          <ListSkeleton />
        </>
      )}

      {list && list.rows.length > 0 && (
        <>
          <Overview rows={facetRows} facets={facets} onToggle={toggleFacet} />

          <div className="table-bar">
            {activeFacets.map(([k, v]) => (
              <button key={k} type="button" className="chip-filter" onClick={() => toggleFacet(k, v)}>
                {FACET_LABELS[k]}: {v} ✕
              </button>
            ))}
            {activeFacets.length > 1 && (
              <button type="button" className="pdf-link" onClick={() => setFacets({})}>
                clear all
              </button>
            )}
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              placeholder="Search in results…"
              aria-label="Search in results"
              className="w-52"
            />
            <span className="pdf-muted">
              {shown.length.toLocaleString()} shown
              {pendingOnPage > 0 && (
                <>
                  {" · "}
                  <Spinner />
                  {`loading details ${visible.length - pendingOnPage}/${visible.length} (EUDAMED allows ~20 lookups a minute)`}
                </>
              )}
              {failedOnPage.length > 0 && pendingOnPage === 0 && (
                <>
                  {` · details failed for ${failedOnPage.length} `}
                  <button type="button" className="pdf-link" onClick={retryFailed}>
                    retry
                  </button>
                </>
              )}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => setPage(pageNow - 1)} disabled={pageNow <= 0}>
              ← Prev
            </button>
            <span className="pdf-muted">
              page {pageNow + 1} / {pages}
            </span>
            <button type="button" onClick={() => setPage(pageNow + 1)} disabled={pageNow >= pages - 1}>
              Next →
            </button>
          </div>

          <table className="pdf-table">
            <thead>
              <tr>
                {HEADERS.map((h, j) => (
                  <th key={h} onClick={() => toggleSort(j)} className="sortable" title="Click to sort">
                    {h}
                    {sort?.col === j ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.uuid} onClick={() => setOpenUuid(r.uuid)} title="Click for the device record">
                  {toCells(r, position.get(r.uuid) ?? 0).map((c, j) => (
                    <td key={j}>
                      {j === 0 && r.detail === "failed" ? (
                        <span className="pdf-failed" title="Device details could not be loaded from EUDAMED">
                          {c} ⚠
                        </span>
                      ) : j === SOURCE_COL ? (
                        <a
                          href={c}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pdf-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          EUDAMED ↗
                        </a>
                      ) : !c && r.detail === "pending" && DETAIL_COLS.has(j) ? (
                        <span className="skel" aria-label="Loading" />
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length}>No devices match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {openUuid && (
        <DeviceSheet uuid={openUuid} basicUdi={openRow?.basicUdi} onClose={() => setOpenUuid(null)} />
      )}
    </div>
  );
}

function Spinner({ light }: { light?: boolean }) {
  return <span className={`spinner${light ? " light" : ""}`} aria-hidden="true" />;
}

// Placeholder for the overview and table while the first list page loads.
function ListSkeleton() {
  return (
    <div aria-hidden="true">
      <section className="ov">
        <div className="ov-kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ov-kpi">
              <span className="skel skel-kpi" />
              <span className="skel skel-line" style={{ width: "55%" }} />
            </div>
          ))}
        </div>
        <div className="ov-charts">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ov-card">
              <span className="skel skel-line" style={{ width: "40%" }} />
              {[90, 70, 55, 40, 30].map((w) => (
                <span key={w} className="skel skel-line" style={{ width: `${w}%` }} />
              ))}
            </div>
          ))}
        </div>
      </section>
      <table className="pdf-table">
        <thead>
          <tr>
            {HEADERS.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }, (_, i) => (
            <tr key={i}>
              {HEADERS.map((h, j) => (
                <td key={h}>
                  <span className="skel" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
