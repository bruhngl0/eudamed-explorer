// Human-readable labels for EUDAMED refdata codes, plus colour hints for badges.

// The device's public page on the EUDAMED website.
export const sourceUrl = (uuid: string) =>
  `https://ec.europa.eu/tools/eudamed/#/screen/search-device/${uuid}`;

export function riskLabel(code: string | null): string {
  if (!code) return "—";
  const k = code.split(".").pop() || code;
  const map: Record<string, string> = {
    "ivd-general": "IVD General",
    "ivd-devices-self-testing": "IVD self-testing",
    "ivd-annex-ii-list-a": "IVD Annex II List A",
    "ivd-annex-ii-list-b": "IVD Annex II List B",
    "class-a": "Class A",
    "class-b": "Class B",
    "class-c": "Class C",
    "class-d": "Class D",
    "class-i": "Class I",
    "class-iia": "Class IIa",
    "class-iib": "Class IIb",
    "class-iii": "Class III",
  };
  return map[k] || k;
}

export function statusLabel(code: string | null): string {
  if (!code) return "—";
  const k = code.split(".").pop() || code;
  const map: Record<string, string> = {
    "on-the-market": "On the market",
    "not-marketed": "No longer on the market",
    "not-intended": "Not intended for EU market",
    recalled: "Recalled",
  };
  return map[k] || k.replace(/-/g, " ");
}

// Tailwind classes for a risk-class badge.
export function riskColor(code: string | null): string {
  const k = (code || "").split(".").pop() || "";
  if (k === "class-d" || k === "class-iii")
    return "bg-red-100 text-red-700 ring-red-200";
  if (k === "class-c" || k === "class-iib")
    return "bg-orange-100 text-orange-700 ring-orange-200";
  if (k === "class-b" || k === "class-iia" || k.includes("self-testing"))
    return "bg-amber-100 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export function statusColor(code: string | null): string {
  const k = (code || "").split(".").pop() || "";
  if (k === "on-the-market") return "bg-emerald-100 text-emerald-700 ring-emerald-200";
  if (k === "recalled") return "bg-red-100 text-red-700 ring-red-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}
