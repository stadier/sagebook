// Deterministic statement parsing (CSV via papaparse, minimal OFX/QFX).
// Pure functions — no network. The Import page normalizes rows here, then
// sends them to the ingest-import edge function (rules + dedup still apply).

import Papa from "papaparse";

export interface ImportTx {
    occurred_at: string;
    amount: number;
    currency: string;
    kind: "income" | "expense";
    payee?: string;
    memo?: string;
    /** Bank reference / session id — a strong dedup key when present. */
    reference?: string;
}

export interface NormalizeResult {
    txs: ImportTx[];
    errors: string[];
}

export type DateFormat = "auto" | "ymd" | "dmy" | "mdy";

export interface CsvMapping {
    hasHeader: boolean;
    /** 0-based index of the header row (statements often have a title preamble). */
    headerRow: number;
    dateCol: number;
    dateFormat: DateFormat;
    amountMode: "signed" | "debit_credit";
    amountCol: number;
    debitCol: number;
    creditCol: number;
    /** Which sign means money out, for the signed-amount mode. */
    signConvention: "negative_expense" | "positive_expense";
    payeeCol: number; // -1 = none
    memoCol: number; // -1 = none
    referenceCol: number; // -1 = none
}

/** Account details lifted from a statement's header/summary block. */
export interface StatementMeta {
    accountName?: string;
    accountNumber?: string;
    currency?: string;
    openingBalance?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
    const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: "greedy" });
    return (res.data ?? []).filter(
        (r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ""),
    );
}

/** First worksheet of an Excel file as rows of display-formatted strings.
 * SheetJS is ~340 KB, so it loads on demand rather than in the main bundle. */
export async function parseWorkbook(buffer: ArrayBuffer): Promise<string[][]> {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false, // formatted strings, so dates arrive as displayed
        defval: "",
    });
    return rows
        .map((r) => r.map((c) => String(c ?? "")))
        .filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseDateStr(raw: string, fmt: DateFormat): string | null {
    const s = raw.trim();
    if (!s) return null;
    // Drop any time-of-day component first ("13/07/2025 0:07:27" → "13/07/2025").
    // Leaving it in defeated the day-first split and made JS Date.parse either
    // reject (day > 12) or silently swap day/month (both ≤ 12).
    const datePart = s.split(/[ T]+/)[0];
    const parts = datePart.split(/[/\-.]/).map((p) => p.trim());
    let y: number, m: number, d: number;

    if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
        const [a, b, c] = parts.map(Number);
        let mode = fmt;
        if (mode === "auto") {
            if (parts[0].length === 4) mode = "ymd";
            else if (a > 12) mode = "dmy";
            else if (b > 12) mode = "mdy";
            else mode = "dmy"; // ambiguous — most non-US banks are day-first
        }
        if (mode === "ymd") [y, m, d] = [a, b, c];
        else if (mode === "mdy") [m, d, y] = [a, b, c];
        else [d, m, y] = [a, b, c];
        if (y < 100) y += 2000;
    } else {
        // Textual date fallback: "12 Jan 2026".
        const t = Date.parse(datePart);
        if (Number.isNaN(t)) return null;
        const dt = new Date(t);
        y = dt.getUTCFullYear();
        m = dt.getUTCMonth() + 1;
        d = dt.getUTCDate();
    }

    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    // Noon UTC so local-timezone rendering never shifts the calendar day.
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${y}-${p2(m)}-${p2(d)}T12:00:00Z`;
}

const HEADER_KEYWORDS = [
    /date/, /amount/, /debit/, /credit/, /balance/, /narrat/, /descrip/,
    /payee/, /beneficiary/, /reference/, /\bref\b/, /\brrn\b/, /transaction/,
    /\btype\b/, /details/, /memo/, /withdraw/, /deposit/, /particulars/,
];

/** Find the row that looks like column headers (statements have title/summary
 *  preambles above the real header). Returns 0 when nothing scores clearly. */
export function guessHeaderRow(rows: string[][]): number {
    let best = 0;
    let bestScore = 0;
    const limit = Math.min(rows.length, 25);
    for (let i = 0; i < limit; i++) {
        const cells = (rows[i] ?? []).map((c) => String(c).toLowerCase());
        let score = 0;
        for (const cell of cells) {
            if (cell.trim() && HEADER_KEYWORDS.some((k) => k.test(cell))) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return bestScore >= 3 ? best : 0;
}

/** Lift account name / number / currency / opening balance from the preamble. */
export function detectStatementMeta(rows: string[][], headerRow: number): StatementMeta {
    const meta: StatementMeta = {};
    const valueAfter = (row: string[], labelIdx: number) => {
        for (let j = labelIdx + 1; j < row.length; j++) {
            const v = String(row[j] ?? "").trim();
            if (v) return v;
        }
        return "";
    };
    for (const row of rows.slice(0, headerRow)) {
        row.forEach((cell, idx) => {
            const c = String(cell).toLowerCase();
            if (/account\s*name/.test(c) && !meta.accountName) {
                meta.accountName = valueAfter(row, idx);
            } else if (/account\s*(number|no\b|#)/.test(c) && !meta.accountNumber) {
                meta.accountNumber = valueAfter(row, idx).replace(/\s+/g, "");
            } else if (/^\s*currency/.test(c) && !meta.currency) {
                meta.currency = valueAfter(row, idx).toUpperCase().slice(0, 3);
            } else if (/opening\s*balance/.test(c) && meta.openingBalance === undefined) {
                const v = parseAmount(valueAfter(row, idx));
                if (v !== null) meta.openingBalance = v;
            }
        });
    }
    return meta;
}

export function parseAmount(raw: string): number | null {
    let s = raw.trim();
    if (!s) return null;
    const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d\-.,()]/g, ""));
    s = s.replace(/[()]/g, "").replace(/[^\d.,]/g, "");
    if (!s) return null;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
        // Both present: the later one is the decimal separator.
        if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
    } else if (lastComma > -1) {
        // "12,34" → decimal; "1,234" → thousands
        s = s.length - lastComma - 1 === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
}

export function normalizeCsv(
    rows: string[][],
    mapping: CsvMapping,
    currency: string,
): NormalizeResult {
    const txs: ImportTx[] = [];
    const errors: string[] = [];
    const dataStart = mapping.hasHeader ? (mapping.headerRow ?? 0) + 1 : 0;
    const dataRows = rows.slice(dataStart);

    dataRows.forEach((row, idx) => {
        const line = dataStart + idx + 1;
        const dateRaw = String(row[mapping.dateCol] ?? "");
        const occurred = parseDateStr(dateRaw, mapping.dateFormat);
        if (!occurred) {
            errors.push(`line ${line}: unparseable date "${dateRaw}"`);
            return;
        }

        let signed: number | null = null;
        if (mapping.amountMode === "signed") {
            signed = parseAmount(String(row[mapping.amountCol] ?? ""));
            if (signed !== null && mapping.signConvention === "positive_expense") {
                signed = -signed;
            }
        } else {
            const debit = parseAmount(String(row[mapping.debitCol] ?? ""));
            const credit = parseAmount(String(row[mapping.creditCol] ?? ""));
            if (debit) signed = -Math.abs(debit);
            else if (credit) signed = Math.abs(credit);
        }
        if (signed === null || signed === 0) {
            errors.push(`line ${line}: no usable amount`);
            return;
        }

        txs.push({
            occurred_at: occurred,
            amount: Math.abs(signed),
            currency,
            kind: signed < 0 ? "expense" : "income",
            payee:
                mapping.payeeCol >= 0
                    ? String(row[mapping.payeeCol] ?? "").trim() || undefined
                    : undefined,
            memo:
                mapping.memoCol >= 0
                    ? String(row[mapping.memoCol] ?? "").trim() || undefined
                    : undefined,
            reference:
                mapping.referenceCol >= 0
                    ? String(row[mapping.referenceCol] ?? "").trim() || undefined
                    : undefined,
        });
    });

    return { txs, errors };
}

/** Best-effort column guesses from a header row. Patterns are tried in
 *  priority order so a specific column (Beneficiary) beats a generic one
 *  (Account Name) even when both would match. */
export function guessMapping(headers: string[], headerRow = 0): CsvMapping {
    const h = headers.map((x) => x.toLowerCase());
    // First column whose header matches any pattern, patterns in priority order.
    const find = (patterns: RegExp[]) => {
        for (const p of patterns) {
            const idx = h.findIndex((name) => p.test(name));
            if (idx >= 0) return idx;
        }
        return -1;
    };

    const debitCol = find([/settlement\s*debit/, /debit/, /withdraw/, /money\s*out/]);
    const creditCol = find([/settlement\s*credit/, /credit(?!\s*card)/, /deposit/, /money\s*in/]);
    const amountCol = find([/transaction\s*amount/, /amount/, /value/, /^amt$/]);

    return {
        hasHeader: true,
        headerRow,
        dateCol: Math.max(find([/^date/, /\bdate\b/, /posted/, /^when$/]), 0),
        dateFormat: "auto",
        // Prefer debit/credit whenever both exist — a separate amount column in
        // that layout is usually unsigned and would misclassify everything.
        amountMode: debitCol >= 0 && creditCol >= 0 ? "debit_credit" : "signed",
        amountCol: Math.max(amountCol, 0),
        debitCol: Math.max(debitCol, 0),
        creditCol: Math.max(creditCol, 0),
        signConvention: "negative_expense",
        payeeCol: find([
            /beneficiary/, /payee/, /counterparty/, /merchant/, /narrat/,
            /description/, /details/, /particulars/, /\bname\b/,
        ]),
        memoCol: find([/narrat/, /memo/, /note/, /remark/, /description/, /particulars/]),
        referenceCol: find([/transaction\s*ref/, /reference/, /\brrn\b/, /session/, /^ref$/]),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved mappings (per header signature, this browser)
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_KEY = "sagebook.import.templates";

export function headerSignature(rows: string[][], headerRow = 0): string {
    return (rows[headerRow] ?? []).map((c) => String(c).trim().toLowerCase()).join("|");
}

export function loadTemplate(signature: string): CsvMapping | null {
    try {
        const all = JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "{}");
        return all[signature] ?? null;
    } catch {
        return null;
    }
}

export function saveTemplate(signature: string, mapping: CsvMapping): void {
    try {
        const all = JSON.parse(localStorage.getItem(TEMPLATE_KEY) ?? "{}");
        all[signature] = mapping;
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(all));
    } catch {
        /* storage full/blocked — templates are a convenience only */
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFX / QFX
// ─────────────────────────────────────────────────────────────────────────────

export function looksLikeOfx(text: string): boolean {
    return /<OFX>/i.test(text) || /OFXHEADER/i.test(text);
}

export function parseOfx(text: string, fallbackCurrency: string): NormalizeResult {
    const errors: string[] = [];
    const txs: ImportTx[] = [];
    const currency = (
        text.match(/<CURDEF>\s*([A-Za-z]{3})/i)?.[1] ?? fallbackCurrency
    ).toUpperCase();

    const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
    const field = (block: string, tag: string) =>
        block.match(new RegExp(`<${tag}>([^\\r\\n<]*)`, "i"))?.[1]?.trim() ?? "";

    blocks.forEach((block, i) => {
        const dt = field(block, "DTPOSTED").slice(0, 8);
        const amt = parseAmount(field(block, "TRNAMT"));
        if (!/^\d{8}$/.test(dt) || amt === null || amt === 0) {
            errors.push(`transaction ${i + 1}: missing date or amount`);
            return;
        }
        txs.push({
            occurred_at: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T12:00:00Z`,
            amount: Math.abs(amt),
            currency,
            kind: amt < 0 ? "expense" : "income",
            payee: field(block, "NAME") || undefined,
            memo: field(block, "MEMO") || undefined,
        });
    });

    if (!blocks.length) errors.push("no <STMTTRN> blocks found in this file");
    return { txs, errors };
}
