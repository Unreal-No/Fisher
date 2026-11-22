import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx } from './export';

describe('xlsx export', () => {
  it('builds a valid workbook with numeric cells, escaped Thai text and formula injection neutralised', () => {
    const files = unzipSync(buildXlsx([['รหัส', 'ชื่อ', 'ยอด'], ['A&B', '=HYPERLINK("x")', -1250.5], [null, 'เรือ <1>', 0]], 'รายงาน/ทดสอบ'));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    const doc = new DOMParser().parseFromString(sheet, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(sheet).toContain('<c r="C2"><v>-1250.5</v></c>'); // negative number stays numeric
    expect(sheet).toContain('<c r="C3"><v>0</v></c>');
    expect(sheet).toContain('A&amp;B');
    expect(sheet).toContain("'=HYPERLINK(&quot;x&quot;)");
    expect(sheet).toContain('เรือ &lt;1&gt;');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('name="รายงาน ทดสอบ"');
  });
});
