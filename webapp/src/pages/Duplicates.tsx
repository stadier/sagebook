/* The ledger's duplicate review — every group of accepted entries where the
   day, amount, payee, currency, account and kind all match exactly. Because
   the fields agree field-for-field, a flagged group is almost certainly the
   same charge double-booked (a retried capture, a statement parsed twice).

   Each card is one group. Pick the row to keep — every other member folds
   into it through the same merge the inbox uses — or tell the scan the group
   is actually different charges and it stops reporting it. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useConfirm } from "../components/Confirm";
import { WarningIcon } from "../components/icons";
import LedgerTabs from "../components/LedgerTabs";
import {
	Card,
	Empty,
	PageHeader,
	QueryError,
	StatCard,
} from "../components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "../lib/format";
import { logEvent } from "../lib/logger";
import { QK, useDuplicateGroups } from "../lib/queries";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { DedupGroup } from "../lib/types";

/** Badge tone per kind, mirroring the ledger. */
const KIND_TONE: Record<string, string> = {
	income: "bg-tint-green text-emerald-400",
	expense: "bg-tint-coral text-rose-400",
	transfer: "bg-tint-blue text-sky-400",
	adjustment: "bg-chip text-slate-400",
};

/** The sign a kind puts in front of its amount (amounts are stored unsigned). */
function signed(kind: string, amount: number, currency: string): string {
	const sign = kind === "income" ? "+" : kind === "expense" ? "−" : "";
	return `${sign}${fmtMoney(amount, currency)}`;
}

/** The scan's match fields, as the chips a group card shows. */
function reasonChips(reason: string): string[] {
	return reason
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

export default function Duplicates() {
	const qc = useQueryClient();
	const confirm = useConfirm();
	const duplicates = useDuplicateGroups();
	const groups = duplicates.data ?? [];

	/** Which group is being worked on, and how — locks the card's buttons. */
	const [busy, setBusy] = useState<{
		group: string;
		action: "merge" | "dismiss";
	} | null>(null);

	function invalidate() {
		qc.invalidateQueries({ queryKey: QK.duplicates });
		qc.invalidateQueries({ queryKey: ["transactions"] });
	}

	/** Fold every sibling into the keeper via the inbox's merge endpoint. */
	const merge = useMutation({
		mutationFn: async (args: { keeperId: string; memberIds: string[] }) => {
			for (const secondaryId of args.memberIds) {
				await invokeFn("review-transaction", {
					transactionId: args.keeperId,
					action: "merge",
					patch: { secondary_id: secondaryId },
				});
			}
		},
		onSuccess: invalidate,
		onError: (error) => {
			logEvent(
				"error",
				"duplicates",
				`Merge failed: ${(error as Error).message}`,
			);
		},
	});

	/** Stop the scan from reporting a group the user says isn't a duplicate. */
	const dismiss = useMutation({
		mutationFn: async (dupKey: string) => {
			const { error } = await requireSupabase()
				.from("dedup_dismissals")
				.insert({ dup_key: dupKey });
			if (error) throw new Error(error.message);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: QK.duplicates }),
		onError: (error) => {
			logEvent(
				"error",
				"duplicates",
				`Dismiss failed: ${(error as Error).message}`,
			);
		},
	});

	function runMerge(group: DedupGroup, keeperId: string) {
		const memberIds = group.members
			.map((m) => m.id)
			.filter((id) => id !== keeperId);
		if (!memberIds.length || busy) return;
		setBusy({ group: group.dupKey, action: "merge" });
		merge.mutate({ keeperId, memberIds }, { onSettled: () => setBusy(null) });
	}

	function askDismiss(group: DedupGroup) {
		if (busy) return;
		confirm({
			title: "Hide this group?",
			body: (
				<>
					The {group.members.length} entries for{" "}
					<strong className="text-slate-200">
						{group.payee ?? "unknown payee"}
					</strong>{" "}
					on {fmtDate(`${group.day}T12:00:00`)} stay exactly as they are — the
					scan just won't flag this combination again.
				</>
			),
			confirmLabel: "Not duplicates",
			onConfirm: () => {
				setBusy({ group: group.dupKey, action: "dismiss" });
				dismiss.mutate(group.dupKey, { onSettled: () => setBusy(null) });
			},
		});
	}

	/* The value that would be counted twice if every group were merged: each
	   extra copy of the same charge. Kept per currency — summing across
	   currencies would quietly invent money. */
	const doubleBooked = useMemo(() => {
		const byCurrency = new Map<string, number>();
		for (const g of groups) {
			const extra = (g.members.length - 1) * g.amount;
			byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + extra);
		}
		return [...byCurrency.entries()].map(([currency, total]) =>
			fmtMoney(total, currency),
		);
	}, [groups]);

	const duplicateEntries = groups.reduce(
		(sum, g) => sum + g.members.length - 1,
		0,
	);

	return (
		<>
			<LedgerTabs />
			<PageHeader
				title="Duplicates"
				subtitle="Charges that hit your ledger twice — the same day, amount, payee and account. Pick the entry to keep, or tell the scan they're different charges."
			>
				<button
					className="sb-btn sb-btn-ghost"
					onClick={() => duplicates.refetch()}
				>
					↻ Rescan
				</button>
			</PageHeader>

			<QueryError error={duplicates.error} />
			<QueryError error={merge.error} />
			<QueryError error={dismiss.error} />

			<div className="grid gap-3.5 sm:grid-cols-3">
				<StatCard
					label="Flagged groups"
					value={groups.length}
					hint="needing a look"
				/>
				<StatCard
					label="Duplicate entries"
					value={duplicateEntries}
					tone={duplicateEntries > 0 ? "negative" : "positive"}
					hint={
						duplicateEntries === 1
							? "extra copy"
							: "extra copies of the same charge"
					}
				/>
				<StatCard
					label="Double-booked"
					value={doubleBooked.length ? doubleBooked.join(" · ") : "—"}
					hint="counted twice if left alone"
				/>
			</div>

			{duplicates.isLoading && <Empty loading>Scanning your ledger…</Empty>}

			{/* Only claim the ledger is clean once the scan has actually finished —
			    during retries the query is neither loading nor errored yet, and
			    rendering the empty card then would flash a false all-clear. */}
			{duplicates.status === "success" && groups.length === 0 && (
				<Card>
					<p className="text-sm text-slate-500">
						No potential duplicates — every entry in your ledger looks distinct.
					</p>
				</Card>
			)}

			<div className="flex flex-col gap-4">
				{groups.map((group) => {
					const groupBusy = busy?.group === group.dupKey;
					const anyBusy = busy !== null;
					return (
						<div key={group.dupKey} className="sb-card overflow-hidden">
							{/* Group header — what matched, and what it is */}
							<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-800/60 bg-amber-500/[0.05] px-5 py-4">
								<div className="flex min-w-0 items-start gap-2.5">
									<WarningIcon className="mt-0.5 shrink-0 text-amber-400" />
									<div className="min-w-0">
										<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
											<span className="font-semibold text-slate-100">
												{group.payee ?? "Unknown payee"}
											</span>
											<span className="text-[0.8125rem] text-slate-400">
												{fmtDate(`${group.day}T12:00:00`)}
											</span>
											{group.accountName && (
												<span className="text-[0.8125rem] text-slate-500">
													{group.accountName}
												</span>
											)}
										</div>
										<div className="mt-1.5 flex flex-wrap gap-1.5">
											{reasonChips(group.reason).map((chip) => (
												<span
													key={chip}
													className="sb-pill bg-tint-amber text-amber-300/80"
												>
													{chip}
												</span>
											))}
										</div>
									</div>
								</div>
								<div className="shrink-0 text-right">
									<div className="whitespace-nowrap font-semibold text-slate-100">
										{signed(group.kind, group.amount, group.currency)}
									</div>
									<div className="text-[0.6875rem] text-slate-500">
										{group.members.length} entries
									</div>
								</div>
							</div>

							{/* Members — each row is a candidate keeper */}
							<ul className="divide-y divide-slate-800/50">
								{group.members.map((member) => (
									<li
										key={member.id}
										className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3"
									>
										<span
											className={`sb-pill ${
												KIND_TONE[member.kind] ?? "bg-chip text-slate-400"
											}`}
										>
											{member.kind}
										</span>
										<span className="whitespace-nowrap text-[0.78125rem] text-slate-400">
											{fmtDateTime(member.occurred_at)}
										</span>
										<span className="min-w-0 truncate text-[0.8125rem] text-slate-400">
											{[member.account_name, member.category_name]
												.filter(Boolean)
												.join(" · ") || "—"}
										</span>
										<span className="ml-auto whitespace-nowrap text-[0.8125rem] font-medium text-slate-200">
											{signed(
												member.kind,
												Number(member.amount),
												member.currency,
											)}
										</span>
										<button
											className="rounded bg-emerald-800/50 px-2.5 py-1 text-[0.75rem] font-semibold text-emerald-200 hover:bg-emerald-700/50 disabled:cursor-not-allowed disabled:opacity-40"
											disabled={anyBusy}
											onClick={() => runMerge(group, member.id)}
											title="Keep this entry and fold every other copy into it — line items, references and receipts are kept"
										>
											{groupBusy && busy?.action === "merge"
												? "Merging…"
												: "Keep this, merge others"}
										</button>
									</li>
								))}
							</ul>

							{/* Footer — the second opinion */}
							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 px-5 py-2.5">
								<span className="text-[0.6875rem] text-slate-500">
									Merging keeps the entry's category and any receipt; the other
									copies move to rejected.
								</span>
								<button
									className="rounded px-2.5 py-1 text-[0.75rem] font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
									disabled={anyBusy}
									onClick={() => askDismiss(group)}
									title="These are genuinely different charges — stop flagging this combination"
								>
									{groupBusy && busy?.action === "dismiss"
										? "Hiding…"
										: "Not duplicates — hide group"}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</>
	);
}
