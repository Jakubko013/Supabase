// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { imagePdf } from './pdf';

describe('imagePdf', () => {
  it('vytvoří vícestránkové PDF se správnou tabulkou odkazů a diakritikou v názvu', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x0a, 0xff, 0xd9]);
    const page = { jpeg, width: 300, height: 200 };
    const blob = imagePdf([page, page], 'Statistika Kolín – Brno');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = new TextDecoder('latin1').decode(bytes);

    expect(blob.type).toBe('application/pdf');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(9); // katalog, strany, 2 × (strana, obrázek, obsah), informace
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));

    expect(pdf).toContain('/Kids [3 0 R 6 0 R] /Count 2');
    expect(pdf).toContain(`/Width 300 /Height 200`);
    expect(pdf).toContain(`/Length ${jpeg.length} >>\nstream\n`);
    expect(pdf).toContain('/Title <FEFF0053'); // UTF-16BE: „S“
    expect(pdf).toContain('006c00ed006e'); // „lín“ s diakritikou
  });
});
