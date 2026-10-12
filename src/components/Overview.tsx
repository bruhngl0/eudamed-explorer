"use client";

import { riskLabel } from "@/lib/labels";
import { countryName, srnCountry } from "@/lib/countries";

// Fields the overview reads; all come from the device list itself.
export interface OverviewRow {
  riskClassId: string | null;
  manufacturer: string | null;
  manufacturerSrn: string | null;
  authorisedRepresentative: string | null;
}

export type FacetKey = "risk" | "mfr" | "country" | "ar";
export type Facets = Partial<Record<FacetKey, string>>;

export const FACET_LABELS: Record<FacetKey, string> = {
  risk: "Risk class",
  mfr: "Manufacturer",
  country: "Manufacturer country",
  ar: "Authorised rep",
};

const NO_AR = "None (EU manufacturer)";

// The value a row has for each facet; used for both charts and filtering.
export function facetValue(r: OverviewRow, key: FacetKey): string {
  switch (key) {
    case "risk":
      return riskLabel(r.riskClassId);
    case "mfr":
      return r.manufacturer?.trim() || "Unknown";
    case "country":
      return countryName(srnCountry(r.manufacturerSrn)) ?? "Unknown";
    case "ar":
      return r.authorisedRepresentative?.trim() || NO_AR;
  }
}

export function matchesFacets(r: OverviewRow, facets: Facets): boolean {
  return (Object.keys(facets) as FacetKey[]).every(
    (k) => facets[k] === undefined || facetValue(r, k) === facets[k],
  );
}

function countBy(rows: OverviewRow[], key: FacetKey) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = facetValue(r, key);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function Overview({
  rows,
  facets,
  onToggle,
}: {
  rows: OverviewRow[];
  facets: Facets;
  onToggle: (key: FacetKey, value: string) => void;
}) {
  const mfrs = countBy(rows, "mfr");
  const countries = countBy(rows, "country");
  const ars = countBy(rows, "ar").filter(([v]) => v !== NO_AR);
  const top = countries[0];

  return (
    <section className="ov" aria-label="Overview">
      <div className="ov-kpis">
        <Kpi label="Devices" value={rows.length} />
        <Kpi label="Manufacturers" value={mfrs.length} />
        <Kpi
          label="Manufacturer countries"
          value={countries.length}
          hint={
            top && rows.length
              ? `${Math.round((top[1] / rows.length) * 100)}% from ${top[0]}`
              : undefined
          }
        />
        <Kpi label="Authorised reps" value={ars.length} />
      </div>
      <div className="ov-charts">
        <Bars title="Risk class" facet="risk" data={countBy(rows, "risk")} total={rows.length} facets={facets} onToggle={onToggle} />
        <Bars title="Top manufacturers" facet="mfr" data={mfrs} total={rows.length} facets={facets} onToggle={onToggle} />
        <Bars title="Manufacturer country" facet="country" data={countries} total={rows.length} facets={facets} onToggle={onToggle} />
        <Bars title="Top authorised reps" facet="ar" data={countBy(rows, "ar")} total={rows.length} facets={facets} onToggle={onToggle} />
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="ov-kpi">
      <div className="ov-kpi-value">{value.toLocaleString()}</div>
      <div className="ov-kpi-label">{label}</div>
      {hint && <div className="ov-kpi-hint">{hint}</div>}
    </div>
  );
}

const MAX_BARS = 7;

function Bars({
  title,
  facet,
  data,
  total,
  facets,
  onToggle,
}: {
  title: string;
  facet: FacetKey;
  data: [string, number][];
  total: number;
  facets: Facets;
  onToggle: (key: FacetKey, value: string) => void;
}) {
  const shown = data.slice(0, MAX_BARS);
  const rest = data.length - shown.length;
  const max = shown[0]?.[1] ?? 1;
  const active = facets[facet];
  return (
    <div className="ov-card">
      <h3>{title}</h3>
      <ul>
        {shown.map(([label, n]) => (
          <li key={label}>
            <button
              type="button"
              className={`ov-bar ${active === label ? "on" : ""} ${active && active !== label ? "dim" : ""}`}
              onClick={() => onToggle(facet, label)}
              title={`${label}: ${n} devices (${Math.round((n / Math.max(total, 1)) * 100)}%) — click to ${active === label ? "clear" : "filter"}`}
            >
              <span className="ov-bar-label">{label}</span>
              <span className="ov-bar-track">
                <span className="ov-bar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="ov-bar-n">{n}</span>
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="ov-more">+{rest} more</p>}
    </div>
  );
}
