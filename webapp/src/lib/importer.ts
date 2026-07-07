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
}

export interface NormalizeResult {
    txs: ImportTx[];
    errors: string[];
}

export type DateFormat = "auto" | "ymd" | "dmy" | "mdy";

export interface CsvMapping {
    hasHeader: boolean;
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

export function parseDateStr(raw: string, fmt: DateFormat): string | null {
    const s = raw.trim();
    if (!s) return null;
    const parts = s.split(/[/\-.]/).map((p) => p.trim());
    if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
        const [a, b, c] = parts.map(Number);
        let mode = fmt;
        if (mode === "auto") {
            if (parts[0].length === 4) mode = "ymd";
            else if (a > 12) mode = "dmy";
            else if (b > 12) mode = "mdy";
            else mode = "dmy"; // ambiguous — most non-US banks are day-first
        }
        let y: number, m: number, d: number;
        if (mode === "ymd") [y, m, d] = [a, b, c];
        else if (mode === "mdy") [m, d, y] = [a, b, c];
        else [d, m, y] = [a, b, c];
        if (y < 100) y += 2000;
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        // Noon UTC so local-timezone rendering never shifts the calendar day.
        return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00Z`;
    }
    const t = Date.parse(s); // e.g. "12 Jan 2026"
    return Number.isNaN(t) ? null : new Date(t).toISOString();
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
    const dataRows = mapping.hasHeader ? rows.slice(1) : rows;

    dataRows.forEach((row, idx) => {
        const line = idx + (mapping.hasHeader ? 2 : 1);
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
        });
    });

    return { txs, errors };
}

/** Best-effort column guesses from header names. */
export function guessMapping(headers: string[]): CsvMapping {
    const h = headers.map((x) => x.toLowerCase());
    const find = (patterns: RegExp[]) =>
        h.findIndex((name) => patterns.some((p) => p.test(name)));

    const debitCol = find([/debit/, /withdraw/, /money\s*out/]);
    const creditCol = find([/credit(?!\s*card)/, /deposit/, /money\s*in/]);
    const amountCol = find([/amount/, /value/, /^amt$/]);

    return {
        hasHeader: true,
        dateCol: Math.max(find([/date/, /posted/, /^when$/]), 0),
        dateFormat: "auto",
        amountMode: debitCol >= 0 && creditCol >= 0 && amountCol < 0 ? "debit_credit" : "signed",
        amountCol: Math.max(amountCol, 0),
        debitCol: Math.max(debitCol, 0),
        creditCol: Math.max(creditCol, 0),
        signConvention: "negative_expense",
        payeeCol: find([/payee/, /description/, /narrat/, /merchant/, /details/, /name/]),
        memoCol: find([/memo/, /note/, /reference/, /^ref/]),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved mappings (per header signature, this browser)
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_KEY = "sagebook.import.templates";

export function headerSignature(rows: string[][]): string {
    return (rows[0] ?? []).map((c) => String(c).trim().toLowerCase()).join("|");
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
