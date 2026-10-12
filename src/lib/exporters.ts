import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { riskLabel, statusLabel } from "./labels";

export interface ExportRow {
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
}

const d = (v: string | null) => (v && v.trim() ? v : "");

export const HEADERS = [
  "#",
  "Trade name",
  "Device name",
  "Device model",
  "Risk class",
  "Manufacturer",
  "Manufacturer SRN",
  "Device status",
  "Authorised rep",
  "AR country",
  "AR SRN",
  "Criterion",
  "Reference",
  "Additional product description",
];

export function toCells(r: ExportRow, i: number): string[] {
  return [
    String(i + 1),
    d(r.tradeName),
    d(r.deviceName),
    d(r.deviceModel),
    riskLabel(r.riskClassId),
    d(r.manufacturer),
    d(r.manufacturerSrn),
    statusLabel(r.deviceStatusId),
    d(r.authorisedRepresentative),
    d(r.authorisedRepresentativeCountry),
    d(r.authorisedRepresentativeSrn),
    d(r.criterion),
    d(r.reference),
    d(r.additionalDescription),
  ];
}

export function exportXlsx(rows: ExportRow[], code: string) {
  const aoa = [HEADERS, ...rows.map((r, i) => toCells(r, i))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 4 },
    { wch: 30 },
    { wch: 36 },
    { wch: 16 },
    { wch: 16 },
    { wch: 26 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 16 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Devices");
  XLSX.writeFile(wb, `EUDAMED_${code}_${rows.length}.xlsx`);
}

export function exportPdf(rows: ExportRow[], code: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(13);
  doc.text(`EUDAMED devices — EMDN ${code}`, 40, 34);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `${rows.length} devices · exported ${new Date().toLocaleDateString()} · source: EUDAMED public API`,
    40,
    48,
  );
  autoTable(doc, {
    startY: 58,
    head: [HEADERS],
    body: rows.map((r, i) => toCells(r, i)),
    styles: { fontSize: 6.5, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 6.5 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: { 0: { cellWidth: 18 } },
    margin: { left: 24, right: 24 },
  });
  doc.save(`EUDAMED_${code}_${rows.length}.pdf`);
}
