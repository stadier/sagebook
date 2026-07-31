import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { requireSupabase } from "../lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

interface IngestionRow {
    id: string;
    created_at: string;
    status: "pending" | "processing" | "parsed" | "failed" | "applied";
    media_kind: string;
    mime_type: string;
    bytes: number | null;
    model: string | null;
    prompt_hint: string | null;
    error: string | null;
    storage_path: string | null;
    parsed_payload: {
        summary?: string;
        confidence?: number;
        transcript?: string;
        transactions?: unknown[];
    } | null;
    transactions: Array<{ count: number }>;
}

interface LogRow {
    id: string;
    created_at: string;
    level: "info" | "warn" | "error";
    source: string;
    message: string;
    context: Record<string, unknown>;
}

type Entry =
    | { type: "ingestion"; at: string; ingestion: IngestionRow }
    | { type: "event"; at: string; log: LogRow };

function isFailure(e: Entry): boolean {
    if (e.type === "event") return e.log.level === "error";
    return e.ingestion.status === "failed" || !!e.ingestion.error;
}

interface ActivityData {
    entries: Entry[];
    /** Set when the app_logs table is missing (migration not yet applied). */
    logsUnavailable: string | null;
}

async function fetchEntries(): Promise<ActivityData> {
    const sb = requireSupabase();
    const [ing, logs] = await Promise.all([
        sb
            .from("media_ingestions")
            .select(
                "id, created_at, status, media_kind, mime_type, bytes, model, prompt_hint, error, storage_path, parsed_payload, transactions(count)",
            )
            .order("created_at", { ascending: false })
            .limit(100),
        sb.from("app_logs").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (ing.error) throw new Error(ing.error.message);

    const entries: Entry[] = [
        ...((ing.data ?? []) as unknown as IngestionRow[]).map(
            (i): Entry => ({ type: "ingestion", at: i.created_at, ingestion: i }),
        ),
        ...(logs.error
            ? []
            : ((logs.data ?? []) as LogRow[]).map(
                  (l): Entry => ({ type: "event", at: l.created_at, log: l }),
              )),
    ];
    return {
        entries: entries.sort((a, b) => (a.at < b.at ? 1 : -1)),
        logsUnavailable: logs.error ? logs.error.message : null,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report text (what "Copy report" puts on the clipboard)
// ─────────────────────────────────────────────────────────────────────────────

function buildReport(e: Entry): string {
    const lines: string[] = ["── Sagebook report ──"];
    if (e.type === "ingestion") {
        const i = e.ingestion;
        const found = i.parsed_payload?.transactions?.length ?? 0;
        const committed = i.transactions?.[0]?.count ?? 0;
        lines.push(
            `type: ingestion (${i.status})`,
            `id: ${i.id}`,
            `when: ${i.created_at}`,
            `media: ${i.media_kind} (${i.mime_type}${i.bytes ? `, ${i.bytes} bytes` : ""})`,
            `model: ${i.model ?? "—"}`,
            `hint: ${i.prompt_hint ?? "—"}`,
            `storage: ${i.storage_path ?? "—"}`,
            `result: found ${found} transaction(s), ${committed} in ledger/inbox`,
        );
        if (i.error) lines.push(`error: ${i.error}`);
        if (i.parsed_payload?.summary) lines.push(`summary: ${i.parsed_payload.summary}`);
        if (i.parsed_payload) {
            lines.push(`parsed_payload: ${JSON.stringify(i.parsed_payload, null, 2)}`);
        }
    } else {
        const l = e.log;
        lines.push(
            `type: client event (${l.level})`,
            `id: ${l.id}`,
            `when: ${l.created_at}`,
            `source: ${l.source}`,
            `message: ${l.message}`,
            `context: ${JSON.stringify(l.context, null, 2)}`,
        );
    }
    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type Filter = "all" | "failures" | "ingestions" | "events";

export default function Activity() {
    const qc = useQueryClient();
    const [filter, setFilter] = useState<Filter>("all");

    const entries = useQuery({ queryKey: ["activity"], queryFn: fetchEntries });

    const clearLogs = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const { data } = await sb.auth.getUser();
            if (!data.user) throw new Error("not signed in");
            const { error } = await sb.from("app_logs").delete().eq("user_id", data.user.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["activity"] }),
    });

    const all = entries.data?.entries ?? [];
    const rows = all.filter((e) => {
        if (filter === "failures") return isFailure(e);
        if (filter === "ingestions") return e.type === "ingestion";
        if (filter === "events") return e.type === "event";
        return true;
    });

    const failureCount = all.filter(isFailure).length;

    return (
        <>
            <PageHeader
                title="Activity"
                subtitle="Every capture, import, and error — expand an entry and Copy report to reference it when asking for a fix."
            >
                <button className="sb-btn sb-btn-ghost" onClick={() => entries.refetch()}>
                    ↻ Refresh
                </button>
            </PageHeader>

            <div className="flex flex-wrap items-center gap-2 text-sm">
                {(
                    [
                        ["all", "All"],
                        ["failures", `Failures (${failureCount})`],
                        ["ingestions", "Captures & imports"],
                        ["events", "Client events"],
                    ] as Array<[Filter, string]>
                ).map(([value, label]) => (
                    <button
                        key={value}
                        onClick={() => setFilter(value)}
                        className={`rounded-full px-3.5 py-[0.4375rem] text-[0.78125rem] transition-colors ${
                            filter === value
                                ? "bg-slate-200 font-bold text-slate-900"
                                : "border border-slate-700 font-semibold text-slate-300 hover:border-slate-600"
                        }`}
                    >
                        {label}
                    </button>
                ))}
                <button
                    className="ml-auto text-xs text-slate-600 hover:text-rose-300"
                    disabled={clearLogs.isPending}
                    onClick={() => clearLogs.mutate()}
                    title="Deletes client events only; capture/import history stays"
                >
                    Clear client events
                </button>
            </div>

            {entries.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {entries.isError && (
                <p className="text-sm text-rose-400">{(entries.error as Error).message}</p>
            )}
            {entries.data?.logsUnavailable && (
                <p className="mb-3 text-xs text-amber-400">
                    Client-event log unavailable ({entries.data.logsUnavailable}) — apply the
                    latest database migrations to enable it. Captures and imports still show.
                </p>
            )}
            {entries.isSuccess && rows.length === 0 && (
                <p className="text-sm text-slate-500">Nothing here yet.</p>
            )}

            <div className="flex flex-col gap-2">
                {rows.map((e) => (
                    <EntryCard key={`${e.type}-${e.type === "ingestion" ? e.ingestion.id : e.log.id}`} entry={e} />
                ))}
            </div>
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry card
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
    parsed: "bg-tint-green text-emerald-400",
    applied: "bg-tint-green text-emerald-400",
    failed: "bg-tint-coral text-rose-400",
    pending: "bg-chip text-slate-400",
    processing: "bg-chip text-slate-400",
    info: "bg-chip text-slate-400",
    warn: "bg-tint-amber text-amber-400",
    error: "bg-tint-coral text-rose-400",
};

function EntryCard({ entry }: { entry: Entry }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const badge = entry.type === "ingestion" ? entry.ingestion.status : entry.log.level;
    const failed = isFailure(entry);

    let title: string;
    let subtitle: string;
    if (entry.type === "ingestion") {
        const i = entry.ingestion;
        const found = i.parsed_payload?.transactions?.length ?? 0;
        const committed = i.transactions?.[0]?.count ?? 0;
        title = i.parsed_payload?.summary || `${i.media_kind} capture (${i.mime_type})`;
        subtitle = `${found} found · ${committed} saved${i.model ? ` · ${i.model}` : ""}`;
    } else {
        title = entry.log.message;
        subtitle = entry.log.source;
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(buildReport(entry));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable */
        }
    }

    return (
        <div
            className={`sb-card p-3.5 ${failed ? "ring-1 ring-rose-400/40" : ""}`}
        >
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(!open)}>
                <span className={`sb-pill shrink-0 ${STATUS_TONE[badge] ?? STATUS_TONE.info}`}>
                    {badge}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-200">{title}</span>
                    <span className="block text-xs text-slate-500">
                        {fmtDateTime(entry.at)} · {subtitle}
                    </span>
                </span>
                <span className="text-xs text-slate-600">{open ? "▲" : "▼"}</span>
            </button>

            {open && (
                <div className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3 text-xs">
                    {entry.type === "ingestion" && entry.ingestion.error && (
                        <p className="text-rose-300">{entry.ingestion.error}</p>
                    )}
                    {entry.type === "ingestion" && entry.ingestion.parsed_payload?.transcript && (
                        <blockquote className="rounded-lg border-l-2 border-slate-700 bg-slate-950/60 px-3 py-2 italic text-slate-400">
                            “{entry.ingestion.parsed_payload.transcript}”
                        </blockquote>
                    )}
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950/80 p-3 text-slate-400">
                        {entry.type === "ingestion"
                            ? JSON.stringify(
                                  {
                                      id: entry.ingestion.id,
                                      media: entry.ingestion.mime_type,
                                      bytes: entry.ingestion.bytes,
                                      hint: entry.ingestion.prompt_hint,
                                      storage_path: entry.ingestion.storage_path,
                                      parsed_payload: entry.ingestion.parsed_payload,
                                  },
                                  null,
                                  2,
                              )
                            : JSON.stringify(entry.log.context, null, 2)}
                    </pre>
                    <div>
                        <button
                            onClick={copy}
                            className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                        >
                            {copied ? "Copied ✓" : "Copy report"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
