// Minimal, dependency-free PDF writer for plain-text report exports.
// Produces one or more A4 pages of Helvetica text with the same content as the
// text export so the two download formats never diverge.

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_CHARS_PER_LINE = 92;

function escapePdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function wrapExportLine(line: string, maxLength = MAX_CHARS_PER_LINE): string[] {
  if (line.length <= maxLength) return [line];
  const wrapped: string[] = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength / 2)) cut = maxLength;
    wrapped.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) wrapped.push(remaining);
  return wrapped;
}

export function buildReportPdf(reportText: string): Buffer {
  const lines = reportText
    .split("\n")
    .flatMap((line) => wrapExportLine(line))
    .filter((line, index, all) => !(line === "" && index > 0 && all[index - 1] === "")) as string[];
  const pageLines = (lines.length > 0 ? lines : ["(empty report)"]);

  const linesPerPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
  const pageCount = Math.max(1, Math.ceil(pageLines.length / linesPerPage));

  // Object ids: 1 catalog, 2 pages, 3 font, then one content object per page
  // followed by one page object per page so page objects can be listed first.
  const firstPageObject = 4;
  const firstContentObject = firstPageObject + pageCount;
  const objectCount = firstContentObject + pageCount;

  const bodies: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${firstPageObject + index} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`,
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  ];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageText = pageLines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
    const textOperators = pageText.length === 0
      ? "( ) Tj"
      : pageText
        .map((line, index) => (index === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`))
        .join("\n");
    const contentStream = `BT\n/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n${textOperators}\nET`;
    bodies.push(
      `${firstPageObject + pageIndex} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstContentObject + pageIndex} 0 R >>\nendobj\n`,
      `${firstContentObject + pageIndex} 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const body of bodies) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += body;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
