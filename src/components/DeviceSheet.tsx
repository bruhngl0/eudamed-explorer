"use client";

import { isValidElement, useEffect, useState } from "react";
import { riskLabel, sourceUrl, statusLabel } from "@/lib/labels";
import { countryName } from "@/lib/countries";

// Multilingual EUDAMED text block -> English text, else the first one given.
function text(block: any): string | null {
  const texts: any[] = block?.texts ?? [];
  const en = texts.find((t) => t?.language?.isoCode === "en");
  return (en ?? texts[0])?.text ?? block?.textByDefaultLanguage ?? null;
}

const LEGISLATION: Record<string, string> = {
  ivdd: "IVDD (Directive 98/79/EC, legacy)",
  ivdr: "IVDR (Regulation (EU) 2017/746)",
  mdd: "MDD (Directive 93/42/EEC, legacy)",
  aimdd: "AIMDD (Directive 90/385/EEC, legacy)",
  mdr: "MDR (Regulation (EU) 2017/745)",
};

const lastPart = (code?: string | null) => (code ? code.split(".").pop()! : null);

const date = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;

// Yes/no characteristics worth showing when true.
const FLAGS: [string, string][] = [
  ["reagent", "Reagent"],
  ["kit", "Kit"],
  ["instrument", "Instrument"],
  ["selfTesting", "Self-testing"],
  ["nearPatientTesting", "Near-patient testing"],
  ["professionalTesting", "Professional testing"],
  ["companionDiagnostics", "Companion diagnostic"],
  ["singleUse", "Single use"],
  ["sterile", "Sterile"],
  ["animalTissues", "Contains animal tissues"],
  ["humanTissues", "Contains human tissues"],
  ["microbialSubstances", "Contains microbial substances"],
];

export function DeviceSheet({
  uuid,
  basicUdi,
  onClose,
}: {
  uuid: string;
  basicUdi?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ basic: any; udi: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setErr(null);
    // The Basic UDI lets the server reuse the record it fetched for the table.
    fetch(`/api/device/${uuid}${basicUdi ? `?basicUdi=${encodeURIComponent(basicUdi)}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        if (j.error) setErr(j.error);
        else if (!j.basic && !j.udi) setErr("EUDAMED did not return this device. Try again in a minute.");
        else setData(j);
      })
      .catch(() => active && setErr("Could not reach the server."));
    return () => {
      active = false;
    };
  }, [uuid, basicUdi]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const b = data?.basic ?? {};
  const u = data?.udi ?? {};
  const name = b.deviceName || text(u.tradeName) || "Unnamed device";
  const mf = b.manufacturer ?? {};
  const ar = b.authorisedRepresentative ?? {};
  const emdn = (u.cndNomenclatures ?? []) as any[];
  const markets = ((u.marketInfoLink?.msWhereAvailable ?? []) as any[])
    .map((m) => m?.country?.name)
    .filter(Boolean);
  const flags = FLAGS.filter(([k]) => b[k] === true || u[k] === true).map(([, l]) => l);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()} aria-label="Device record">
        <header className="sheet-head">
          <div>
            <p className="sheet-kicker">Device record</p>
            <h2>{data ? name : "Loading…"}</h2>
            {data && (
              <div className="sheet-badges">
                <span className="badge">{riskLabel(b.riskClass?.code ?? null)}</span>
                <span className="badge ok">{statusLabel(u.deviceStatus?.type?.code ?? null)}</span>
                {b.deviceCriterion && <span className="badge">{b.deviceCriterion}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="sheet-close">
            Close ✕
          </button>
        </header>

        <div className="sheet-body">
          {err && <p className="pdf-error">{err}</p>}
          {!data && !err && (
            <div role="status">
              <p className="pdf-muted">
                <span className="spinner" aria-hidden="true" />
                Fetching from EUDAMED…
              </p>
              {[5, 4, 5].map((n, i) => (
                <section key={i} className="sheet-block" aria-hidden="true">
                  <span className="skel skel-line" style={{ width: "30%" }} />
                  {Array.from({ length: n }, (_, j) => (
                    <span key={j} className="skel skel-line" style={{ width: `${85 - ((i + j * 3) % 5) * 9}%` }} />
                  ))}
                </section>
              ))}
            </div>
          )}
          {data && (
            <>
              {text(u.additionalDescription) && (
                <Block title="Description">
                  <p className="sheet-desc">{text(u.additionalDescription)}</p>
                </Block>
              )}

              <Block title="Identification">
                <Fields
                  items={[
                    ["Trade name", text(u.tradeName)],
                    ["Reference / catalogue no.", u.reference],
                    ["Device model", b.deviceModel],
                    ["Basic UDI-DI", b.basicUdi?.code],
                    ["Primary UDI-DI", u.primaryDi?.code && `${u.primaryDi.code} (${lastPart(u.primaryDi.issuingAgency?.code)?.toUpperCase()})`],
                    ["EMDN", emdn.map((c) => `${c.code} — ${text(c.description)}`).join("; ")],
                    ["Legislation", LEGISLATION[lastPart(b.legislation?.code) ?? ""] ?? lastPart(b.legislation?.code)],
                    ["Quantity per pack", u.baseQuantity],
                  ]}
                />
              </Block>

              {flags.length > 0 && (
                <Block title="Characteristics">
                  <div className="sheet-chips">
                    {flags.map((f) => (
                      <span key={f} className="chip">{f}</span>
                    ))}
                  </div>
                </Block>
              )}

              <Block title="Market">
                <Fields
                  items={[
                    ["Status", statusLabel(u.deviceStatus?.type?.code ?? null)],
                    ["Status since", date(u.deviceStatus?.statusDate)],
                    ["First placed on the market in", u.placedOnTheMarket?.name],
                    ["Market distribution", markets.join(", ")],
                    ["Last updated in EUDAMED", date(u.lastUpdated ?? b.lastUpdated)],
                    [
                      "Source",
                      <a key="src" href={sourceUrl(uuid)} target="_blank" rel="noopener noreferrer" className="pdf-link">
                        Open on EUDAMED ↗
                      </a>,
                    ],
                  ]}
                />
              </Block>

              <Block title="Manufacturer">
                <Fields
                  items={[
                    ["Name", mf.name],
                    ["SRN", mf.srn],
                    ["Country", mf.countryName ?? countryName(mf.countryIso2Code)],
                    ["Address", mf.geographicalAddress],
                    ["Email", mf.electronicMail],
                  ]}
                />
              </Block>

              {ar.name && (
                <Block title="Authorised representative (EU)">
                  <Fields
                    items={[
                      ["Name", ar.name],
                      ["SRN", ar.srn],
                      ["Country", ar.countryName],
                      ["Address", ar.address],
                      ["Email", ar.email],
                      ["Telephone", ar.telephone],
                    ]}
                  />
                </Block>
              )}

              <details className="sheet-raw">
                <summary>Full EUDAMED record (all fields)</summary>
                <Raw title="Basic UDI / device" obj={data.basic} />
                <Raw title="UDI-DI (packaging level)" obj={data.udi} />
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sheet-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Fields({ items }: { items: [string, unknown][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return <p className="pdf-muted">Not provided.</p>;
  return (
    <dl className="sheet-fields">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{isValidElement(v) ? v : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Raw({ title, obj }: { title: string; obj: any }) {
  if (!obj) return null;
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
  );
  return (
    <div className="sheet-rawblock">
      <h4>
        {title} · {entries.length} populated fields
      </h4>
      <dl>
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt title={k}>{k}</dt>
            <dd>
              {typeof v === "object" ? <pre>{JSON.stringify(v, null, 1)}</pre> : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
