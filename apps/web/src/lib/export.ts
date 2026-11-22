import { strToU8, zipSync } from 'fflate';

/** copy into this realm's Uint8Array (fflate checks instanceof; TextEncoder may come from another realm) */
const u8 = (s: string) => new Uint8Array(strToU8(s));

export type Cell = string | number | null | undefined;

function save(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** text that a spreadsheet would treat as a formula is prefixed with ' (numbers are left alone) */
const neutralise = (v: Cell) => {
  const s = v === null || v === undefined ? '' : String(v);
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** CSV with UTF-8 BOM so Excel opens Thai text correctly. */
/** Decimal string -> number so Excel keeps cells numeric (non-numeric values pass through). */
export const num = (v: string | number | null | undefined): Cell => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v);

export function downloadCsv(filename: string, rows: Cell[][]) {
  const esc = (v: Cell) => {
    const safe = neutralise(v);
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

const xml = (s: string) =>
  s
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const colName = (i: number) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** Minimal .xlsx bytes (one sheet, bold frozen header row, numbers stay numeric). */
export function buildXlsx(rows: Cell[][], sheetName = 'Sheet1') {
  const widths: number[] = [];
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          const style = ri === 0 ? ' s="1"' : '';
          widths[ci] = Math.max(widths[ci] ?? 8, Math.min(60, String(v ?? '').length + 2));
          if (v === null || v === undefined || v === '') return '';
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(neutralise(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  const safeName = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    'xl/worksheets/sheet1.xml': u8(sheet),
  };
  return zipSync(files, { level: 6 });
}

export function downloadXlsx(filename: string, rows: Cell[][], sheetName = 'Sheet1') {
  save(new Blob([buildXlsx(rows, sheetName) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

/** Same rows, either format: `export rows as filename.(csv|xlsx)`. */
export function downloadTable(format: 'csv' | 'xlsx', baseName: string, rows: Cell[][], sheetName?: string) {
  if (format === 'xlsx') downloadXlsx(`${baseName}.xlsx`, rows, sheetName);
  else downloadCsv(`${baseName}.csv`, rows);
}
