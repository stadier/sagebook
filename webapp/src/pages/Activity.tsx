import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import DataTable, { type Column } from "../components/DataTable";
import { Field, PageHeader, Picker, QueryError } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { pairOptions } from "../lib/options";
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

    // The failures row carries its own count, so the filter says how much there
    // is to look at before you pick it.
    const filterOptions = useMemo(
        () =>
            pairOptions<Filter>([
                { value: "all", label: "Everything" },
                { value: "failures", label: `Failures (${failureCount})` },
                { value: "ingestions", label: "Captures & imports" },
                { value: "events", label: "Client events" },
            ]),
        [failureCount],
    );

    const columns: Array<Column<Entry>> = [
        {
            id: "status",
            label: "Status",
            width: "8rem",
            mobile: "trailing",
            sortValue: (e) => badgeOf(e),
            cell: (e) => (
                <span className={`sb-pill ${STATUS_TONE[badgeOf(e)] ?? STATUS_TONE.info}`}>
                    {badgeOf(e)}
                </span>
            ),
        },
        {
            id: "at",
            label: "When",
            width: "12rem",
            sortValue: (e) => e.at,
            searchValue: (e) => fmtDateTime(e.at),
            cell: (e) => (
                <span className="whitespace-nowrap text-[0.78125rem] text-slate-500">
                    {fmtDateTime(e.at)}
                </span>
            ),
        },
        {
            id: "what",
            label: "What happened",
            hideable: false,
            mobile: "title",
            sortValue: (e) => describe(e).title,
            searchValue: (e) => `${describe(e).title} ${describe(e).subtitle}`,
            cell: (e) => {
                const { title, subtitle } = describe(e);
                return (
                    <div className="min-w-0">
                        <div className="truncate text-slate-200">{title}</div>
                        <div className="truncate text-xs text-slate-500">{subtitle}</div>
                    </div>
                );
            },
        },
        {
            id: "source",
            label: "Source",
            width: "9rem",
            defaultHidden: true,
            sortValue: (e) => (e.type === "ingestion" ? e.ingestion.media_kind : e.log.source),
            cell: (e) => (
                <span className="text-[0.8125rem] text-slate-400">
                    {e.type === "ingestion" ? e.ingestion.media_kind : e.log.source}
                </span>
            ),
        },
    ];

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

            <QueryError error={entries.error} />
            {entries.data?.logsUnavailable && (
                <p className="text-xs text-amber-400">
                    Client-event log unavailable ({entries.data.logsUnavailable}) — apply the
                    latest database migrations to enable it. Captures and imports still show.
                </p>
            )}

            <DataTable
                storageKey="activity"
                data={rows}
                columns={columns}
                rowId={(e) => `${e.type}-${e.type === "ingestion" ? e.ingestion.id : e.log.id}`}
                loading={entries.isLoading}
                rowNoun="entry"
                searchPlaceholder="Search messages, sources…"
                initialSort={{ columnId: "at", direction: "desc" }}
                activeFilterCount={filter === "all" ? 0 : 1}
                onClearFilters={() => setFilter("all")}
                filters={
                    <Field label="Show">
                        <Picker
                            options={filterOptions}
                            value={filter}
                            onChange={setFilter}
                            title="Show"
                        />
                    </Field>
                }
                toolbarActions={
                    <button
                        className="sb-tbtn"
                        disabled={clearLogs.isPending}
                        onClick={() => clearLogs.mutate()}
                        title="Deletes client events only; capture/import history stays"
                    >
                        Clear client events
                    </button>
                }
                rowClassName={(e) => (isFailure(e) ? "is-danger" : "")}
                renderExpanded={(e) => <EntryDetail entry={e} />}
                emptyTitle="Nothing here yet"
                emptyBody="Captures, imports and client-side errors all land in this log."
                footNote="Click an entry for its raw payload."
            />
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

/** The status word an entry is badged with. */
function badgeOf(entry: Entry): string {
    return entry.type === "ingestion" ? entry.ingestion.status : entry.log.level;
}

/** The row's headline and its supporting line. */
function describe(entry: Entry): { title: string; subtitle: string } {
    if (entry.type === "ingestion") {
        const i = entry.ingestion;
        const found = i.parsed_payload?.transactions?.length ?? 0;
        const committed = i.transactions?.[0]?.count ?? 0;
        return {
            title: i.parsed_payload?.summary || `${i.media_kind} capture (${i.mime_type})`,
            subtitle: `${found} found · ${committed} saved${i.model ? ` · ${i.model}` : ""}`,
        };
    }
    return { title: entry.log.message, subtitle: entry.log.source };
}

function EntryDetail({ entry }: { entry: Entry }) {
    const [copied, setCopied] = useState(false);

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
        <div className="flex flex-col gap-2 text-xs">
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
                <button className="sb-tbtn" onClick={copy}>
                    {copied ? "Copied ✓" : "Copy report"}
                </button>
            </div>
        </div>
    );
}
