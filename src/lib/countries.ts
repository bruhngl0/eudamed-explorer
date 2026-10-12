// Country helpers. EUDAMED SRNs start with the actor's country code
// ("CN-MF-000008447", "DE-AR-000000001"), so countries are known from the
// device list alone, without per-device detail calls.

// EUDAMED uses EU codes where ISO 3166 differs.
const EU_TO_ISO: Record<string, string> = { EL: "GR", UK: "GB" };

let names: Intl.DisplayNames | null = null;

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const iso = EU_TO_ISO[code] ?? code;
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(iso) ?? code;
  } catch {
    return code;
  }
}

export function srnCountry(srn: string | null | undefined): string | null {
  const m = /^([A-Z]{2})-/.exec(srn ?? "");
  return m ? m[1] : null;
}
