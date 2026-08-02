/* Sage's answer, rendered.

   The server returns *blocks* — prose, stat tiles, a table — and a table block
   holds no rows: it names a query in `answer.queries` and this file renders that
   query's own data. So a list of transactions arrives as a real table, sortable
   and exportable like every other list in the app, and no figure on screen has
   ever passed back through the model as text.

   Answers that predate blocks (or that failed validation server-side) still
   render: `answer` plus `highlights` is the fallback, which is exactly what the
   card used to show. */

import { DataTable, type Column } from "../DataTable";
import { fmtDate, fmtMoney } from "../../lib/format";
import type {
    SageAnswer,
    SageBlock,
    SageBreakdownRow,
    SageHighlight,
    SageListRow,
    SageQueryResult,
} from "../../lib/sage";

/* --- Prose -----------------------------------------------------------------
   Sage writes a sentence or two, so the markdown that matters is inline: bold,
   italics, code, and the occasional bullet. That is a small enough surface to
   render directly rather than ship a parser to every visitor — and it keeps
   tables out of the prose path, which is the whole point of the block shape. */

/** Splits on the delimiters, keeping them, so the parts alternate text/markup. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function Inline({ text }: { text: string }) {
    return (
        <>
            {text.split(INLINE).map((part, i) => {
                if (part.startsWith("**") && part.endsWith("**")) {
                    return (
                        <strong key={i} className="font-semibold text-slate-100">
                            {part.slice(2, -2)}
                        </strong>
                    );
                }
                if (part.startsWith("`") && part.endsWith("`")) {
                    return (
                        <code key={i} className="rounded bg-slate-950 px-1 py-0.5 text-[0.85em]">
                            {part.slice(1, -1)}
                        </code>
                    );
                }
                if (
                    (part.startsWith("*") && part.endsWith("*")) ||
                    (part.startsWith("_") && part.endsWith("_"))
                ) {
                    return <em key={i}>{part.slice(1, -1)}</em>;
                }
                return <span key={i}>{part}</span>;
            })}
        </>
    );
}

function Prose({ text }: { text: string }) {
    // Consecutive "- " lines become one list; everything else is a paragraph.
    const chunks: Array<{ bullets: string[] } | { para: string }> = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        const last = chunks[chunks.length - 1];
        if (bullet) {
            if (last && "bullets" in last) last.bullets.push(bullet[1]);
            else chunks.push({ bullets: [bullet[1]] });
        } else {
            chunks.push({ para: trimmed });
        }
    }

    return (
        <div className="flex flex-col gap-2 text-[0.9375rem] leading-relaxed text-slate-200">
            {chunks.map((chunk, i) =>
                "bullets" in chunk ? (
                    <ul key={i} className="ml-4 flex list-disc flex-col gap-1 marker:text-slate-600">
                        {chunk.bullets.map((b, j) => (
                            <li key={j}>
                                <Inline text={b} />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p key={i} className="min-w-0">
                        <Inline text={chunk.para} />
                    </p>
                ),
            )}
        </div>
    );
}

/* --- Stat tiles ------------------------------------------------------------ */

function Stats({ items }: { items: SageHighlight[] }) {
    return (
        <div className="grid gap-2.5 sm:grid-cols-3">
            {items.slice(0, 3).map((h) => (
                <div key={h.label} className="rounded-xl bg-slate-950 px-4 py-3">
                    <div className="text-xs text-slate-500">{h.label}</div>
                    <div className="mt-1 text-lg font-extrabold tnum text-slate-100 [overflow-wrap:anywhere]">
                        {h.value}
                    </div>
                    {h.hint && <div className="mt-0.5 text-xs text-slate-500">{h.hint}</div>}
                </div>
            ))}
        </div>
    );
}

/* --- Tables ----------------------------------------------------------------
   Three row shapes come out of the query DSL, so there are three column sets.
   Which one applies is decided by the query's `select`, never by inspecting the
   model's output. */

/** Expense reads as money leaving; income as money arriving. Matches the ledger. */
function amountCell(kind: string, amount: number, currency: string) {
    return (
        <span
            className={`whitespace-nowrap font-bold tnum ${
                kind === "income" ? "text-emerald-400" : "text-slate-200"
            }`}
        >
            {kind === "expense" ? "−" : kind === "income" ? "+" : ""}
            {fmtMoney(amount, currency)}
        </span>
    );
}

const LIST_COLUMNS: Array<Column<SageListRow>> = [
    {
        id: "date",
        label: "Date",
        width: "9rem",
        mobile: "meta",
        sortValue: (r) => r.date,
        searchValue: (r) => fmtDate(r.date),
        cell: (r) => (
            <span className="whitespace-nowrap text-[0.78125rem] text-slate-500">
                {fmtDate(r.date)}
            </span>
        ),
    },
    {
        id: "description",
        label: "Description",
        hideable: false,
        mobile: "title",
        sortValue: (r) => r.description,
        cell: (r, { dense }) => (
            <div
                className={`min-w-0 break-words font-medium text-slate-200 ${
                    dense ? "line-clamp-1" : "line-clamp-2"
                }`}
            >
                {r.description || "—"}
            </div>
        ),
    },
    {
        id: "category",
        label: "Category",
        width: "11rem",
        mobile: "meta",
        sortValue: (r) => r.category ?? "",
        cell: (r) =>
            r.category ? (
                <span className="text-[0.8125rem] text-slate-300">{r.category}</span>
            ) : (
                <span className="text-[0.8125rem] text-slate-600">Uncategorised</span>
            ),
    },
    {
        id: "account",
        label: "Account",
        width: "11rem",
        mobile: "meta",
        defaultHidden: true,
        sortValue: (r) => r.account ?? "",
        cell: (r) => <span className="text-[0.8125rem] text-slate-400">{r.account ?? "—"}</span>,
    },
    {
        id: "amount",
        label: "Amount",
        align: "right",
        width: "10rem",
        hideable: false,
        mobile: "trailing",
        sortValue: (r) => (r.kind === "expense" ? -r.amount : r.amount),
        exportValue: (r) => (r.kind === "expense" ? -r.amount : r.amount),
        cell: (r) => amountCell(r.kind, r.amount, r.currency),
    },
];

/** One "₦1,200 + $30" string. Currencies are never summed together. */
function totalsText(totals: Record<string, number>): string {
    const entries = Object.entries(totals);
    if (!entries.length) return "—";
    return entries.map(([currency, amount]) => fmtMoney(amount, currency)).join(" + ");
}

const BREAKDOWN_COLUMNS: Array<Column<SageBreakdownRow>> = [
    {
        id: "group",
        label: "Group",
        hideable: false,
        mobile: "title",
        sortValue: (r) => r.group,
        cell: (r) => <span className="font-medium text-slate-200">{r.group}</span>,
    },
    {
        id: "count",
        label: "Entries",
        align: "right",
        width: "7rem",
        mobile: "meta",
        sortValue: (r) => r.count,
        cell: (r) => <span className="tnum text-slate-400">{r.count}</span>,
    },
    {
        id: "total",
        label: "Total",
        align: "right",
        width: "13rem",
        hideable: false,
        mobile: "trailing",
        sortValue: (r) => Object.values(r.totals).reduce((s, v) => s + v, 0),
        exportValue: (r) => totalsText(r.totals),
        cell: (r) => (
            <span className="whitespace-nowrap font-bold tnum text-slate-200">
                {totalsText(r.totals)}
            </span>
        ),
    },
];

interface BalanceRow {
    name: string;
    type: string;
    currency: string;
    current_balance: number;
}

const BALANCE_COLUMNS: Array<Column<BalanceRow>> = [
    {
        id: "name",
        label: "Account",
        hideable: false,
        mobile: "title",
        sortValue: (r) => r.name,
        cell: (r) => <span className="font-medium text-slate-200">{r.name}</span>,
    },
    {
        id: "type",
        label: "Type",
        width: "9rem",
        mobile: "meta",
        sortValue: (r) => r.type,
        cell: (r) => <span className="text-[0.8125rem] capitalize text-slate-400">{r.type}</span>,
    },
    {
        id: "balance",
        label: "Balance",
        align: "right",
        width: "12rem",
        hideable: false,
        mobile: "trailing",
        sortValue: (r) => Number(r.current_balance),
        cell: (r) => (
            <span className="whitespace-nowrap font-bold tnum text-slate-200">
                {fmtMoney(Number(r.current_balance), r.currency)}
            </span>
        ),
    },
];

/**
 * The rows of one query, drawn with the app's one table. Chrome scales with the
 * data: a handful of rows needs no search box and no pager, and getting those
 * out of the way is what keeps an answer feeling like an answer.
 */
function QueryTable({ result, title }: { result: SageQueryResult; title?: string }) {
    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) return null;

    const big = rows.length > 10;
    const shared = {
        searchable: big,
        paginated: rows.length > 25,
        defaultPageSize: 25,
        minWidth: "30rem",
        exportFilename: "sage-answer",
        rowNoun: result.select === "balances" ? "account" : "entry",
        footNote: result.truncated ? "Capped — there may be more." : undefined,
    };

    return (
        <div className="flex flex-col gap-2">
            {title && (
                <p className="text-[0.8125rem] font-medium text-slate-400 first-letter:capitalize">
                    {title}
                </p>
            )}
            <div className="rounded-xl bg-slate-950 p-3">
                {result.select === "breakdown" ? (
                    <DataTable
                        {...shared}
                        data={rows as SageBreakdownRow[]}
                        columns={BREAKDOWN_COLUMNS}
                        rowId={(r) => r.group}
                        searchPlaceholder="Search groups…"
                    />
                ) : result.select === "balances" ? (
                    <DataTable
                        {...shared}
                        data={rows as BalanceRow[]}
                        columns={BALANCE_COLUMNS}
                        rowId={(r) => r.name}
                        searchPlaceholder="Search accounts…"
                    />
                ) : (
                    <DataTable
                        {...shared}
                        data={rows as SageListRow[]}
                        columns={LIST_COLUMNS}
                        rowId={(r) => r.id}
                        searchPlaceholder="Search these transactions…"
                        initialSort={{ columnId: "date", direction: "desc" }}
                    />
                )}
            </div>
        </div>
    );
}

/* --- The block list -------------------------------------------------------- */

export function SageBlocks({ answer }: { answer: SageAnswer }) {
    const byId = new Map(answer.queries.map((q) => [q.id, q]));

    // Pre-blocks answers, and any whose blocks were all dropped as unusable.
    const blocks: SageBlock[] = answer.blocks?.length
        ? answer.blocks
        : [
              { type: "prose", text: answer.answer },
              ...(answer.highlights?.length
                  ? [{ type: "stats" as const, items: answer.highlights }]
                  : []),
          ];

    return (
        <div className="flex min-w-0 flex-col gap-4">
            {blocks.map((block, i) => {
                if (block.type === "prose") return <Prose key={i} text={block.text} />;
                if (block.type === "stats") return <Stats key={i} items={block.items} />;
                const result = byId.get(block.queryId);
                // The server drops tables that name a query it never ran; this
                // is the same guard for anything that slips past it.
                return result ? (
                    <QueryTable key={i} result={result} title={block.title} />
                ) : null;
            })}
        </div>
    );
}
