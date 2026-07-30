// Deterministic PDF statement parsing — turns a text-layer PDF into the same
// `string[][]` grid the CSV/Excel path produces, so bank statements exported as
// PDF go through the column mapper instead of the AI extractor.
//
// Why not AI: a statement PDF holds hundreds of rows. One model call cannot
// emit them all (output-token limits truncate the JSON), and the numbers must
// be exact. The text layer is already a table — we just have to rebuild the
// columns from the glyph coordinates.
//
// Scanned/photographed PDFs have no text layer; those still take the AI path.

/** One run of text with its horizontal extent, in PDF user-space points. */
export interface TextFragment {
    text: string;
    /** Left edge. */
    x0: number;
    /** Right edge. */
    x1: number;
    /** Baseline; larger is higher up the page. */
    y: number;
}

export interface PdfPageText {
    fragments: TextFragment[];
    /** Page width in points — bounds the last column. */
    width: number;
}

/** Rows closer than this on the y axis belong to the same line. */
const ROW_TOLERANCE = 2.5;

/** Header keywords, mirroring the CSV importer's detector. */
const HEADER_KEYWORDS = [
    /date/, /amount/, /debit/, /credit/, /balance/, /narrat/, /descrip/,
    /payee/, /beneficiary/, /reference/, /\bref\b/, /\brrn\b/, /transaction/,
    /\btype\b/, /details/, /memo/, /withdraw/, /deposit/, /particulars/,
];

/** Repeated page furniture that is never part of the table. */
const PAGE_FURNITURE = [
    /^page\s+\d+\s+of\s+\d+$/i,
    /^page\s+\d+$/i,
    /^\d+\s*\/\s*\d+$/,
];

// ─────────────────────────────────────────────────────────────────────────────
// Fragments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a text item on internal whitespace runs.
 *
 * pdf.js merges neighbouring glyph runs into one item, so a right-aligned
 * amount and the value date beside it can arrive as a single
 * "20,000.00 10/02/2026" string spanning two columns. Splitting on whitespace
 * and interpolating each piece's x by character offset puts them back in their
 * own columns. Proportional fonts make this an estimate, but columns are far
 * enough apart that it lands in the right band.
 */
export function splitItem(text: string, x: number, width: number): TextFragment[] {
    if (!text.trim()) return [];
    const perChar = width / text.length;

    // Tokenise, then re-join tokens into fields. A field break happens on a run
    // of two-or-more spaces (clear column gutter), or between two adjacent
    // numeric-looking tokens — that is the amount/value-date pair. A lone space
    // between words never breaks, so descriptions stay whole.
    const numeric = /^[\d][\d.,()\-/]*$/;
    const tokens: Array<{ text: string; start: number; end: number }> = [];
    const tokenRe = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(text))) {
        tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }

    const fields: Array<{ start: number; end: number }> = [];
    for (const tok of tokens) {
        const open = fields[fields.length - 1];
        if (!open) {
            fields.push({ start: tok.start, end: tok.end });
            continue;
        }
        const gap = tok.start - open.end;
        const prevToken = text.slice(open.start, open.end).split(/\s+/).pop() ?? "";
        const breakHere = gap >= 2 || (numeric.test(tok.text) && numeric.test(prevToken));
        if (breakHere) fields.push({ start: tok.start, end: tok.end });
        else open.end = tok.end;
    }

    return fields.map((f) => ({
        text: text.slice(f.start, f.end),
        x0: x + f.start * perChar,
        x1: x + f.end * perChar,
        y: 0,
    }));
}

/** Group a page's fragments into visual lines, each sorted left to right. */
export function groupRows(fragments: TextFragment[]): TextFragment[][] {
    const sorted = [...fragments].sort((a, b) => b.y - a.y);
    const rows: TextFragment[][] = [];
    let current: TextFragment[] = [];
    let rowY = Number.NaN;

    for (const f of sorted) {
        if (current.length === 0 || Math.abs(f.y - rowY) <= ROW_TOLERANCE) {
            if (current.length === 0) rowY = f.y;
            current.push(f);
        } else {
            rows.push(current.sort((a, b) => a.x0 - b.x0));
            current = [f];
            rowY = f.y;
        }
    }
    if (current.length) rows.push(current.sort((a, b) => a.x0 - b.x0));
    return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

/** Score a line on how much it looks like a table header. */
function headerScore(row: TextFragment[]): number {
    let score = 0;
    for (const f of row) {
        const t = f.text.toLowerCase();
        if (t.trim() && HEADER_KEYWORDS.some((k) => k.test(t))) score++;
    }
    return score;
}

/** Index of the header line within a page's rows, or -1. */
export function findHeaderRow(rows: TextFragment[][]): number {
    let best = -1;
    let bestScore = 2; // require at least 3 keyword hits
    rows.forEach((row, i) => {
        const score = headerScore(row);
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}

/**
 * Column boundaries from the header line: each column runs from its own header
 * label to the start of the next one. Right-aligned numbers sit well to the
 * right of their left-aligned header, so a boundary-to-boundary band captures
 * them where a nearest-centre match would not.
 */
export function columnBounds(header: TextFragment[], pageWidth: number): number[] {
    const starts = header.map((f) => f.x0).sort((a, b) => a - b);
    const bounds = [Number.NEGATIVE_INFINITY];
    for (let i = 1; i < starts.length; i++) bounds.push(starts[i]);
    bounds.push(Math.max(pageWidth, starts[starts.length - 1] + 1));
    return bounds;
}

/** Which column a fragment belongs to: most horizontal overlap, else nearest. */
function columnFor(f: TextFragment, bounds: number[]): number {
    const n = bounds.length - 1;
    let best = 0;
    let bestOverlap = -Infinity;
    for (let c = 0; c < n; c++) {
        const lo = bounds[c];
        const hi = bounds[c + 1];
        const overlap = Math.min(f.x1, hi) - Math.max(f.x0, lo);
        const score = overlap > 0
            ? overlap
            : -Math.min(Math.abs(f.x0 - hi), Math.abs(lo - f.x1));
        if (score > bestOverlap) {
            bestOverlap = score;
            best = c;
        }
    }
    return best;
}

/** Lay one line out across the columns, joining fragments that share a cell. */
export function rowToCells(
    row: TextFragment[],
    bounds: number[],
): string[] {
    const cells: string[] = new Array(bounds.length - 1).fill("");
    for (const f of row) {
        const c = columnFor(f, bounds);
        cells[c] = cells[c] ? `${cells[c]} ${f.text}` : f.text;
    }
    return cells;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid assembly
// ─────────────────────────────────────────────────────────────────────────────

function isFurniture(cells: string[]): boolean {
    const joined = cells.filter(Boolean).join(" ").trim();
    return PAGE_FURNITURE.some((p) => p.test(joined));
}

function signature(cells: string[]): string {
    return cells.map((c) => c.trim().toLowerCase()).join("|");
}

/**
 * Build the import grid from every page's text.
 *
 * - The header line on page 1 fixes the columns for the whole document.
 * - Later pages repeat that header; everything above it (bank address block,
 *   running titles) is dropped so only page 1 keeps its preamble — the CSV
 *   importer reads account name / number / currency out of that preamble.
 * - Wrapped descriptions arrive as their own lines; they are folded back into
 *   the row above.
 */
export function pagesToGrid(pages: PdfPageText[]): string[][] {
    if (!pages.length) return [];

    const perPageRows = pages.map((p) => groupRows(p.fragments));

    // Columns come from the first page that has a recognisable header.
    let bounds: number[] | null = null;
    let headerSig = "";
    for (let i = 0; i < perPageRows.length && !bounds; i++) {
        const idx = findHeaderRow(perPageRows[i]);
        if (idx >= 0) {
            bounds = columnBounds(perPageRows[i][idx], pages[i].width);
            headerSig = signature(rowToCells(perPageRows[i][idx], bounds));
        }
    }
    // No header anywhere: fall back to the widest line's layout so the user can
    // still map columns by hand.
    if (!bounds) {
        const widest = perPageRows
            .flat()
            .reduce((a, b) => (b.length > a.length ? b : a), [] as TextFragment[]);
        if (widest.length < 2) return [];
        bounds = columnBounds(widest, pages[0].width);
    }

    const columnCount = bounds.length - 1;
    // Wrapped text always continues in the widest column (the description).
    let descCol = 0;
    let descWidth = -1;
    for (let c = 0; c < columnCount; c++) {
        const lo = c === 0 ? bounds[1] - 60 : bounds[c];
        const w = bounds[c + 1] - lo;
        if (Number.isFinite(w) && w > descWidth) {
            descWidth = w;
            descCol = c;
        }
    }

    const grid: string[][] = [];
    let headerSeen = false;
    let headerIndex = -1;

    for (let p = 0; p < perPageRows.length; p++) {
        const rows = perPageRows[p].map((r) => rowToCells(r, bounds));

        // On continuation pages, skip the repeated header and its preamble.
        let start = 0;
        if (headerSeen && headerSig) {
            const repeat = rows.findIndex((r) => signature(r) === headerSig);
            if (repeat >= 0) start = repeat + 1;
        }

        for (let i = start; i < rows.length; i++) {
            const cells = rows[i];
            if (!cells.some((c) => c.trim())) continue;
            if (isFurniture(cells)) continue;

            if (signature(cells) === headerSig) {
                if (headerSeen) continue;
                headerSeen = true;
                headerIndex = grid.length;
                grid.push(cells);
                continue;
            }

            // Wrapped description: exactly one filled cell, in the description
            // column, directly under a data row that already has one there.
            // Never fold into the header — the row below it is data, not a wrap.
            const filled = cells.filter((c) => c.trim()).length;
            const prev = grid[grid.length - 1];
            if (
                filled === 1 &&
                cells[descCol]?.trim() &&
                prev &&
                grid.length - 1 !== headerIndex &&
                prev[0]?.trim() &&
                prev[descCol]?.trim()
            ) {
                prev[descCol] = `${prev[descCol]} ${cells[descCol].trim()}`;
                continue;
            }

            grid.push(cells);
        }
    }

    return grid.map((r) => r.map((c) => c.trim()));
}

// ─────────────────────────────────────────────────────────────────────────────
// pdf.js entry point
// ─────────────────────────────────────────────────────────────────────────────

/** Lazily loaded — pdf.js is ~350 KB and only the import path needs it. */
async function loadPdfjs() {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
}

/** Read a PDF's text layer into per-page positioned fragments. */
export async function extractPdfText(data: ArrayBuffer): Promise<PdfPageText[]> {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    const pages: PdfPageText[] = [];
    try {
        for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            const width = page.view[2] - page.view[0];
            const fragments: TextFragment[] = [];
            for (const item of content.items) {
                if (!("str" in item)) continue;
                const x = item.transform[4] as number;
                const y = item.transform[5] as number;
                for (const f of splitItem(item.str, x, item.width)) {
                    fragments.push({ ...f, y });
                }
            }
            pages.push({ fragments, width });
            page.cleanup();
        }
    } finally {
        await doc.destroy();
    }
    return pages;
}

/**
 * A PDF statement as an import grid. Returns an empty array when the PDF has
 * no usable text layer (scanned image) — the caller then falls back to AI.
 */
export async function parsePdfTable(data: ArrayBuffer): Promise<string[][]> {
    return pagesToGrid(await extractPdfText(data));
}

/**
 * Grid for a dropped PDF, parsed once per File. Classification (does this go
 * to the mapper or to AI?) and the mapper itself both need it, and parsing an
 * eight-page statement twice is pure latency.
 */
const gridCache = new WeakMap<File, Promise<string[][]>>();

export function pdfGridFor(file: File): Promise<string[][]> {
    const hit = gridCache.get(file);
    if (hit) return hit;
    const promise = file
        .arrayBuffer()
        .then(parsePdfTable)
        .catch(() => [] as string[][]);
    gridCache.set(file, promise);
    return promise;
}

/** Does this PDF carry enough of a text layer to parse as a table? */
export function looksLikeTable(grid: string[][]): boolean {
    if (grid.length < 3) return false;
    const cols = Math.max(...grid.map((r) => r.length));
    return cols >= 3 && findGridHeader(grid) >= 0;
}

function findGridHeader(grid: string[][]): number {
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
        let score = 0;
        for (const cell of grid[i]) {
            const t = cell.toLowerCase();
            if (t.trim() && HEADER_KEYWORDS.some((k) => k.test(t))) score++;
        }
        if (score >= 3) return i;
    }
    return -1;
}
