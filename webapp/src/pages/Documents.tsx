/* The documents library — every file uploaded into Sagebook (receipts,
   statement PDFs, voice notes, imports) with its extraction status, size and
   a live preview. Rows come from `media_ingestions`, the same table that
   powers the Activity feed; this view treats it as a file archive rather than
   an audit log: thumbnails, sizes, and an "open the original" verb.

   Previews are fetched lazily — the list only ever shows cheap metadata, and
   a signed URL is requested when a row is expanded. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import DataTable, { type Column } from "../components/DataTable";
import { DownloadIcon } from "../components/icons";
import {
	Field,
	PageHeader,
	Picker,
	QueryError,
	StatCard,
} from "../components/ui";
import { fmtBytes, fmtDateTime } from "../lib/format";
import { pairOptions } from "../lib/options";
import { QK, useDocuments, type DocumentRow } from "../lib/queries";
import { downloadFromIngest, signedUrlFor } from "../lib/storage";
import { invokeFn } from "../lib/supabase";

type StatusFilter =
	| "all"
	| "pending"
	| "processing"
	| "parsed"
	| "failed"
	| "applied";
type KindFilter = "all" | "image" | "audio" | "video" | "pdf" | "text";

const STATUSES: StatusFilter[] = [
	"pending",
	"processing",
	"parsed",
	"failed",
	"applied",
];
const KINDS: KindFilter[] = ["image", "audio", "video", "pdf", "text"];

/** Badge colours mirror the Activity feed — green once it went through,
 *  coral when it didn't, neutral while it's in flight. */
const STATUS_TONE: Record<string, string> = {
	parsed: "bg-tint-green text-emerald-400",
	applied: "bg-tint-green text-emerald-400",
	failed: "bg-tint-coral text-rose-400",
	pending: "bg-chip text-slate-400",
	processing: "bg-chip text-slate-400",
};

/** The readable file name — the storage path's last segment with the
 *  UUID prefix the uploader adds ("<uid>/<uuid>-receipt.jpg" → "receipt.jpg"). */
function fileNameOf(doc: DocumentRow): string {
	if (!doc.storage_path) return "inline capture";
	const path = doc.storage_path.startsWith("b2:")
		? doc.storage_path.slice(3)
		: doc.storage_path;
	const base = path.split("/").pop() ?? path;
	return base.replace(/^[0-9a-f-]{36}-/, "") || base;
}

/** How many ledger/inbox entries a capture produced. */
function producedCount(doc: DocumentRow): number {
	return doc.transactions?.[0]?.count ?? 0;
}

/* --- Kind glyphs -----------------------------------------------------------
   A small tinted tile per media kind, drawn in the app's line language. */

function KindGlyph({ kind }: { kind: string }) {
	const stroke = {
		stroke: "currentColor",
		strokeWidth: 1.9,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
		fill: "none",
	};
	const glyph: Record<string, ReactNode> = {
		image: (
			<svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
				<rect x="3" y="5" width="18" height="14" rx="2.5" />
				<circle cx="9" cy="10" r="1.6" />
				<path d="m5 17 5-4.5 3.5 3L17 12l3 3" />
			</svg>
		),
		audio: (
			<svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
				<path d="M9 18V6l10-2v12" />
				<circle cx="6.5" cy="18" r="2.5" />
				<circle cx="16.5" cy="16" r="2.5" />
			</svg>
		),
		video: (
			<svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
				<rect x="3" y="6" width="13" height="12" rx="2.5" />
				<path d="m16 10 5-2.5v9L16 14" />
			</svg>
		),
		pdf: (
			<svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
				<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
				<path d="M14 3v4h4M9 12h6M9 16h6" />
			</svg>
		),
	};
	const cls =
		kind === "image"
			? "bg-tint-green text-emerald-400"
			: kind === "audio"
				? "bg-tint-amber text-amber-400"
				: kind === "video"
					? "bg-tint-coral text-rose-400"
					: kind === "pdf"
						? "bg-tint-blue text-sky-400"
						: "bg-chip text-slate-400";
	return (
		<span
			className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${cls}`}
			aria-hidden
		>
			{glyph[kind] ?? (
				<svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
					<path d="M4 6h16M4 12h16M4 18h10" />
				</svg>
			)}
		</span>
	);
}

/* --- Page ------------------------------------------------------------------ */

export default function Documents() {
	const qc = useQueryClient();
	const [status, setStatus] = useState<StatusFilter>("all");
	const [kind, setKind] = useState<KindFilter>("all");
	/* Which file is being fetched, and anything the archive said about why it
	   couldn't be. A download is the one verb here with no visible result on
	   the page, so both are surfaced rather than left to the console. */
	const [saving, setSaving] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<Error | null>(null);

	const docs = useDocuments();

	const retry = useMutation({
		mutationFn: (doc: DocumentRow) =>
			invokeFn("process-media", { storagePath: doc.storage_path }),
		onSuccess: () => {
			// A retry is a fresh ingestion — the new row appears here and in
			// the Activity feed once it lands.
			qc.invalidateQueries({ queryKey: QK.documents });
			qc.invalidateQueries({ queryKey: ["activity"] });
		},
	});

	/** Pull the original off the archive and hand it to the browser to save. */
	function saveOriginal(doc: DocumentRow) {
		if (!doc.storage_path) return;
		setSaving(doc.id);
		setSaveError(null);
		void downloadFromIngest(doc.storage_path, fileNameOf(doc))
			.catch((err) => setSaveError(err as Error))
			.finally(() => setSaving(null));
	}

	const all = docs.data ?? [];
	const rows = all.filter(
		(d) =>
			(status === "all" || d.status === status) &&
			(kind === "all" || d.media_kind === kind),
	);

	const totalBytes = all.reduce((sum, d) => sum + (d.bytes ?? 0), 0);
	const failed = all.filter((d) => d.status === "failed").length;
	const pending = all.filter(
		(d) => d.status === "pending" || d.status === "processing",
	).length;

	const statusOptions = useMemo(() => {
		const counts = new Map<string, number>();
		for (const d of all) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
		return pairOptions<StatusFilter>([
			{ value: "all", label: "All statuses" },
			...STATUSES.map((s) => ({
				value: s,
				label: s === "all" ? s : `${s} (${counts.get(s) ?? 0})`,
			})),
		]);
	}, [all]);

	const kindOptions = useMemo(() => {
		const counts = new Map<string, number>();
		for (const d of all)
			counts.set(d.media_kind, (counts.get(d.media_kind) ?? 0) + 1);
		return pairOptions<KindFilter>([
			{ value: "all", label: "All kinds" },
			...KINDS.map((k) => ({
				value: k,
				label: `${k} (${counts.get(k) ?? 0})`,
			})),
		]);
	}, [all]);

	const columns: Array<Column<DocumentRow>> = [
		{
			id: "file",
			label: "Document",
			hideable: false,
			mobile: "title",
			sortValue: (d) => fileNameOf(d).toLowerCase(),
			searchValue: (d) =>
				[
					fileNameOf(d),
					d.media_kind,
					d.mime_type,
					d.parsed_payload?.summary ?? "",
				]
					.filter(Boolean)
					.join(" "),
			cell: (d) => (
				<div className="flex min-w-0 items-center gap-2.5">
					<KindGlyph kind={d.media_kind} />
					<div className="min-w-0">
						{/* An uploader's file name is one unbroken token — bank
						    exports run to sixty characters with never a space.
						    `break-words` alone lets it wrap but does not shrink
						    the column's min-content width, so the table stays
						    wide and scrolls sideways instead; `anywhere` does
						    both. */}
						<div className="font-medium text-slate-200 [overflow-wrap:anywhere]">
							{fileNameOf(d)}
						</div>
						<div className="text-[0.6875rem] text-slate-500">
							{d.media_kind}
							{d.mime_type ? ` · ${d.mime_type}` : ""}
						</div>
					</div>
				</div>
			),
		},
		{
			id: "status",
			label: "Status",
			width: "8.5rem",
			mobile: "trailing",
			sortValue: (d) => d.status,
			cell: (d) => (
				<span
					className={`sb-pill ${STATUS_TONE[d.status] ?? "bg-chip text-slate-400"}`}
				>
					{d.status}
				</span>
			),
		},
		{
			id: "size",
			label: "Size",
			width: "6rem",
			sortValue: (d) => d.bytes ?? 0,
			exportValue: (d) => d.bytes ?? "",
			cell: (d) => (
				<span className="whitespace-nowrap text-[0.8125rem] text-slate-400">
					{fmtBytes(d.bytes)}
				</span>
			),
		},
		{
			id: "produced",
			label: "What it produced",
			sortValue: (d) => producedCount(d),
			cell: (d) => {
				const count = producedCount(d);
				if (d.status === "failed") {
					return (
						<span className="text-xs text-slate-500">
							{d.error ? "extraction failed" : "no entries"}
						</span>
					);
				}
				if (count === 0) {
					return <span className="text-xs text-slate-600">—</span>;
				}
				return (
					<div className="min-w-0">
						<div className="text-[0.8125rem] font-medium text-slate-300">
							{count} {count === 1 ? "entry" : "entries"}
						</div>
						{d.parsed_payload?.summary && (
							<div className="line-clamp-1 break-words text-[0.6875rem] text-slate-500">
								{d.parsed_payload.summary}
							</div>
						)}
					</div>
				);
			},
		},
		{
			id: "added",
			label: "Uploaded",
			width: "12rem",
			sortValue: (d) => d.created_at,
			searchValue: (d) => fmtDateTime(d.created_at),
			cell: (d) => (
				<span className="whitespace-nowrap text-[0.78125rem] text-slate-500">
					{fmtDateTime(d.created_at)}
				</span>
			),
		},
		{
			id: "model",
			label: "Model",
			defaultHidden: true,
			width: "10rem",
			sortValue: (d) => d.model ?? "",
			cell: (d) => (
				<span className="text-xs text-slate-500">{d.model ?? "—"}</span>
			),
		},
	];

	return (
		<>
			<PageHeader
				title="Documents"
				subtitle="Every receipt, statement, and capture you've uploaded — expand a row for the original file."
			>
				<button className="sb-btn sb-btn-ghost" onClick={() => docs.refetch()}>
					↻ Refresh
				</button>
			</PageHeader>

			<QueryError error={docs.error} />
			<QueryError error={retry.error} />
			<QueryError error={saveError} />

			<div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Documents"
					value={all.length}
					hint="uploaded to your archive"
				/>
				<StatCard
					label="Storage used"
					value={fmtBytes(totalBytes)}
					hint="across captures and imports"
				/>
				<StatCard
					label="In flight"
					value={pending}
					tone={pending > 0 ? "default" : "positive"}
					hint={pending === 1 ? "still processing" : "waiting or extracting"}
				/>
				<StatCard
					label="Failed"
					value={failed}
					tone={failed > 0 ? "negative" : "positive"}
					hint={failed === 1 ? "needs a retry" : "couldn't be read"}
				/>
			</div>

			<DataTable
				storageKey="documents"
				data={rows}
				columns={columns}
				rowId={(d) => d.id}
				loading={docs.isLoading}
				rowNoun="document"
				searchPlaceholder="Search file name, kind, summary…"
				initialSort={{ columnId: "added", direction: "desc" }}
				activeFilterCount={
					(status !== "all" ? 1 : 0) + (kind !== "all" ? 1 : 0)
				}
				onClearFilters={() => {
					setStatus("all");
					setKind("all");
				}}
				filters={
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Status">
							<Picker
								options={statusOptions}
								value={status}
								onChange={setStatus}
								title="Status"
							/>
						</Field>
						<Field label="Kind">
							<Picker
								options={kindOptions}
								value={kind}
								onChange={setKind}
								title="Kind"
							/>
						</Field>
					</div>
				}
				rowActions={(d) => [
					{
						label: "Open original file",
						hint: d.storage_path ? "signed link, one hour" : undefined,
						disabled: !d.storage_path,
						hidden: !d.storage_path,
						onSelect: () => void openOriginal(d),
					},
					{
						label: saving === d.id ? "Downloading…" : "Download file",
						hint: d.bytes ? fmtBytes(d.bytes) : undefined,
						hidden: !d.storage_path,
						disabled: saving === d.id,
						onSelect: () => saveOriginal(d),
					},
					{
						label: "Retry extraction",
						hint: "runs process-media again",
						hidden: d.status !== "failed" || !d.storage_path,
						disabled: retry.isPending,
						onSelect: () => retry.mutate(d),
					},
				]}
				rowClassName={(d) => (d.status === "failed" ? "is-danger" : "")}
				renderExpanded={(d) => (
					<DocumentDetail
						doc={d}
						retrying={retry.isPending}
						onRetry={() => retry.mutate(d)}
						saving={saving === d.id}
						onDownload={() => saveOriginal(d)}
					/>
				)}
				emptyTitle="No documents yet"
				emptyBody="Snap a receipt, drop a statement PDF, or capture a voice note — the files you upload land here."
				footNote="Click a row to preview the original capture, transcript, and what it produced."
			/>
		</>
	);
}

/** A signed link is short-lived and generated on demand — nothing is ever
 *  stored in the page, so the archive stays list-cheap. */
function openOriginal(doc: DocumentRow) {
	if (!doc.storage_path) return;
	void signedUrlFor(doc.storage_path)
		.then((url) => window.open(url, "_blank", "noopener"))
		.catch((err) => console.warn("[documents] could not open file:", err));
}

/* --- Expanded detail -------------------------------------------------------- */

function DocumentDetail({
	doc,
	retrying,
	onRetry,
	saving,
	onDownload,
}: {
	doc: DocumentRow;
	retrying: boolean;
	onRetry: () => void;
	saving: boolean;
	onDownload: () => void;
}) {
	const media = useQuery({
		queryKey: ["document-url", doc.id],
		queryFn: () => signedUrlFor(doc.storage_path!),
		enabled: !!doc.storage_path,
		staleTime: 30 * 60_000,
	});

	const transcript = doc.parsed_payload?.transcript ?? null;
	const url = media.data;

	return (
		<div className="flex flex-col gap-2 text-xs">
			{doc.status === "failed" && doc.error && (
				<p className="rounded-lg bg-rose-950/40 px-3 py-2 text-rose-300">
					{doc.error}
				</p>
			)}

			{transcript && (
				<blockquote className="rounded-lg border-l-2 border-slate-700 bg-slate-950/60 px-3 py-2 italic text-slate-400">
					“{transcript}”
				</blockquote>
			)}

			{doc.status === "failed" && doc.storage_path && (
				<button
					className="sb-tbtn self-start !border-emerald-900/60 !text-emerald-400"
					disabled={retrying}
					onClick={onRetry}
				>
					{retrying ? "Retrying…" : "↻ Retry extraction"}
				</button>
			)}

			{media.isLoading && doc.storage_path && (
				<span className="text-slate-500">Loading original…</span>
			)}
			{media.isError && doc.storage_path && (
				<span className="text-rose-400">{(media.error as Error).message}</span>
			)}

			{url && doc.storage_path && <Media url={url} doc={doc} />}

			{doc.storage_path && (
				<button
					className="sb-tbtn self-start"
					disabled={saving}
					onClick={onDownload}
				>
					<DownloadIcon size={14} />
					{saving ? "Downloading…" : `Download ${fmtBytes(doc.bytes)}`}
				</button>
			)}

			<dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr]">
				{doc.prompt_hint && (
					<>
						<dt className="text-slate-500">Hint</dt>
						<dd className="text-slate-300">{doc.prompt_hint}</dd>
					</>
				)}
				{doc.model && (
					<>
						<dt className="text-slate-500">Model</dt>
						<dd className="text-slate-300">{doc.model}</dd>
					</>
				)}
				<dt className="text-slate-500">Storage path</dt>
				<dd className="break-all font-mono text-[0.6875rem] text-slate-500">
					{doc.storage_path ?? "inline capture — no file archived"}
				</dd>
				<dt className="text-slate-500">Updated</dt>
				<dd className="text-slate-300">{fmtDateTime(doc.updated_at)}</dd>
			</dl>
		</div>
	);
}

/** Renders the capture itself once a signed URL is in hand — image inline,
 *  audio as a player, everything else as an open-in-new-tab link. */
function Media({ url, doc }: { url: string; doc: DocumentRow }) {
	if (doc.media_kind === "audio") {
		return <audio controls src={url} className="max-w-full" />;
	}
	if (doc.media_kind === "image") {
		return (
			<a href={url} target="_blank" rel="noreferrer" className="self-start">
				<img
					src={url}
					alt={fileNameOf(doc)}
					className="max-h-72 rounded-lg border border-slate-800"
				/>
			</a>
		);
	}
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className="self-start rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
		>
			Open original file ({doc.mime_type || "file"})
		</a>
	);
}
