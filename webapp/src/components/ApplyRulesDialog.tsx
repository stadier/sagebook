/* "Apply to past" — the retroactive half of a rule.

   A rule you write today only ever sees tomorrow's captures, which is the wrong
   answer when you wrote it *because* the last two years came in miscategorised.
   This dialog runs the same matcher back over rows already in the ledger.

   It is preview-first by design: opening it (and every scope change) fires a dry
   run, so the counts and a sample of the actual rows are on screen before the
   Apply button does anything. */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { fmtDate } from "../lib/format";
import { type ApplyRulesResult, type ApplyScope, applyRules } from "../lib/rules";
import { Modal, Pill, QueryError, Segmented } from "./ui";

const SCOPE_OPTIONS: Array<{ value: ApplyScope; label: string }> = [
    { value: "uncategorized", label: "Uncategorised only" },
    { value: "all", label: "Every match" },
];

const SCOPE_HELP: Record<ApplyScope, string> = {
    uncategorized: "Only fills gaps — a transaction that already has a category is left alone.",
    all: "Overwrites the category on every matching transaction, including ones you set by hand.",
};

export default function ApplyRulesDialog({
    open,
    onClose,
    ruleIds,
    subject,
}: {
    open: boolean;
    onClose: () => void;
    /** Rules to run. Omitted, every active rule runs. */
    ruleIds?: string[];
    /** What the user thinks they're applying — shown in the dialog subtitle. */
    subject: string;
}) {
    const qc = useQueryClient();
    const [scope, setScope] = useState<ApplyScope>("uncategorized");
    const [preview, setPreview] = useState<ApplyRulesResult | null>(null);
    const [applied, setApplied] = useState<ApplyRulesResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const runPreview = useCallback(
        async (next: ApplyScope) => {
            setBusy(true);
            setError(null);
            try {
                setPreview(await applyRules({ ruleIds, scope: next, dryRun: true }));
            } catch (err) {
                setError(err);
                setPreview(null);
            } finally {
                setBusy(false);
            }
        },
        [ruleIds],
    );

    // Reset and re-preview each time the dialog opens — the ledger may have
    // moved since it was last closed.
    useEffect(() => {
        if (!open) return;
        setScope("uncategorized");
        setPreview(null);
        setApplied(null);
        setError(null);
        void runPreview("uncategorized");
    }, [open, runPreview]);

    function changeScope(next: ApplyScope) {
        setScope(next);
        setApplied(null);
        void runPreview(next);
    }

    async function commit() {
        setBusy(true);
        setError(null);
        try {
            const result = await applyRules({ ruleIds, scope, dryRun: false });
            setApplied(result);
            // A recategorisation moves the ground under budgets, reports, net
            // worth and the monthly summaries alike — refetch the lot rather
            // than trying to name every derived view.
            await qc.invalidateQueries();
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    }

    const result = applied ?? preview;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Apply to past transactions"
            subtitle={subject}
            width="40rem"
        >
            <div className="flex flex-col gap-4">
                <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[0.8125rem] font-semibold text-slate-300">Scope</span>
                        <Segmented options={SCOPE_OPTIONS} value={scope} onChange={changeScope} />
                    </div>
                    <p className="text-xs text-slate-500">{SCOPE_HELP[scope]}</p>
                </div>

                <QueryError error={error} />

                {applied && (
                    <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
                        Updated {applied.changed} transaction{applied.changed === 1 ? "" : "s"}.
                    </div>
                )}

                {busy && !result && (
                    <div className="h-24 animate-pulse rounded-xl bg-slate-950" />
                )}

                {result && (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <Stat label="Scanned" value={result.scanned} />
                            <Stat label="Matched" value={result.matched} />
                            <Stat label={applied ? "Changed" : "Would change"} value={result.changed} />
                        </div>

                        {result.unresolvedCategories.length > 0 && (
                            <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
                                These rules point at a category that no longer exists, so they can't
                                fire: {result.unresolvedCategories.join(", ")}. Rename the category
                                back, or edit the rule.
                            </p>
                        )}

                        {result.byRule.length > 1 && (
                            <div className="flex flex-col gap-1">
                                <span className="sb-eyebrow">Per rule</span>
                                {result.byRule.map((r) => (
                                    <div
                                        key={r.id}
                                        className="flex items-baseline justify-between gap-3 text-[0.8125rem]"
                                    >
                                        <span className="min-w-0 truncate text-slate-300">
                                            {r.name}
                                        </span>
                                        <span className="shrink-0 text-slate-500 tnum">
                                            {r.changed} of {r.matched}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {result.changed === 0 ? (
                            <p className="text-sm text-slate-500">
                                {result.matched > 0
                                    ? "Every matching transaction is already filed the way these rules want it."
                                    : "Nothing in the ledger matches these rules."}
                            </p>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                <span className="sb-eyebrow">
                                    {applied ? "Changed" : "Sample"} — first{" "}
                                    {Math.min(result.sample.length, result.changed)} of{" "}
                                    {result.changed}
                                </span>
                                {result.sample.map((s) => (
                                    <div
                                        key={s.id}
                                        className="sb-nested flex flex-wrap items-center gap-2 px-3 py-2 text-[0.8125rem]"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-slate-300">
                                            {s.payee ?? "(no payee)"}
                                        </span>
                                        <span className="shrink-0 text-xs text-slate-500">
                                            {fmtDate(s.occurred_at)}
                                        </span>
                                        {s.toCategory && (
                                            <span className="flex shrink-0 items-center gap-1.5">
                                                {s.fromCategory && (
                                                    <>
                                                        <span className="text-xs text-slate-500 line-through">
                                                            {s.fromCategory}
                                                        </span>
                                                        <span className="text-xs text-slate-600">
                                                            →
                                                        </span>
                                                    </>
                                                )}
                                                <Pill tint="indigo">{s.toCategory}</Pill>
                                            </span>
                                        )}
                                        {s.addedTags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="shrink-0 rounded bg-chip px-1.5 py-0.5 text-xs text-slate-400"
                                            >
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                    <button className="sb-btn sb-btn-ghost" onClick={onClose}>
                        {applied ? "Done" : "Cancel"}
                    </button>
                    {!applied && (
                        <button
                            className="sb-btn sb-btn-primary"
                            disabled={busy || !result || result.changed === 0}
                            onClick={commit}
                        >
                            {busy
                                ? "Working…"
                                : result
                                  ? `Apply to ${result.changed} transaction${result.changed === 1 ? "" : "s"}`
                                  : "Apply"}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="sb-nested px-3 py-2.5">
            <div className="text-lg font-extrabold text-slate-100 tnum">{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
        </div>
    );
}
