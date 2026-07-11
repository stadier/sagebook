import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, fmtMoney } from "../lib/format";
import {
    type CsvMapping,
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
} from "../lib/importer";
import { logEvent } from "../lib/logger";
import { fileToBase64, uploadToIngest } from "../lib/storage";
import { invokeFn } from "../lib/supabase";
import { fetchAccounts } from "../lib/taxonomy";
import type { ProcessMediaResult } from "../lib/types";

const MAX_ROWS = 1000;

interface ImportResult {
    ingestionId: string;
    committed: number;
    duplicates: number;
    rulesApplied: number;
}

export default function Import() {
    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
    const activeAccounts = (accounts.data ?? []).filter((a) => !a.is_archived);

    const [file, setFile] = useState<File | null>(null);
    const [fileKind, setFileKind] = useState<"csv" | "ofx" | "pdf" | null>(null);
    const [rows, setRows] = useState<string[][]>([]);
    const [ofxResult, setOfxResult] = useState<ReturnType<typeof parseOfx> | null>(null);
    const [mapping, setMapping] = useState<CsvMapping | null>(null);
    const [templateLoaded, setTemplateLoaded] = useState(false);
    const [accountId, setAccountId] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [parseError, setParseError] = useState("");

    async function onFile(f: File | null) {
        setFile(f);
        setFileKind(null);
        setRows([]);
        setOfxResult(null);
        setMapping(null);
        setTemplateLoaded(false);
        setParseError("");
        if (!f) return;

        const ext = f.name.toLowerCase().split(".").pop() ?? "";

        // PDFs are unstructured — they go through AI extraction instead of
        // the deterministic column-mapping flow.
        if (ext === "pdf" || f.type === "application/pdf") {
            setFileKind("pdf");
            return;
        }

        // Excel: first worksheet → rows, then the normal CSV mapping flow.
        if (ext === "xlsx" || ext === "xls") {
            const parsed = await parseWorkbook(await f.arrayBuffer());
            if (parsed.length < 2) {
                setParseError("Could not find data rows in the first worksheet.");
                return;
            }
            setFileKind("csv");
            setRows(parsed);
            const template = loadTemplate(headerSignature(parsed));
            setTemplateLoaded(!!template);
            setMapping(template ?? guessMapping(parsed[0].map(String)));
            return;
        }

        const text = await f.text();
        if (looksLikeOfx(text)) {
            setFileKind("ofx");
            setOfxResult(parseOfx(text, currency));
            return;
        }
        const parsed = parseCsv(text);
        if (parsed.length < 2) {
            setParseError("Could not find data rows in this file. Is it a CSV, Excel, OFX, or PDF export?");
            return;
        }
        setFileKind("csv");
        setRows(parsed);
        const template = loadTemplate(headerSignature(parsed));
        setTemplateLoaded(!!template);
        setMapping(template ?? guessMapping(parsed[0].map(String)));
    }

    // Selecting an account defaults the row currency to that account's currency.
    function onAccount(id: string) {
        setAccountId(id);
        const acct = activeAccounts.find((a) => a.id === id);
        if (acct) setCurrency(acct.currency);
    }

    const normalized: { txs: ImportTx[]; errors: string[] } | null =
        fileKind === "ofx"
            ? ofxResult
            : fileKind === "csv" && mapping
              ? normalizeCsv(rows, mapping, currency.toUpperCase())
              : null;

    const doImport = useMutation({
        mutationFn: async (): Promise<ImportResult> => {
            if (!normalized || !file) throw new Error("nothing to import");
            if (!normalized.txs.length) throw new Error("no valid rows to import");
            if (normalized.txs.length > MAX_ROWS) {
                throw new Error(`too many rows (max ${MAX_ROWS}); split the file`);
            }
            if (fileKind === "csv" && mapping) {
                saveTemplate(headerSignature(rows), mapping);
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
            logEvent("info", "import", `Import: ${r.committed} rows saved from ${file?.name}`, {
                ingestionId: r.ingestionId,
                committed: r.committed,
                duplicates: r.duplicates,
                rulesApplied: r.rulesApplied,
                skipped: normalized?.errors.length ?? 0,
            });
        },
        onError: (error) => {
            logEvent("error", "import", `Import failed: ${(error as Error).message}`, {
                file: file ? { name: file.name, size: file.size } : null,
                rows: normalized?.txs.length ?? 0,
            });
        },
    });

    // PDFs bypass column mapping: archive to storage, extract with the AI
    // pipeline (rules, dedup, and account/category inference all apply).
    const aiImport = useMutation({
        mutationFn: async (): Promise<ProcessMediaResult> => {
            if (!file) throw new Error("no file selected");
            if (file.size > 15 * 1024 * 1024) {
                throw new Error("PDF too large (max 15 MB)");
            }
            const storagePath = await uploadToIngest(file);
            const payload: Record<string, unknown> = {
                clientTime: new Date().toISOString(),
                promptHint: accountId
                    ? `Statement belongs to account: ${activeAccounts.find((a) => a.id === accountId)?.name}`
                    : undefined,
            };
            if (storagePath) payload.storagePath = storagePath;
            else payload.inlineMedia = { mimeType: "application/pdf", data: await fileToBase64(file) };
            return invokeFn<ProcessMediaResult>("process-media", payload);
        },
        onSuccess: (r) => {
            logEvent("info", "import", `PDF import: ${r.committed} rows saved from ${file?.name}`, {
                ingestionId: r.ingestionId,
                model: r.model,
                committed: r.committed,
                duplicates: r.duplicates,
                insertErrors: r.insertErrors ?? [],
            });
        },
        onError: (error) => {
            logEvent("error", "import", `PDF import failed: ${(error as Error).message}`, {
                file: file ? { name: file.name, size: file.size } : null,
            });
        },
    });

    if (aiImport.isSuccess) {
        const r = aiImport.data;
        return (
            <div className="mx-auto max-w-2xl">
                <h1 className="mb-4 text-xl font-semibold">PDF extracted</h1>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <p className="mb-2 text-slate-400">{r.parsed.summary}</p>
                    <p className="text-slate-200">
                        {r.committed} transaction{r.committed === 1 ? "" : "s"} sent to your inbox.
                    </p>
                    <p className="mt-1 text-slate-400">
                        {r.duplicates} flagged as possible duplicates · {r.rulesApplied} rules applied
                        · {r.model}
                    </p>
                    {(r.insertErrors?.length ?? 0) > 0 && (
                        <p className="mt-2 text-xs text-amber-400">
                            ⚠ {r.insertErrors!.length} row{r.insertErrors!.length === 1 ? "" : "s"} could
                            not be saved: {r.insertErrors!.join(" · ")}
                        </p>
                    )}
                    <div className="mt-4 flex gap-3">
                        <Link
                            to="/inbox"
                            className="rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500"
                        >
                            Review in inbox →
                        </Link>
                        <button
                            className={neutralCls}
                            onClick={() => {
                                aiImport.reset();
                                onFile(null);
                            }}
                        >
                            Import another file
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (doImport.isSuccess) {
        const r = doImport.data;
        return (
            <div className="mx-auto max-w-2xl">
                <h1 className="mb-4 text-xl font-semibold">Import complete</h1>
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
                            className="rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500"
                        >
                            Review in inbox →
                        </Link>
                        <button className={neutralCls} onClick={() => doImport.reset()}>
                            Import another file
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold">Import statement</h1>
            <p className="mb-6 text-sm text-slate-400">
                CSV, Excel, and OFX/QFX exports are parsed locally — no AI involved.
                PDF statements go through AI extraction instead. Either way, rows land
                in the inbox with rules and duplicate detection applied, so overlap with
                receipts you already captured gets flagged, not double-counted.
            </p>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <input
                    type="file"
                    accept=".csv,.txt,.ofx,.qfx,.xlsx,.xls,.pdf"
                    onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
                />
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

            {fileKind === "pdf" && (
                <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <p className="mb-1 text-slate-200">
                        {file?.name} · {((file?.size ?? 0) / 1024).toFixed(0)} KB
                    </p>
                    <p className="mb-3 text-xs text-slate-500">
                        PDFs are extracted by the AI (accounts, categories, and references
                        are inferred — you confirm everything in the inbox). Selecting an
                        account above passes it as a hint.
                    </p>
                    <button
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                        disabled={aiImport.isPending}
                        onClick={() => aiImport.mutate()}
                    >
                        {aiImport.isPending ? "Extracting…" : "Extract transactions"}
                    </button>
                    {aiImport.isError && (
                        <p className="mt-2 text-xs text-rose-400">{(aiImport.error as Error).message}</p>
                    )}
                </div>
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
    const headers = rows[0].map((h, i) => (mapping.hasHeader ? String(h) : `Column ${i + 1}`));
    const set = <K extends keyof CsvMapping>(key: K, value: CsvMapping[K]) =>
        onChange({ ...mapping, [key]: value });

    const colSelect = (
        label: string,
        key: "dateCol" | "amountCol" | "debitCol" | "creditCol" | "payeeCol" | "memoCol",
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
            </div>

            <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-800/60">
                        {rows.slice(0, 4).map((row, i) => (
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
