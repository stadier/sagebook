import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, fmtMoney } from "../../lib/format";
import {
    type CsvMapping,
    detectStatementMeta,
    guessHeaderRow,
    guessMapping,
    headerSignature,
    type ImportTx,
    loadTemplate,
    looksLikeOfx,
    normalizeCsv,
    parseCsv,
    parseOfx,
    parseWorkbook,
    saveTemplate,
    type StatementMeta,
} from "../../lib/importer";
import { logEvent } from "../../lib/logger";
import { uploadToIngest } from "../../lib/storage";
import { invokeFn, requireSupabase } from "../../lib/supabase";
import { fetchAccounts } from "../../lib/taxonomy";

const MAX_ROWS = 1000;

interface ImportResult {
    ingestionId: string;
    committed: number;
    duplicates: number;
    rulesApplied: number;
}

/**
 * Deterministic statement import (CSV / Excel / OFX) — column mapping, preview,
 * and commit to ingest-import. Migrated from the old Import page; the ingest
 * modal hands it a structured file (PDFs take the AI path in UnifiedEntry).
 */
export default function ImportFlow({
    file,
    onBack,
    onClose,
}: {
    file: File;
    onBack: () => void;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
    const activeAccounts = (accounts.data ?? []).filter((a) => !a.is_archived);

    const [fileKind, setFileKind] = useState<"csv" | "ofx" | null>(null);
    const [rows, setRows] = useState<string[][]>([]);
    const [ofxResult, setOfxResult] = useState<ReturnType<typeof parseOfx> | null>(null);
    const [mapping, setMapping] = useState<CsvMapping | null>(null);
    const [templateLoaded, setTemplateLoaded] = useState(false);
    const [meta, setMeta] = useState<StatementMeta | null>(null);
    const [accountId, setAccountId] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [parseError, setParseError] = useState("");
    const [parsing, setParsing] = useState(true);

    // Shared setup for a parsed grid: detect the header row (statements have a
    // title/summary preamble), auto-map from it, and lift account details.
    function applyGrid(parsed: string[][]) {
        const headerRow = guessHeaderRow(parsed);
        setFileKind("csv");
        setRows(parsed);
        const template = loadTemplate(headerSignature(parsed, headerRow));
        setTemplateLoaded(!!template);
        // Backfill fields added after a template may have been saved.
        setMapping(
            template
                ? {
                      ...template,
                      headerRow: template.headerRow ?? headerRow,
                      referenceCol: template.referenceCol ?? -1,
                  }
                : guessMapping(parsed[headerRow].map(String), headerRow),
        );
        const m = detectStatementMeta(parsed, headerRow);
        setMeta(m);
        if (m.currency && /^[A-Z]{3}$/.test(m.currency)) setCurrency(m.currency);
    }

    // Parse the handed-in file once (and whenever it changes).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setFileKind(null);
            setRows([]);
            setOfxResult(null);
            setMapping(null);
            setTemplateLoaded(false);
            setMeta(null);
            setParseError("");
            setParsing(true);

            const ext = file.name.toLowerCase().split(".").pop() ?? "";

            // Any failure here (bad file, xlsx-chunk load error, parser throw)
            // must surface — otherwise the screen dead-ends with no explanation.
            try {
                if (ext === "xlsx" || ext === "xls") {
                    const parsed = await parseWorkbook(await file.arrayBuffer());
                    if (cancelled) return;
                    if (parsed.length < 2) {
                        setParseError("Could not find data rows in the first worksheet.");
                        return;
                    }
                    applyGrid(parsed);
                    return;
                }

                const text = await file.text();
                if (cancelled) return;
                if (looksLikeOfx(text)) {
                    setFileKind("ofx");
                    setOfxResult(parseOfx(text, currency));
                    return;
                }
                const parsed = parseCsv(text);
                if (parsed.length < 2) {
                    setParseError("Could not find data rows in this file. Is it a CSV, Excel, or OFX export?");
                    return;
                }
                applyGrid(parsed);
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    setParseError(`Could not read this file: ${message}`);
                    logEvent("error", "import", `Import parse failed: ${message}`, {
                        file: { name: file.name, size: file.size },
                    });
                }
            } finally {
                if (!cancelled) setParsing(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // currency is only used as an OFX fallback at parse time; re-parsing on
        // every currency keystroke would be wasteful, so it is intentionally omitted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

    // Selecting an account defaults the row currency to that account's currency.
    function onAccount(id: string) {
        setAccountId(id);
        const acct = activeAccounts.find((a) => a.id === id);
        if (acct) setCurrency(acct.currency);
    }

    // Does the statement's account already exist? Match on the number (which we
    // store masked) or an exact name, so a re-import files under the same ledger.
    const last4 = meta?.accountNumber?.slice(-4);
    const existingMatch = activeAccounts.find(
        (a) =>
            (last4 && a.metadata?.number_masked?.includes(last4)) ||
            (meta?.accountName && a.name.toLowerCase() === meta.accountName.toLowerCase()),
    );

    // Auto-select an existing matching account once, so the user needn't pick it.
    useEffect(() => {
        if (existingMatch && !accountId) {
            setAccountId(existingMatch.id);
            setCurrency(existingMatch.currency);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingMatch?.id]);

    const createAccount = useMutation({
        mutationFn: async () => {
            if (!meta) throw new Error("no statement details");
            const sb = requireSupabase();
            const { data: u } = await sb.auth.getUser();
            if (!u.user) throw new Error("not signed in");
            const { data: created, error } = await sb
                .from("accounts")
                .insert({
                    user_id: u.user.id,
                    name: (meta.accountName || "Imported account").slice(0, 80),
                    type: "checking",
                    currency: (meta.currency || currency).toUpperCase().slice(0, 3),
                    // The statement's opening balance is authoritative, so this is
                    // a real (not inferred) opening balance.
                    opening_balance: meta.openingBalance ?? 0,
                    metadata: meta.accountNumber
                        ? { number_masked: `••••${meta.accountNumber.slice(-4)}` }
                        : {},
                })
                .select("id, currency")
                .single();
            if (error) throw new Error(error.message);
            return created;
        },
        onSuccess: (created) => {
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["account-balances"] });
            setAccountId(created.id);
            setCurrency(created.currency);
        },
    });

    const normalized: { txs: ImportTx[]; errors: string[] } | null =
        fileKind === "ofx"
            ? ofxResult
            : fileKind === "csv" && mapping
              ? normalizeCsv(rows, mapping, currency.toUpperCase())
              : null;

    const doImport = useMutation({
        mutationFn: async (): Promise<ImportResult> => {
            if (!normalized) throw new Error("nothing to import");
            if (!normalized.txs.length) throw new Error("no valid rows to import");
            if (normalized.txs.length > MAX_ROWS) {
                throw new Error(`too many rows (max ${MAX_ROWS}); split the file`);
            }
            if (fileKind === "csv" && mapping) {
                saveTemplate(headerSignature(rows, mapping.headerRow), mapping);
            }
            const storagePath = await uploadToIngest(file); // archive; ok if null
            return invokeFn<ImportResult>("ingest-import", {
                transactions: normalized.txs,
                accountId: accountId || null,
                storagePath,
                filename: file.name,
            });
        },
        onSuccess: (r) => {
            qc.invalidateQueries({ queryKey: ["pending-review"] });
            logEvent("info", "import", `Import: ${r.committed} rows saved from ${file.name}`, {
                ingestionId: r.ingestionId,
                committed: r.committed,
                duplicates: r.duplicates,
                rulesApplied: r.rulesApplied,
                skipped: normalized?.errors.length ?? 0,
            });
        },
        onError: (error) => {
            logEvent("error", "import", `Import failed: ${(error as Error).message}`, {
                file: { name: file.name, size: file.size },
                rows: normalized?.txs.length ?? 0,
            });
        },
    });

    if (doImport.isSuccess) {
        const r = doImport.data;
        return (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                <p className="text-slate-200">
                    {r.committed} transaction{r.committed === 1 ? "" : "s"} sent to your inbox.
                </p>
                <p className="mt-1 text-slate-400">
                    {r.duplicates} flagged as possible duplicates · {r.rulesApplied} rules applied.
                </p>
                <div className="mt-4 flex gap-3">
                    <Link
                        to="/inbox"
                        onClick={onClose}
                        className="rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500"
                    >
                        Review in inbox →
                    </Link>
                    <button className={neutralCls} onClick={onBack}>
                        Add another
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">
                        {file.name} · {(file.size / 1024).toFixed(0)} KB
                    </p>
                    <p className="text-xs text-slate-500">
                        Parsed locally — no AI. Rules and duplicate detection still apply.
                    </p>
                </div>
                <button className={neutralCls} onClick={onBack}>
                    ← Back
                </button>
            </div>

            {meta && (meta.accountName || meta.accountNumber) && (
                <div className="mb-4 rounded-xl border border-sky-900/50 bg-sky-950/20 p-3 text-xs">
                    <div className="mb-1 text-sky-300/80">Detected account on this statement:</div>
                    <div className="text-slate-300">
                        {meta.accountName && <span className="font-medium">{meta.accountName}</span>}
                        {meta.accountNumber && ` · ${meta.accountNumber}`}
                        {meta.currency && ` · ${meta.currency}`}
                        {meta.openingBalance !== undefined &&
                            ` · opening ${fmtMoney(meta.openingBalance, meta.currency || currency)}`}
                    </div>
                    <div className="mt-2">
                        {existingMatch ? (
                            <span className="text-emerald-400">
                                Filing under your existing “{existingMatch.name}”.
                            </span>
                        ) : (
                            <button
                                className="rounded bg-sky-800/60 px-2 py-1 text-sky-200 hover:bg-sky-700/60 disabled:opacity-50"
                                disabled={createAccount.isPending}
                                onClick={() => createAccount.mutate()}
                            >
                                {createAccount.isPending
                                    ? "Creating…"
                                    : "Create this account & file here"}
                            </button>
                        )}
                        {createAccount.isError && (
                            <span className="ml-2 text-rose-400">
                                {(createAccount.error as Error).message}
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <select className={inputCls} value={accountId} onChange={(e) => onAccount(e.target.value)}>
                    <option value="">File under account… (optional)</option>
                    {activeAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    Currency
                    <input
                        className={`${inputCls} w-20`}
                        value={currency}
                        maxLength={3}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    />
                </label>
            </div>

            {parseError && <p className="mb-4 text-sm text-rose-400">{parseError}</p>}

            {parsing && !parseError && (
                <p className="mb-4 text-sm text-slate-400">Reading file…</p>
            )}

            {!parsing && !parseError && !fileKind && (
                <p className="mb-4 text-sm text-slate-500">
                    Nothing to import from this file. If it's a bank export, make sure it's a
                    CSV, Excel, or OFX/QFX — PDFs go through the AI capture path instead.
                </p>
            )}

            {fileKind === "csv" && mapping && (
                <MappingEditor
                    rows={rows}
                    mapping={mapping}
                    templateLoaded={templateLoaded}
                    onChange={setMapping}
                />
            )}

            {normalized && (
                <PreviewPane
                    txs={normalized.txs}
                    errors={normalized.errors}
                    busy={doImport.isPending}
                    onImport={() => doImport.mutate()}
                />
            )}

            {doImport.isError && (
                <p className="mt-3 text-sm text-rose-400">{(doImport.error as Error).message}</p>
            )}
        </div>
    );
}

function MappingEditor({
    rows,
    mapping,
    templateLoaded,
    onChange,
}: {
    rows: string[][];
    mapping: CsvMapping;
    templateLoaded: boolean;
    onChange: (m: CsvMapping) => void;
}) {
    const headerRow = mapping.headerRow ?? 0;
    const headerCells = rows[headerRow] ?? rows[0] ?? [];
    const headers = headerCells.map((h, i) => (mapping.hasHeader ? String(h) : `Column ${i + 1}`));
    const set = <K extends keyof CsvMapping>(key: K, value: CsvMapping[K]) =>
        onChange({ ...mapping, [key]: value });

    const colSelect = (
        label: string,
        key: "dateCol" | "amountCol" | "debitCol" | "creditCol" | "payeeCol" | "memoCol" | "referenceCol",
        optional = false,
    ) => (
        <label className="flex items-center gap-2 text-sm text-slate-400">
            {label}
            <select
                className={inputCls}
                value={mapping[key]}
                onChange={(e) => set(key, Number(e.target.value))}
            >
                {optional && <option value={-1}>— none —</option>}
                {headers.map((h, i) => (
                    <option key={i} value={i}>
                        {h}
                    </option>
                ))}
            </select>
        </label>
    );

    return (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Column mapping</h2>
                {templateLoaded && (
                    <span className="text-xs text-emerald-400">Saved mapping for this bank loaded</span>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    <input
                        type="checkbox"
                        checked={mapping.hasHeader}
                        onChange={(e) => set("hasHeader", e.target.checked)}
                    />
                    First row is a header
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400" title="1-based row that holds the column names; data starts on the next row. Statements often have a title/summary preamble above it.">
                    Header row
                    <input
                        type="number"
                        min={1}
                        max={rows.length}
                        className={`${inputCls} w-16`}
                        value={headerRow + 1}
                        onChange={(e) => set("headerRow", Math.max(0, Number(e.target.value) - 1))}
                    />
                </label>
                {colSelect("Date", "dateCol")}
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    Date format
                    <select
                        className={inputCls}
                        value={mapping.dateFormat}
                        onChange={(e) => set("dateFormat", e.target.value as CsvMapping["dateFormat"])}
                    >
                        <option value="auto">auto</option>
                        <option value="dmy">DD/MM/YYYY</option>
                        <option value="mdy">MM/DD/YYYY</option>
                        <option value="ymd">YYYY-MM-DD</option>
                    </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    Amounts
                    <select
                        className={inputCls}
                        value={mapping.amountMode}
                        onChange={(e) => set("amountMode", e.target.value as CsvMapping["amountMode"])}
                    >
                        <option value="signed">one signed column</option>
                        <option value="debit_credit">debit + credit columns</option>
                    </select>
                </label>
                {mapping.amountMode === "signed" ? (
                    <>
                        {colSelect("Amount", "amountCol")}
                        <label className="flex items-center gap-2 text-sm text-slate-400">
                            Sign
                            <select
                                className={inputCls}
                                value={mapping.signConvention}
                                onChange={(e) =>
                                    set("signConvention", e.target.value as CsvMapping["signConvention"])
                                }
                            >
                                <option value="negative_expense">negative = money out</option>
                                <option value="positive_expense">positive = money out</option>
                            </select>
                        </label>
                    </>
                ) : (
                    <>
                        {colSelect("Debit (out)", "debitCol")}
                        {colSelect("Credit (in)", "creditCol")}
                    </>
                )}
                {colSelect("Payee", "payeeCol", true)}
                {colSelect("Memo", "memoCol", true)}
                {colSelect("Reference", "referenceCol", true)}
            </div>

            <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-800/60">
                        {rows.slice(headerRow, headerRow + 4).map((row, i) => (
                            <tr key={i} className={i === 0 && mapping.hasHeader ? "text-slate-500" : "text-slate-300"}>
                                {row.map((cell, j) => (
                                    <td key={j} className="whitespace-nowrap px-2 py-1">
                                        {String(cell)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function PreviewPane({
    txs,
    errors,
    busy,
    onImport,
}: {
    txs: ImportTx[];
    errors: string[];
    busy: boolean;
    onImport: () => void;
}) {
    const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
    const currency = txs[0]?.currency ?? "USD";

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
                <span className="font-semibold text-slate-200">
                    {txs.length} row{txs.length === 1 ? "" : "s"} ready
                </span>
                <span className="text-emerald-400">in {fmtMoney(income, currency)}</span>
                <span className="text-rose-300">out {fmtMoney(expense, currency)}</span>
                {errors.length > 0 && (
                    <span className="text-amber-400" title={errors.slice(0, 10).join("\n")}>
                        ⚠ {errors.length} row{errors.length === 1 ? "" : "s"} skipped (hover for detail)
                    </span>
                )}
            </div>

            {txs.length > 0 && (
                <table className="mb-3 w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-800 text-left text-slate-500">
                            <th className="py-1 pr-3 font-medium">Date</th>
                            <th className="py-1 pr-3 font-medium">Payee</th>
                            <th className="py-1 pr-3 font-medium">Memo</th>
                            <th className="py-1 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                        {txs.slice(0, 15).map((t, i) => (
                            <tr key={i}>
                                <td className="whitespace-nowrap py-1 pr-3 text-slate-400">
                                    {fmtDate(t.occurred_at)}
                                </td>
                                <td className="py-1 pr-3 text-slate-300">{t.payee ?? "—"}</td>
                                <td className="py-1 pr-3 text-slate-500">{t.memo ?? ""}</td>
                                <td
                                    className={`whitespace-nowrap py-1 text-right ${
                                        t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                                    }`}
                                >
                                    {t.kind === "expense" ? "−" : "+"}
                                    {fmtMoney(t.amount, t.currency)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {txs.length > 15 && (
                <p className="mb-3 text-xs text-slate-600">…and {txs.length - 15} more.</p>
            )}

            <button
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={busy || txs.length === 0}
                onClick={onImport}
            >
                {busy ? "Importing…" : `Import ${txs.length} transactions`}
            </button>
        </div>
    );
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500";
const neutralCls =
    "rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700";
