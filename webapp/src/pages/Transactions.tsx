import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { fmtDate, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import type { Transaction } from "../lib/types";

interface TxRow extends Transaction {
    categories: { name: string; icon: string | null; color: string | null } | null;
}

export default function Transactions() {
    const [search, setSearch] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const txs = useQuery({
        queryKey: ["transactions"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("transactions")
                .select("*, categories(name, icon, color)")
                .eq("review_status", "accepted")
                .order("occurred_at", { ascending: false })
                .limit(300);
            if (error) throw new Error(error.message);
            return (data ?? []) as TxRow[];
        },
    });

    const term = search.trim().toLowerCase();
    const rows = (txs.data ?? []).filter(
        (t) =>
            !term ||
            (t.payee ?? "").toLowerCase().includes(term) ||
            (t.memo ?? "").toLowerCase().includes(term) ||
            (t.categories?.name ?? "").toLowerCase().includes(term),
    );

    return (
        <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Transactions</h1>
                    <p className="text-sm text-slate-400">Accepted ledger entries.</p>
                </div>
                <input
                    className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    placeholder="Search payee, memo, category…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {txs.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {txs.isError && (
                <p className="text-sm text-rose-400">{(txs.error as Error).message}</p>
            )}

            {txs.isSuccess && rows.length === 0 && (
                <p className="text-sm text-slate-500">
                    {term ? "No matches." : "No accepted transactions yet — review your inbox."}
                </p>
            )}

            {rows.length > 0 && (
                <p className="mb-2 text-xs text-slate-600">
                    Click a row to see tags and the original receipt/recording.
                </p>
            )}
            {rows.length > 0 && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                            <th className="py-2 pr-4 font-medium">Date</th>
                            <th className="py-2 pr-4 font-medium">Payee</th>
                            <th className="py-2 pr-4 font-medium">Category</th>
                            <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                        {rows.map((t) => (
                            <Fragment key={t.id}>
                            <tr
                                className="cursor-pointer hover:bg-slate-900/40"
                                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                            >
                                <td className="whitespace-nowrap py-2 pr-4 text-slate-400">
                                    {fmtDate(t.occurred_at)}
                                </td>
                                <td className="py-2 pr-4">
                                    <div className="text-slate-200">{t.payee ?? "—"}</div>
                                    {t.memo && <div className="text-xs text-slate-500">{t.memo}</div>}
                                </td>
                                <td className="py-2 pr-4">
                                    {t.categories ? (
                                        <span
                                            className="rounded px-2 py-0.5 text-xs"
                                            style={{
                                                backgroundColor: `${t.categories.color ?? "#64748b"}26`,
                                                color: t.categories.color ?? "#94a3b8",
                                            }}
                                        >
                                            {t.categories.icon} {t.categories.name}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-600">uncategorized</span>
                                    )}
                                </td>
                                <td
                                    className={`whitespace-nowrap py-2 text-right font-medium ${
                                        t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                                    }`}
                                >
                                    {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                                    {fmtMoney(t.amount, t.currency)}
                                </td>
                            </tr>
                            {expandedId === t.id && (
                                <tr>
                                    <td colSpan={4} className="bg-slate-900/30 px-4 py-3">
                                        <TxDetail tx={t} />
                                    </td>
                                </tr>
                            )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function TxDetail({ tx }: { tx: TxRow }) {
    return (
        <div className="flex flex-col gap-2 text-xs">
            {tx.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {tx.tags.map((tag) => (
                        <span key={tag} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                            #{tag}
                        </span>
                    ))}
                </div>
            )}
            {tx.ingestion_id ? (
                <MediaPreview ingestionId={tx.ingestion_id} />
            ) : (
                <span className="text-slate-600">Manually entered — no source capture.</span>
            )}
        </div>
    );
}

function MediaPreview({ ingestionId }: { ingestionId: string }) {
    const media = useQuery({
        queryKey: ["ingestion-media", ingestionId],
        queryFn: async () => {
            const sb = requireSupabase();
            const { data, error } = await sb
                .from("media_ingestions")
                .select("storage_path, media_kind, mime_type")
                .eq("id", ingestionId)
                .single();
            if (error) throw new Error(error.message);
            if (!data.storage_path) return { ...data, url: null as string | null };
            const signed = await sb.storage
                .from("ingest")
                .createSignedUrl(data.storage_path, 3600);
            if (signed.error) throw new Error(signed.error.message);
            return { ...data, url: signed.data.signedUrl };
        },
        staleTime: 30 * 60_000,
    });

    if (media.isLoading) return <span className="text-slate-500">Loading source…</span>;
    if (media.isError) {
        return <span className="text-rose-400">{(media.error as Error).message}</span>;
    }

    const m = media.data!;
    if (!m.url) {
        return (
            <span className="text-slate-600">
                Captured as {m.media_kind} — no file archived (inline capture).
            </span>
        );
    }

    if (m.media_kind === "image") {
        return (
            <a href={m.url} target="_blank" rel="noreferrer">
                <img
                    src={m.url}
                    alt="Source receipt"
                    className="max-h-72 rounded-lg border border-slate-800"
                />
            </a>
        );
    }
    if (m.media_kind === "audio") {
        return <audio controls src={m.url} className="max-w-full" />;
    }
    return (
        <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
        >
            Open source file ({m.mime_type})
        </a>
    );
}
