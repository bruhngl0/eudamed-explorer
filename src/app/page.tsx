"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { exportXlsx, exportPdf, HEADERS, toCells } from "@/lib/exporters";

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
  detail?: "pending" | "done" | "failed";
}

interface ApiResult {
  rows: Row[];
  totalElements: number;
  totalPages: number;
  page: number;
  pageSize: number;
}

interface ExportProgress {
  kind: "xlsx" | "pdf";
  phase: "list" | "details";
  done: number;
  total: number;
}

const STATUSES = [
  { value: "refdata.device-model-status.on-the-market", label: "On the market" },
  { value: "refdata.device-model-status.not-marketed", label: "No longer on market" },
  { value: "all", label: "All statuses" },
];

// Table columns (toCells order) that come from the detail lookups.
const DETAIL_COLS = new Set([2, 3, 9, 11, 13]);

// EUDAMED allows ~20 requests a minute, so details trickle in; asking for a
// few devices per request lets each batch show up as soon as it is ready.
const PAGE_BATCH = 3;
const EXPORT_BATCH = 5;

function applyDetail(r: Row, e: any): Row {
  return {
    ...r,
    deviceName: r.deviceName ?? e.deviceName,
    deviceModel: r.deviceModel ?? e.deviceModel,
    criterion: r.criterion ?? e.deviceCriterion,
    authorisedRepresentativeCountry: e.authorisedRepresentativeCountry,
    additionalDescription: e.additionalDescription,
    detail: e.failed ? "failed" : "done",
  };
}

// Look up details for `rows` in batches, reporting each batch as it lands.
// A batch whose request fails marks its rows failed instead of aborting.
async function fetchDetails(
  rows: Row[],
  batch: number,
  onBatch: (map: Record<string, any>) => void,
  cancelled: () => boolean,
) {
  for (let i = 0; i < rows.length && !cancelled(); i += batch) {
    const slice = rows.slice(i, i + batch);
    let map: Record<string, any>;
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
    if (!cancelled()) onBatch(map);
  }
}

export default function Home() {
  const [cnd, setCnd] = useState("W0105090601");
  const [status, setStatus] = useState(STATUSES[0].value);
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailUuid, setDetailUuid] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const exportCancel = useRef(false);
  // Bumped on every new search/page so stale detail lookups stop updating.
  const pageGen = useRef(0);

  const enrichRows = useCallback(async (targets: Row[]) => {
    const gen = pageGen.current;
    await fetchDetails(
      targets,
      PAGE_BATCH,
      (map) =>
        setData((prev) =>
          prev && {
            ...prev,
            rows: prev.rows.map((r) => (map[r.uuid] ? applyDetail(r, map[r.uuid]) : r)),
          },
        ),
      () => pageGen.current !== gen,
    );
  }, []);

  const load = useCallback(
    async (page: number) => {
      const gen = ++pageGen.current;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({
          cndCode: cnd.trim(),
          status,
          page: String(page),
          pageSize: "25",
        });
        const res = await fetch(`/api/search?${q}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (gen !== pageGen.current) return;
        const rows: Row[] = json.rows.map((r: Row) => ({ ...r, detail: "pending" }));
        setData({ ...json, rows });
        // Table shows straight away; details fill in batch by batch.
        enrichRows(rows);
      } catch (e) {
        if (gen !== pageGen.current) return;
        setError((e as Error).message);
        setData(null);
      } finally {
        if (gen === pageGen.current) setLoading(false);
      }
    },
    [cnd, status, enrichRows],
  );

  const retryFailed = useCallback(() => {
    if (!data) return;
    const failed = data.rows.filter((r) => r.detail === "failed");
    const ids = new Set(failed.map((r) => r.uuid));
    setData({
      ...data,
      rows: data.rows.map((r) => (ids.has(r.uuid) ? { ...r, detail: "pending" } : r)),
    });
    enrichRows(failed);
  }, [data, enrichRows]);

  // Export walks the whole result set from the browser: list pages of 100,
  // then details in small batches. Each request stays well under App Runner's
  // 120s limit; anything already looked up comes from the server cache.
  const runExport = useCallback(
    async (kind: "xlsx" | "pdf") => {
      if (!data) return;
      const code = cnd.trim() || "export";
      exportCancel.current = false;
      setError(null);
      setNotice(null);
      try {
        const all: Row[] = [];
        let total = data.totalElements;
        setExportProgress({ kind, phase: "list", done: 0, total });
        for (let page = 0; all.length < total && !exportCancel.current; page++) {
          const q = new URLSearchParams({
            cndCode: code,
            status,
            page: String(page),
            pageSize: "100",
          });
          const res = await fetch(`/api/search?${q}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          if (json.rows.length === 0) break;
          all.push(...json.rows);
          total = json.totalElements;
          setExportProgress({ kind, phase: "list", done: all.length, total });
        }
        let done = 0;
        let rows = all;
        setExportProgress({ kind, phase: "details", done, total: all.length });
        await fetchDetails(
          all,
          EXPORT_BATCH,
          (map) => {
            rows = rows.map((r) => (map[r.uuid] ? applyDetail(r, map[r.uuid]) : r));
            done += Object.keys(map).length;
            setExportProgress({ kind, phase: "details", done, total: all.length });
          },
          () => exportCancel.current,
        );
        if (exportCancel.current) return;
        if (kind === "xlsx") exportXlsx(rows, code);
        else exportPdf(rows, code);
        const failed = rows.filter((r) => r.detail === "failed").length;
        if (failed)
          setNotice(
            `Exported ${rows.length} devices; details could not be loaded for ${failed}, so some of their fields are blank.`,
          );
      } catch (e) {
        setError(`Export failed: ${(e as Error).message}`);
      } finally {
        setExportProgress(null);
      }
    },
    [cnd, status, data],
  );

  const rows = (data?.rows ?? []).filter((r) => {
    if (!filter.trim()) return true;
    const hay = [
      r.tradeName,
      r.deviceName,
      r.manufacturer,
      r.manufacturerSrn,
      r.authorisedRepresentative,
      r.reference,
      r.additionalDescription,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  const code = cnd.trim();
  const offset = data ? data.page * data.pageSize : 0;
  const pending = data?.rows.filter((r) => r.detail === "pending").length ?? 0;
  const failedCount = data?.rows.filter((r) => r.detail === "failed").length ?? 0;

  return (
    <div className="pdf-sheet">
      {/* Controls — kept compact so the sheet below reads like the PDF */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(0);
        }}
        className="pdf-controls"
      >
        <input
          value={cnd}
          onChange={(e) => setCnd(e.target.value)}
          placeholder="EMDN / CND code, e.g. W0105090601"
          aria-label="EMDN / CND code"
          className="w-56"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={loading || !code}>
          {loading ? "Searching…" : "Search"}
        </button>
        {data && (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter this page…"
              aria-label="Filter this page"
              className="w-44"
            />
            <button
              type="button"
              onClick={() => load(data.page - 1)}
              disabled={data.page <= 0 || loading}
            >
              ← Prev
            </button>
            <span className="pdf-muted">
              page {data.page + 1} / {data.totalPages}
            </span>
            <button
              type="button"
              onClick={() => load(data.page + 1)}
              disabled={data.page >= data.totalPages - 1 || loading}
            >
              Next →
            </button>
          </>
        )}
        <span className="flex-1" />
        {exportProgress ? (
          <>
            <span className="pdf-muted">
              Exporting {exportProgress.kind.toUpperCase()} ·{" "}
              {exportProgress.phase === "list" ? "device list" : "device details"}{" "}
              {exportProgress.done}/{exportProgress.total}
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
            <button type="button" onClick={() => runExport("xlsx")} disabled={!data}>
              Export XLSX
            </button>
            <button type="button" onClick={() => runExport("pdf")} disabled={!data}>
              Export PDF
            </button>
          </>
        )}
      </form>

      {/* Title block — mirrors exportPdf: 13pt title, 9pt grey subtitle */}
      <h1 className="pdf-title">EUDAMED devices — EMDN {code || "…"}</h1>
      <p className="pdf-subtitle">
        {data
          ? `${data.totalElements} devices · ${new Date().toLocaleDateString()} · source: EUDAMED public API`
          : "Enter an EMDN / CND code and press Search · source: EUDAMED public API"}
        {pending > 0 &&
          ` · loading device details ${data!.rows.length - pending}/${data!.rows.length} (EUDAMED allows ~20 lookups a minute)`}
        {failedCount > 0 && pending === 0 && (
          <>
            {` · details failed for ${failedCount} `}
            <button type="button" className="pdf-link" onClick={retryFailed}>
              retry
            </button>
          </>
        )}
      </p>

      {error && <p className="pdf-error">Error: {error}</p>}
      {notice && <p className="pdf-subtitle">{notice}</p>}
      {loading && !data && (
        <p className="pdf-subtitle">Fetching from EUDAMED… the first request can take a moment.</p>
      )}

      {data && (
        <table className="pdf-table">
          <thead>
            <tr>
              {HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = data.rows.indexOf(r);
              return (
                <tr
                  key={r.uuid}
                  onClick={() => setDetailUuid(r.uuid)}
                  title="Click for the full device record"
                >
                  {toCells(r, offset + n).map((c, j) => (
                    <td key={j}>
                      {j === 0 && r.detail === "failed" ? (
                        <span
                          className="pdf-failed"
                          title="Device details could not be loaded from EUDAMED"
                        >
                          {c} ⚠
                        </span>
                      ) : !c && r.detail === "pending" && DETAIL_COLS.has(j) ? (
                        <span className="pdf-muted">…</span>
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={HEADERS.length}>No rows match “{filter}” on this page.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {detailUuid && (
        <DetailDrawer uuid={detailUuid} onClose={() => setDetailUuid(null)} />
      )}
    </div>
  );
}





function DetailDrawer({ uuid, onClose }: { uuid: string; onClose: () => void }) {
  const [data, setData] = useState<{ basic: any; udi: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setErr(null);
    fetch(`/api/device/${uuid}`)
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch((e) => active && setErr(e.message));
    return () => {
      active = false;
    };
  }, [uuid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-slate-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Full device record
            </h2>
            <p className="font-mono text-[11px] text-slate-400">{uuid}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close ✕
          </button>
        </div>
        <div className="space-y-5 p-6">
          {err && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {err}
            </p>
          )}
          {!data && !err && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-slate-200" />
              ))}
            </div>
          )}
          {data && (
            <>
              <Section title="Basic UDI / device" obj={data.basic} />
              <Section title="UDI-DI (packaging level)" obj={data.udi} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, obj }: { title: string; obj: any }) {
  if (!obj) return null;
  const entries = Object.entries(obj).filter(
    ([, v]) =>
      v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 flex items-center justify-between text-sm font-bold text-slate-800">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          {entries.length} populated
        </span>
      </h3>
      <dl className="divide-y divide-slate-100">
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[170px_1fr] gap-3 py-1.5">
            <dt className="truncate font-mono text-xs text-slate-500" title={k}>
              {k}
            </dt>
            <dd className="break-words text-xs text-slate-800">
              {typeof v === "object" ? (
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] leading-snug text-slate-600">
                  {JSON.stringify(v, null, 1)}
                </pre>
              ) : (
                String(v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
