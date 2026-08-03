import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Picker, QueryError } from "../components/ui";
import { PENDING_REVIEW_LIMIT, STORAGE_KEYS } from "../lib/constants";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { logEvent } from "../lib/logger";
import { accountOptions } from "../lib/options";
import {
	QK,
	useAccounts,
	useCategoryOptions,
	usePendingReview,
	useTaxonomy,
} from "../lib/queries";
import {
	advanceBulkReview,
	failBulkReview,
	finishBulkReview,
	startBulkReview,
} from "../lib/bulkReviewJob";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type {
	Account,
	ParsedTransaction,
	PendingTransaction,
} from "../lib/types";

type ReviewAction = "accept" | "reject" | "edit" | "merge" | "unlink";

const LAST_ACCOUNT_KEY = STORAGE_KEYS.lastAccount;
const BULK_REVIEW_CHUNK_SIZE = 100;

export default function Inbox() {
	const qc = useQueryClient();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [focusedIdx, setFocusedIdx] = useState(0);
	const [editingId, setEditingId] = useState<string | null>(null);

	const pending = usePendingReview();
	const accounts = useAccounts();
	const activeAccounts = (accounts.data ?? []).filter((a) => !a.is_archived);

	function invalidate() {
		qc.invalidateQueries({ queryKey: QK.pendingReview });
		qc.invalidateQueries({ queryKey: ["transactions"] });
	}

	const review = useMutation({
		mutationFn: (args: {
			id: string;
			action: ReviewAction;
			patch?: Record<string, unknown>;
		}) =>
			invokeFn("review-transaction", {
				transactionId: args.id,
				action: args.action,
				patch: args.patch,
			}),
		onSuccess: invalidate,
		onError: (error, args) => {
			logEvent(
				"error",
				"inbox",
				`Review ${args.action} failed: ${(error as Error).message}`,
				{
					transactionId: args.id,
					patch: args.patch ?? null,
				},
			);
		},
	});

	const bulk = useMutation({
		mutationFn: async (args: {
			ids: string[];
			action: "accept" | "reject";
		}) => {
			startBulkReview({ total: args.ids.length, action: args.action });
			let updated = 0;
			for (let i = 0; i < args.ids.length; i += BULK_REVIEW_CHUNK_SIZE) {
				const chunk = args.ids.slice(i, i + BULK_REVIEW_CHUNK_SIZE);
				const result = await invokeFn<{ updated: number }>(
					"review-transaction/bulk",
					{
						transactionIds: chunk,
						action: args.action,
					},
				);
				// Advance by what the server actually confirmed, not by the
				// chunk size — the bar should never outrun the database.
				updated += result.updated ?? chunk.length;
				advanceBulkReview(updated);
			}
			finishBulkReview(updated);
			return { updated };
		},
		onSuccess: () => {
			setSelected(new Set());
			invalidate();
		},
		onError: (error, args) => {
			failBulkReview((error as Error).message);
			logEvent(
				"error",
				"inbox",
				`Bulk ${args.action} failed: ${(error as Error).message}`,
				{
					count: args.ids.length,
				},
			);
		},
	});

	const rows = pending.data ?? [];
	const busy = review.isPending || bulk.isPending;

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// Keyboard review: J/K navigate, A accept, R reject, E edit, X select.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			if (
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				target?.closest("input, select, textarea, [contenteditable]")
			) {
				return;
			}
			const tx = rows[focusedIdx];
			switch (e.key.toLowerCase()) {
				case "j":
					setFocusedIdx((i) => Math.min(i + 1, rows.length - 1));
					break;
				case "k":
					setFocusedIdx((i) => Math.max(i - 1, 0));
					break;
				case "a": {
					if (!tx || busy) return;
					// Mirror the card's default: accept into the last-used account.
					const accountId =
						tx.account_id ?? localStorage.getItem(LAST_ACCOUNT_KEY);
					if (accountId) {
						review.mutate({
							id: tx.id,
							action: "edit",
							patch: { account_id: accountId },
						});
					} else {
						review.mutate({ id: tx.id, action: "accept" });
					}
					break;
				}
				case "r":
					if (tx && !busy) review.mutate({ id: tx.id, action: "reject" });
					break;
				case "e":
					if (tx) setEditingId((id) => (id === tx.id ? null : tx.id));
					break;
				case "x":
					if (tx) toggle(tx.id);
					break;
				default:
					return;
			}
			e.preventDefault();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rows, focusedIdx, busy]);

	// Keep the focus index valid as cards leave the list.
	useEffect(() => {
		setFocusedIdx((i) => Math.min(i, Math.max(rows.length - 1, 0)));
	}, [rows.length]);

	if (pending.isLoading)
		return <p className="text-sm text-slate-400">Loading inbox…</p>;
	if (pending.isError) return <QueryError error={pending.error} />;

	return (
		<>
			<PageHeader
				title="Inbox"
				subtitle={
					rows.length === 0
						? "Nothing waiting for review."
						: `${rows.length} transaction${rows.length === 1 ? "" : "s"} awaiting review.`
				}
			>
				{rows.length > 0 && (
					<span className="text-xs text-slate-500">
						<kbd>J</kbd>/<kbd>K</kbd> navigate · <kbd>A</kbd> accept ·{" "}
						<kbd>R</kbd> reject · <kbd>E</kbd> edit · <kbd>X</kbd> select
					</span>
				)}
			</PageHeader>

			{rows.length > 0 && (
				<div className="sb-card flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:gap-3">
					<label className="flex items-center gap-2 text-slate-400">
						<input
							type="checkbox"
							checked={selected.size === rows.length}
							onChange={(e) =>
								setSelected(
									e.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
								)
							}
						/>
						{selected.size > 0 ? `${selected.size} selected` : "Select all"}
					</label>
					{selected.size > 0 && (
						<>
							<button
								className={acceptCls}
								disabled={busy}
								onClick={() =>
									bulk.mutate({ ids: [...selected], action: "accept" })
								}
							>
								Accept selected
							</button>
							<button
								className={rejectCls}
								disabled={busy}
								onClick={() =>
									bulk.mutate({ ids: [...selected], action: "reject" })
								}
							>
								Reject selected
							</button>
							<span className="hidden text-xs text-slate-500 sm:inline">
								Bulk accept keeps each item's current account/category.
							</span>
						</>
					)}
					{rows.length >= PENDING_REVIEW_LIMIT && (
						<p className="w-full text-xs text-amber-400/90">
							Showing the newest {PENDING_REVIEW_LIMIT.toLocaleString()} pending
							rows; the inbox may hold more. Accept these, then the rest will
							load for another pass.
						</p>
					)}
				</div>
			)}

			{(review.isError || bulk.isError) && (
				<p className="text-sm text-rose-400">
					{((review.error ?? bulk.error) as Error).message}
				</p>
			)}

			<div className="flex flex-col gap-3">
				{rows.map((tx, i) => (
					<InboxCard
						key={tx.id}
						tx={tx}
						busy={busy}
						accounts={activeAccounts}
						checked={selected.has(tx.id)}
						focused={i === focusedIdx}
						editing={editingId === tx.id}
						onFocus={() => setFocusedIdx(i)}
						onEditToggle={(open) => setEditingId(open ? tx.id : null)}
						onToggle={() => toggle(tx.id)}
						onAction={(action, patch) =>
							review.mutate({ id: tx.id, action, patch })
						}
					/>
				))}
			</div>
		</>
	);
}

function InboxCard({
	tx,
	busy,
	accounts,
	checked,
	focused,
	editing,
	onFocus,
	onEditToggle,
	onToggle,
	onAction,
}: {
	tx: PendingTransaction;
	busy: boolean;
	accounts: Account[];
	checked: boolean;
	focused: boolean;
	editing: boolean;
	onFocus: () => void;
	onEditToggle: (open: boolean) => void;
	onToggle: () => void;
	onAction: (action: ReviewAction, patch?: Record<string, unknown>) => void;
}) {
	const navigate = useNavigate();
	const cardRef = useRef<HTMLDivElement>(null);
	const [accountId, setAccountId] = useState(
		() => tx.account_id ?? localStorage.getItem(LAST_ACCOUNT_KEY) ?? "",
	);
	const accountOpts = useMemo(
		() => accountOptions(accounts, { showCurrency: true }),
		[accounts],
	);

	useEffect(() => {
		if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
	}, [focused]);

	function accept() {
		if (accountId) {
			localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
			// "edit" applies the patch and accepts in one call.
			onAction("edit", { account_id: accountId });
		} else {
			onAction("accept");
		}
	}

	function createRule() {
		const params = new URLSearchParams();
		if (tx.payee) params.set("payee", tx.payee);
		// The id, not the name — rules reference the category by key.
		if (tx.category_id) params.set("category", tx.category_id);
		navigate(`/settings/rules?${params.toString()}`);
	}

	return (
		<div
			ref={cardRef}
			onClick={onFocus}
			className={`sb-card p-4 ${focused ? "ring-2 ring-coral/50" : ""}`}
		>
			<div className="flex items-start gap-3">
				<input
					type="checkbox"
					className="mt-1"
					checked={checked}
					onChange={onToggle}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-medium text-slate-100">
							{tx.summary ?? tx.payee ?? "(no payee)"}
						</span>
						{tx.summary && tx.payee && (
							<span className="text-xs text-slate-500">{tx.payee}</span>
						)}
						{tx.category_name && (
							<span
								className="rounded px-2 py-0.5 text-xs"
								style={{
									backgroundColor: `${tx.category_color ?? "#64748b"}26`,
									color: tx.category_color ?? "#94a3b8",
								}}
							>
								{tx.category_icon} {tx.category_name}
							</span>
						)}
						{tx.duplicate_group_id && (
							<span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
								⚠ possible duplicate
							</span>
						)}
					</div>
					<div className="mt-1 text-xs text-slate-500">
						{fmtDateTime(tx.occurred_at)} · {tx.kind}
						{tx.media_kind ? ` · via ${tx.media_kind}` : ""}
						{tx.memo ? ` · ${tx.memo}` : ""}
					</div>
					<InferencePanel tx={tx} />
					{tx.duplicate_group_id && (
						<DuplicateCompare
							groupId={tx.duplicate_group_id}
							currentTx={tx}
							busy={busy}
							onAction={onAction}
						/>
					)}
				</div>
				<div
					className={`shrink-0 text-right font-semibold ${
						tx.kind === "income" ? "text-emerald-400" : "text-slate-100"
					}`}
				>
					{tx.kind === "expense" ? "−" : tx.kind === "income" ? "+" : ""}
					{fmtMoney(tx.amount, tx.currency)}
				</div>
			</div>

			{editing ? (
				<EditForm
					tx={tx}
					busy={busy}
					accounts={accounts}
					onCancel={() => onEditToggle(false)}
					onSave={(patch) => {
						onAction("edit", patch);
						onEditToggle(false);
					}}
				/>
			) : (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Picker
						compact
						options={accountOpts}
						value={accountId}
						onChange={setAccountId}
						placeholder="— no account —"
						title="File under account"
						subtitle="Applied when you accept"
						clearable
					/>
					<button className={acceptCls} disabled={busy} onClick={accept}>
						Accept
					</button>
					<button
						className={neutralCls}
						disabled={busy}
						onClick={() => onEditToggle(true)}
					>
						Edit
					</button>
					<button
						className={rejectCls}
						disabled={busy}
						onClick={() => onAction("reject")}
					>
						Reject
					</button>
					<button
						className="ml-auto text-xs text-slate-500 hover:text-slate-300"
						onClick={createRule}
						title="Pre-fill a rule from this transaction"
					>
						+ Rule
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * Everything the AI inferred from the capture that isn't yet part of the
 * ledger: an unknown source account or category becomes a one-click proposal
 * (create & attach — the transaction itself stays pending until accepted),
 * matched inferences and references show as informational chips.
 */
function InferencePanel({ tx }: { tx: PendingTransaction }) {
	const qc = useQueryClient();
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());
	const [categoryGroupId, setCategoryGroupId] = useState("");

	const ai = tx.original_ai_data;
	const taxonomy = useTaxonomy();
	// "Ungrouped" is a synthetic bucket, not somewhere a new category can go.
	const groupOptions = useMemo(
		() =>
			(taxonomy.data ?? [])
				.filter((g) => g.id !== "__ungrouped__")
				.map((g) => ({ value: g.id, label: g.name })),
		[taxonomy.data],
	);

	// A source account was detected but the model couldn't name it — synthesize
	// a placeholder from whatever it did read, so it can still be captured and
	// merged later once the real name is known.
	const acc = ai?.account;
	const hasAccountHint = !!(
		acc?.name ||
		acc?.institution ||
		acc?.number_masked
	);
	const accountName =
		acc?.name?.trim() ||
		[
			acc?.institution,
			acc?.number_masked &&
				`ending ${acc.number_masked.replace(/[^0-9]/g, "").slice(-4)}`,
		]
			.filter(Boolean)
			.join(" · ") ||
		"Unnamed account";

	const createAccount = useMutation({
		mutationFn: async () => {
			const sb = requireSupabase();
			const { data: u } = await sb.auth.getUser();
			if (!u.user) throw new Error("not signed in");
			const { data: created, error } = await sb
				.from("accounts")
				.insert({
					user_id: u.user.id,
					name: accountName.slice(0, 80),
					type: "checking",
					currency: tx.currency,
					institution: ai?.account?.institution ?? null,
					opening_balance: 0,
					// Opening balance is inferred from observed activity (a ₦4m
					// debit implies ≥₦4m was there) until the user sets it.
					metadata: {
						auto_balance: true,
						number_masked: ai?.account?.number_masked ?? null,
					},
				})
				.select("id")
				.single();
			if (error) throw new Error(error.message);
			const upd = await sb
				.from("transactions")
				.update({ account_id: created.id })
				.eq("id", tx.id);
			if (upd.error) throw new Error(upd.error.message);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: QK.pendingReview });
			qc.invalidateQueries({ queryKey: QK.accounts });
		},
		onError: (error) =>
			logEvent(
				"error",
				"inbox",
				`Create inferred account failed: ${(error as Error).message}`,
				{
					transactionId: tx.id,
				},
			),
	});

	const createCategory = useMutation({
		mutationFn: async () => {
			const sb = requireSupabase();
			const { data: u } = await sb.auth.getUser();
			if (!u.user) throw new Error("not signed in");
			const { data: created, error } = await sb
				.from("categories")
				.insert({
					user_id: u.user.id,
					name: (ai?.category ?? "").slice(0, 60),
					group_id: categoryGroupId || null,
				})
				.select("id")
				.single();
			if (error) throw new Error(error.message);
			const upd = await sb
				.from("transactions")
				.update({ category_id: created.id })
				.eq("id", tx.id);
			if (upd.error) throw new Error(upd.error.message);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: QK.pendingReview });
			qc.invalidateQueries({ queryKey: QK.taxonomy });
		},
		onError: (error) =>
			logEvent(
				"error",
				"inbox",
				`Create inferred category failed: ${(error as Error).message}`,
				{
					transactionId: tx.id,
				},
			),
	});

	if (!ai) return null;

	const proposeAccount =
		!tx.account_id && hasAccountHint && !dismissed.has("account");
	const proposeCategory =
		!tx.category_id && ai.category && !dismissed.has("category");
	// A source account / category that already resolved to an existing row: show
	// it (with the model's rationale) so the match is auditable, not silent.
	const matchedAccount = tx.account_id && acc?.name ? acc : null;
	const matchedCategory = tx.category_id && ai.category ? ai : null;
	const infoChips: string[] = [];
	if (ai.reference) infoChips.push(`ref: ${ai.reference}`);
	if (ai.line_items?.length) {
		infoChips.push(
			`${ai.line_items.length} items on receipt (see transaction detail)`,
		);
	}

	if (
		!proposeAccount &&
		!proposeCategory &&
		!matchedAccount &&
		!matchedCategory &&
		infoChips.length === 0
	) {
		return null;
	}

	return (
		<div className="mt-2 rounded-lg border border-sky-900/50 bg-sky-950/20 p-2 text-xs">
			<div className="mb-1 text-sky-300/80">Inferred from capture:</div>

			{proposeAccount && (
				<div className="py-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-slate-300">
							New account: <span className="font-medium">{accountName}</span>
							{!acc?.name && (
								<span className="text-slate-500">
									{" "}
									(auto-named — rename or merge later)
								</span>
							)}
						</span>
						<button
							className="rounded bg-sky-800/60 px-2 py-0.5 text-sky-200 hover:bg-sky-700/60 disabled:opacity-50"
							disabled={createAccount.isPending}
							onClick={() => createAccount.mutate()}
						>
							{createAccount.isPending
								? "Creating…"
								: "Create account & assign"}
						</button>
						<button
							className="text-slate-500 hover:text-slate-300"
							onClick={() => setDismissed(new Set([...dismissed, "account"]))}
						>
							Ignore
						</button>
					</div>
					{acc?.reason && (
						<p className="mt-0.5 italic text-slate-500">Why: {acc.reason}</p>
					)}
				</div>
			)}
			{createAccount.isError && (
				<p className="text-rose-400">
					{(createAccount.error as Error).message}
				</p>
			)}

			{proposeCategory && (
				<div className="py-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-slate-300">
							New category: <span className="font-medium">{ai.category}</span>
						</span>
						<Picker
							compact
							className="!px-1.5 !py-0.5"
							options={groupOptions}
							value={categoryGroupId}
							onChange={setCategoryGroupId}
							placeholder="— pick group —"
							title="Group for the new category"
							subtitle={ai?.category ?? undefined}
						/>
						<button
							className="rounded bg-sky-800/60 px-2 py-0.5 text-sky-200 hover:bg-sky-700/60 disabled:opacity-50"
							disabled={createCategory.isPending || !categoryGroupId}
							onClick={() => createCategory.mutate()}
						>
							{createCategory.isPending ? "Creating…" : "Create & assign"}
						</button>
						<button
							className="text-slate-500 hover:text-slate-300"
							onClick={() => setDismissed(new Set([...dismissed, "category"]))}
						>
							Ignore
						</button>
					</div>
					{ai.category_reason && (
						<p className="mt-0.5 italic text-slate-500">
							Why: {ai.category_reason}
						</p>
					)}
				</div>
			)}
			{createCategory.isError && (
				<p className="text-rose-400">
					{(createCategory.error as Error).message}
				</p>
			)}

			{matchedAccount && (
				<div className="py-0.5">
					<span className="text-slate-400">
						Source account:{" "}
						<span className="text-slate-300">{matchedAccount.name}</span>
					</span>
					{matchedAccount.reason && (
						<p className="mt-0.5 italic text-slate-500">
							Why: {matchedAccount.reason}
						</p>
					)}
				</div>
			)}

			{matchedCategory && matchedCategory.category_reason && (
				<div className="py-0.5">
					<span className="text-slate-400">
						Category:{" "}
						<span className="text-slate-300">{matchedCategory.category}</span>
					</span>
					<p className="mt-0.5 italic text-slate-500">
						Why: {matchedCategory.category_reason}
					</p>
				</div>
			)}

			{infoChips.length > 0 && (
				<div className="flex flex-wrap gap-2 py-0.5 text-slate-500">
					{infoChips.map((chip) => (
						<span key={chip}>{chip}</span>
					))}
				</div>
			)}
		</div>
	);
}

interface DuplicateSibling {
	id: string;
	payee: string | null;
	amount: number;
	currency: string;
	occurred_at: string;
	review_status: string;
	original_ai_data: ParsedTransaction | null;
	media_ingestions: { media_kind: string } | null;
}

function DuplicateCompare({
	groupId,
	currentTx,
	busy,
	onAction,
}: {
	groupId: string;
	currentTx: PendingTransaction;
	busy: boolean;
	onAction: (action: ReviewAction, patch?: Record<string, unknown>) => void;
}) {
	const siblings = useQuery({
		queryKey: ["dup-group", groupId, currentTx.id],
		queryFn: async () => {
			const { data, error } = await requireSupabase()
				.from("transactions")
				.select(
					"id, payee, amount, currency, occurred_at, review_status, original_ai_data, media_ingestions(media_kind)",
				)
				.eq("duplicate_group_id", groupId)
				.neq("id", currentTx.id)
				.order("occurred_at", { ascending: false });
			if (error) throw new Error(error.message);
			return (data ?? []) as unknown as DuplicateSibling[];
		},
	});

	if (!siblings.data?.length) return null;

	const currentHasItems = !!currentTx.original_ai_data?.line_items?.length;

	return (
		<div className="mt-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2 text-xs">
			<div className="mb-1 text-amber-300/80">Matches on record:</div>
			{siblings.data.map((s) => {
				const siblingHasItems = !!(
					s.original_ai_data as ParsedTransaction | null
				)?.line_items?.length;
				const richer =
					siblingHasItems && !currentHasItems
						? "sibling"
						: currentHasItems && !siblingHasItems
							? "current"
							: null;

				return (
					<div key={s.id} className="py-1">
						<div className="flex items-center gap-2 text-slate-400">
							<span
								className={`sb-pill ${
									s.review_status === "accepted"
										? "bg-tint-green text-emerald-400"
										: s.review_status === "rejected"
											? "bg-tint-coral text-rose-400"
											: "bg-chip text-slate-400"
								}`}
							>
								{s.review_status.replace("_", " ")}
							</span>
							<span>{fmtDateTime(s.occurred_at)}</span>
							<span className="text-slate-300">{s.payee ?? "(no payee)"}</span>
							{s.media_ingestions?.media_kind && (
								<span>via {s.media_ingestions.media_kind}</span>
							)}
							<span className="ml-auto font-medium text-slate-200">
								{fmtMoney(Number(s.amount), s.currency)}
							</span>
						</div>
						{richer && (
							<div className="mt-0.5 text-amber-400/70">
								{richer === "sibling"
									? `This copy has ${(s.original_ai_data as ParsedTransaction).line_items!.length} line items`
									: `Current card has ${currentTx.original_ai_data!.line_items!.length} line items`}
							</div>
						)}
						{s.review_status !== "rejected" && (
							<div className="mt-1.5 flex flex-wrap gap-2">
								<button
									className="rounded bg-emerald-800/50 px-2 py-0.5 text-emerald-200 hover:bg-emerald-700/50 disabled:opacity-50"
									disabled={busy}
									onClick={() => {
										onAction("merge", { secondary_id: s.id });
									}}
									title="Accept this card and reject the other, merging line items and references from both"
								>
									Keep this, merge data
								</button>
								<button
									className="rounded bg-amber-800/50 px-2 py-0.5 text-amber-200 hover:bg-amber-700/50 disabled:opacity-50"
									disabled={busy}
									onClick={() => {
										onAction("reject");
									}}
									title="Reject this card — the other record stays"
								>
									Keep other, reject this
								</button>
								<button
									className="rounded bg-slate-700/50 px-2 py-0.5 text-slate-300 hover:bg-slate-600/50 disabled:opacity-50"
									disabled={busy}
									onClick={() => {
										onAction("unlink");
									}}
									title="These are not duplicates — unlink from this group"
								>
									Not a duplicate
								</button>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function EditForm({
	tx,
	busy,
	accounts,
	onSave,
	onCancel,
}: {
	tx: PendingTransaction;
	busy: boolean;
	accounts: Account[];
	onSave: (patch: Record<string, unknown>) => void;
	onCancel: () => void;
}) {
	const [payee, setPayee] = useState(tx.payee ?? "");
	const [amount, setAmount] = useState(String(tx.amount));
	const [currency, setCurrency] = useState(tx.currency);
	const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
	const [accountId, setAccountId] = useState(
		() => tx.account_id ?? localStorage.getItem(LAST_ACCOUNT_KEY) ?? "",
	);
	const [memo, setMemo] = useState(tx.memo ?? "");

	const categoryOpts = useCategoryOptions();
	const accountOpts = useMemo(
		() => accountOptions(accounts, { showCurrency: true }),
		[accounts],
	);

	function submit(e: FormEvent) {
		e.preventDefault();
		if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
		onSave({
			payee: payee.trim() || null,
			amount: Number(amount),
			currency: currency.trim().toUpperCase(),
			category_id: categoryId || null,
			account_id: accountId || null,
			memo: memo.trim() || null,
		});
	}

	return (
		<form onSubmit={submit} className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
			<input
				className="sb-input"
				value={payee}
				onChange={(e) => setPayee(e.target.value)}
				placeholder="payee"
			/>
			<div className="flex gap-2">
				<input
					className="sb-input flex-1"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
					type="number"
					step="0.01"
					min="0"
					required
				/>
				<input
					className="sb-input w-20"
					value={currency}
					onChange={(e) => setCurrency(e.target.value)}
					maxLength={3}
					required
				/>
			</div>
			<Picker
				options={categoryOpts}
				value={categoryId}
				onChange={setCategoryId}
				placeholder="— no category —"
				title="Category"
				clearable
			/>
			<Picker
				options={accountOpts}
				value={accountId}
				onChange={setAccountId}
				placeholder="— no account —"
				title="Account"
				clearable
			/>
			<input
				className="sb-input sm:col-span-2"
				value={memo}
				onChange={(e) => setMemo(e.target.value)}
				placeholder="memo"
			/>
			<div className="flex gap-2 sm:col-span-2">
				<button className={acceptCls} disabled={busy}>
					Save & accept
				</button>
				<button type="button" className={neutralCls} onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}

/* Review verbs, styled by consequence: accepting is the primary action, the
   other two stay quiet so the card doesn't read as three equal choices. */
const acceptCls = "sb-btn sb-btn-primary !py-1.5";
const rejectCls = "sb-btn sb-btn-ghost !py-1.5 !text-rose-400";
const neutralCls = "sb-btn sb-btn-ghost !py-1.5";
