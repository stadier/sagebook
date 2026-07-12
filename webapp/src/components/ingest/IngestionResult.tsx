import { Link } from "react-router-dom";
import { fmtDateTime, fmtMoney } from "../../lib/format";
import type { ProcessMediaResult } from "../../lib/types";

/**
 * Shared success view for the AI extraction path — merges what were previously
 * the Capture page's <ExtractionResult> and the Import page's PDF success block.
 * Rendered inside the ingest modal; "Review in inbox" closes it and navigates.
 */
export default function IngestionResult({
    result,
    onAddAnother,
    onClose,
}: {
    result: ProcessMediaResult;
    onAddAnother: () => void;
    onClose: () => void;
}) {
    const inferred = result.parsed.transactions.some(
        (t) => t.account?.name || t.reference || t.category,
    );
    const insertErrors = result.insertErrors ?? [];

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-slate-200">Extraction result</h2>
                <span className="shrink-0 text-xs text-slate-500">
                    {result.model} · confidence {(result.parsed.confidence * 100).toFixed(0)}%
                </span>
            </div>
            <p className="mb-3 text-sm text-slate-400">{result.parsed.summary}</p>

            {result.parsed.transcript && (
                <blockquote className="mb-3 rounded-lg border-l-2 border-slate-700 bg-slate-950/60 px-3 py-2 text-xs italic text-slate-400">
                    “{result.parsed.transcript}”
                </blockquote>
            )}

            {inferred && (
                <div className="mb-3 rounded-lg border border-sky-900/50 bg-sky-950/20 p-3 text-xs">
                    <p className="mb-1 text-sky-300/80">
                        Inferred (confirm or refine in the inbox before accepting):
                    </p>
                    {result.parsed.transactions.map((t, i) => (
                        <p key={i} className="text-slate-400">
                            {t.payee ?? `#${i + 1}`}:
                            {t.account?.name &&
                                ` account "${t.account.name}"${t.account.institution ? ` (${t.account.institution})` : ""} ·`}
                            {t.category && ` category "${t.category}" ·`}
                            {t.reference && ` ref ${t.reference}`}
                        </p>
                    ))}
                </div>
            )}

            {insertErrors.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300">
                    <p className="mb-1 font-medium">
                        ⚠ {insertErrors.length} extracted row
                        {insertErrors.length === 1 ? "" : "s"} could not be saved:
                    </p>
                    {insertErrors.map((err, i) => (
                        <p key={i} className="text-amber-300/80">
                            {err}
                        </p>
                    ))}
                </div>
            )}

            {result.inbox.length === 0 ? (
                <p className="text-sm text-slate-500">
                    {result.parsed.transactions.length > 0
                        ? "Transactions were extracted but none could be saved — see the warnings above."
                        : "No transactions were extracted."}
                </p>
            ) : (
                <ul className="divide-y divide-slate-800">
                    {result.inbox.map((tx) => (
                        <li key={tx.id} className="flex items-center justify-between py-2 text-sm">
                            <div>
                                <div className="text-slate-200">{tx.payee ?? "(no payee)"}</div>
                                <div className="text-xs text-slate-500">{fmtDateTime(tx.occurred_at)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                {tx.duplicate_group_id && (
                                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                                        possible duplicate
                                    </span>
                                )}
                                <span className="font-medium">{fmtMoney(tx.amount, tx.currency)}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span>{result.committed} sent to inbox</span>
                <span>{result.duplicates} duplicate-flagged</span>
                <span>{result.rulesApplied} rules applied</span>
                <div className="ml-auto flex items-center gap-3">
                    <button
                        onClick={onAddAnother}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                    >
                        Add another
                    </button>
                    <Link
                        to="/inbox"
                        onClick={onClose}
                        className="font-medium text-emerald-400 hover:text-emerald-300"
                    >
                        Review in inbox →
                    </Link>
                </div>
            </div>
        </div>
    );
}
