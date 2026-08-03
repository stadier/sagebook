import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { usePalette } from "../components/CommandPalette";
import { useConfirm } from "../components/Confirm";
import DataTable, {
	type Column,
	type RowAction,
} from "../components/DataTable";
import {
	ArchiveIcon,
	CloseIcon,
	EditIcon,
	MergeIcon,
	PlusIcon,
	TrashIcon,
	UnarchiveIcon,
} from "../components/icons";
import {
	Avatar,
	Field,
	Input,
	Modal,
	PageHeader,
	Picker,
	Pill,
	QueryError,
	StatCard,
	tintFor,
} from "../components/ui";
import {
	ACCOUNT_SECTIONS,
	ACCOUNT_TYPES,
	accountTypeLabel,
	DEFAULT_CURRENCY,
} from "../lib/constants";
import { fmtMoney } from "../lib/format";
import { pairOptions } from "../lib/options";
import { usePersisted } from "../lib/persist";
import { QK, useAccountBalances } from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import type { AccountType, AccountWithBalance } from "../lib/types";

/** The asset class an account type belongs to, per the dashboard's stacking. */
function sectionOf(type: AccountType): string {
	return ACCOUNT_SECTIONS.find((s) => s.types.includes(type))?.label ?? "Other";
}

const TYPE_OPTIONS = pairOptions(ACCOUNT_TYPES);

/** Asset classes filter on their own label, so value and label coincide. */
const SECTION_OPTIONS = ACCOUNT_SECTIONS.map((s) => ({
	value: s.label,
	label: s.label,
}));

export default function Accounts() {
	const qc = useQueryClient();
	const palette = usePalette();
	const confirm = useConfirm();
	const [showArchived, setShowArchived] = usePersisted(
		"sagebook.webapp.filter.accounts.archived",
		false,
	);
	const [sectionFilter, setSectionFilter] = usePersisted(
		"sagebook.webapp.filter.accounts.section",
		"",
	);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const accounts = useAccountBalances();

	const setArchived = useMutation({
		mutationFn: async (args: { id: string; archived: boolean }) => {
			const { error } = await requireSupabase()
				.from("accounts")
				.update({ is_archived: args.archived })
				.eq("id", args.id);
			if (error) throw new Error(error.message);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: QK.accounts });
			qc.invalidateQueries({ queryKey: QK.accountBalances });
		},
	});

	const remove = useMutation({
		mutationFn: async (id: string) => {
			const sb = requireSupabase();
			// account_id FK cascades on delete, so detach transactions first —
			// deleting an account should never silently wipe its history.
			const detach = await sb
				.from("transactions")
				.update({ account_id: null })
				.eq("account_id", id);
			if (detach.error) throw new Error(detach.error.message);
			const { error } = await sb.from("accounts").delete().eq("id", id);
			if (error) throw new Error(error.message);
		},
		onSuccess: () => {
			qc.invalidateQueries();
		},
	});

	/**
	 * How much history hangs off an account. Asked for at the moment of
	 * deleting rather than carried on every row: a confirmation that can't say
	 * what it costs isn't really asking anything.
	 */
	async function transactionCount(id: string): Promise<number | null> {
		const { count, error } = await requireSupabase()
			.from("transactions")
			.select("id", { count: "exact", head: true })
			.eq("account_id", id);
		return error ? null : (count ?? 0);
	}

	// Fold one account into another — all transactions and scheduled items move.
	const merge = useMutation({
		mutationFn: async (args: { source: string; target: string }) => {
			const { error } = await requireSupabase().rpc("merge_accounts", {
				p_source: args.source,
				p_target: args.target,
			});
			if (error) throw new Error(error.message);
		},
		onSuccess: () => qc.invalidateQueries(),
	});

	const rows = (accounts.data ?? []).filter(
		(a) =>
			(showArchived || !a.is_archived) &&
			(!sectionFilter || sectionOf(a.type) === sectionFilter),
	);
	const allActive = (accounts.data ?? []).filter((a) => !a.is_archived);

	// Merge candidates, built once for the whole table; each row then drops
	// itself from the list rather than re-deriving it per row.
	const mergeTargets = useMemo(
		() =>
			allActive.map((a) => ({
				value: a.id,
				label: a.name,
				hint: a.currency,
				keywords: a.institution ?? undefined,
			})),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[accounts.data],
	);

	const assets = allActive.reduce(
		(s, a) => s + Math.max(0, Number(a.current_balance)),
		0,
	);
	const liabilities = allActive.reduce(
		(s, a) => s + Math.min(0, Number(a.current_balance)),
		0,
	);
	const baseCurrency = allActive[0]?.currency ?? DEFAULT_CURRENCY;

	const activeFilterCount = (showArchived ? 1 : 0) + (sectionFilter ? 1 : 0);

	const columns: Array<Column<AccountWithBalance>> = [
		{
			id: "name",
			label: "Account",
			hideable: false,
			mobile: "title",
			sortValue: (a) => a.name,
			searchValue: (a) =>
				[a.name, a.institution, a.metadata?.number_masked]
					.filter(Boolean)
					.join(" "),
			cell: (a) => (
				<div className="flex min-w-0 items-center gap-3">
					<Avatar label={a.name} tint={tintFor(a.name)} size={30} />
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-slate-100">
							<span className="truncate">{a.name}</span>
							{a.metadata?.auto_balance && (
								<span title="Opening balance is inferred from observed activity (a debit implies the funds were there). Set an opening balance manually to take over.">
									<Pill tint="indigo">inferred</Pill>
								</span>
							)}
							{a.is_archived && <Pill>archived</Pill>}
						</div>
						{(a.institution || a.metadata?.number_masked) && (
							<div className="truncate text-xs text-slate-500">
								{[a.institution, a.metadata?.number_masked]
									.filter(Boolean)
									.join(" · ")}
							</div>
						)}
					</div>
				</div>
			),
		},
		{
			id: "type",
			label: "Type",
			width: "11rem",
			sortValue: (a) => accountTypeLabel(a.type),
			cell: (a) => (
				<span className="text-[0.8125rem] text-slate-400">
					{accountTypeLabel(a.type)}
				</span>
			),
		},
		{
			id: "class",
			label: "Class",
			width: "9rem",
			defaultHidden: true,
			sortValue: (a) => sectionOf(a.type),
			cell: (a) => <Pill>{sectionOf(a.type)}</Pill>,
		},
		{
			id: "currency",
			label: "Currency",
			width: "7rem",
			defaultHidden: true,
			sortValue: (a) => a.currency,
			cell: (a) => (
				<span className="text-[0.8125rem] text-slate-400">{a.currency}</span>
			),
		},
		{
			id: "opening",
			label: "Opened at",
			align: "right",
			width: "10rem",
			defaultHidden: true,
			sortValue: (a) => Number(a.opening_balance),
			cell: (a) => (
				<span className="whitespace-nowrap text-[0.8125rem] text-slate-500 tnum">
					{fmtMoney(Number(a.opening_balance), a.currency)}
				</span>
			),
		},
		{
			id: "balance",
			label: "Balance",
			align: "right",
			width: "11rem",
			hideable: false,
			mobile: "trailing",
			sortValue: (a) => Number(a.current_balance),
			cell: (a) => (
				<div>
					<div
						className={`whitespace-nowrap text-[0.9375rem] font-bold tnum ${
							Number(a.current_balance) < 0 ? "text-rose-400" : "text-slate-100"
						}`}
					>
						{fmtMoney(Number(a.current_balance), a.currency)}
					</div>
					<div className="whitespace-nowrap text-xs text-slate-500">
						opened at {fmtMoney(Number(a.opening_balance), a.currency)}
					</div>
				</div>
			),
		},
	];

	return (
		<>
			<PageHeader
				title="Accounts"
				subtitle={`${allActive.length} active · where transactions are filed on accept`}
			>
				<button
					className="sb-btn sb-btn-primary"
					onClick={() => setCreating(true)}
				>
					<PlusIcon size={15} />
					Add account
				</button>
			</PageHeader>

			<div className="grid gap-3.5 sm:grid-cols-3">
				<StatCard label="Total assets" value={fmtMoney(assets, baseCurrency)} />
				<StatCard
					label="Total liabilities"
					value={fmtMoney(liabilities, baseCurrency)}
					tone="negative"
				/>
				<StatCard
					label="Net worth"
					value={fmtMoney(assets + liabilities, baseCurrency)}
					tone="dark"
				/>
			</div>

			<QueryError error={accounts.error} />
			<QueryError error={merge.error ?? remove.error ?? setArchived.error} />

			<DataTable
				storageKey="accounts"
				data={rows}
				columns={columns}
				rowId={(a) => a.id}
				loading={accounts.isLoading}
				rowNoun="account"
				searchPlaceholder="Search name, institution, number…"
				exportFilename="sagebook-accounts"
				initialSort={{ columnId: "balance", direction: "desc" }}
				activeFilterCount={activeFilterCount}
				onClearFilters={() => {
					setShowArchived(false);
					setSectionFilter("");
				}}
				filters={
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Asset class">
							<Picker
								options={SECTION_OPTIONS}
								value={sectionFilter}
								onChange={setSectionFilter}
								placeholder="All classes"
								title="Asset class"
								clearable
							/>
						</Field>
						<Field label="Archived">
							<label className="flex items-center gap-2 py-2 text-[0.8125rem] text-slate-400">
								<input
									type="checkbox"
									className="sb-check"
									checked={showArchived}
									onChange={(e) => setShowArchived(e.target.checked)}
								/>
								Show archived accounts
							</label>
						</Field>
					</div>
				}
				rowClassName={(a) => (a.is_archived ? "opacity-60" : "")}
				expandedIds={editingId ? [editingId] : []}
				onExpandedChange={(ids) => setEditingId(ids[ids.length - 1] ?? null)}
				renderExpanded={(a) => (
					<EditAccountForm account={a} onDone={() => setEditingId(null)} />
				)}
				rowLabel={(a) => a.name}
				rowActions={(a): RowAction[] => [
					{
						label: editingId === a.id ? "Close editor" : "Edit account",
						icon: editingId === a.id ? <CloseIcon size={16} /> : <EditIcon />,
						onSelect: () => setEditingId(editingId === a.id ? null : a.id),
					},
					{
						label: a.is_archived ? "Unarchive account" : "Archive account",
						hint: a.is_archived
							? "back to the list"
							: "hides it, keeps everything",
						icon: a.is_archived ? <UnarchiveIcon /> : <ArchiveIcon />,
						disabled: setArchived.isPending,
						onSelect: () =>
							setArchived.mutate({ id: a.id, archived: !a.is_archived }),
					},
					{
						label: "Merge into another account…",
						icon: <MergeIcon />,
						hidden: allActive.length < 2 || a.is_archived,
						disabled: merge.isPending,
						onSelect: () =>
							palette.open({
								title: "Merge into",
								subtitle: `Move everything from ${a.name}`,
								options: mergeTargets.filter((x) => x.value !== a.id),
								onSelect: (target) =>
									confirm({
										title: "Merge accounts?",
										body: `All of "${a.name}"'s transactions and scheduled items move to "${
											allActive.find((x) => x.id === target)?.name
										}", then "${a.name}" is deleted.`,
										confirmLabel: "Merge",
										onConfirm: () => merge.mutate({ source: a.id, target }),
									}),
							}),
					},
					{
						label: "Delete account…",
						icon: <TrashIcon />,
						danger: true,
						disabled: remove.isPending,
						// Async so the dialog can state what the delete actually
						// costs rather than a vague "this cannot be undone".
						onSelect: async () => {
							const count = await transactionCount(a.id);
							confirm({
								title: `Delete "${a.name}"?`,
								body: (
									<>
										There is no undo and no trash to recover it from.
										{count !== null && count > 0 && (
											<>
												{" "}
												Its{" "}
												<b className="text-slate-300">
													{count.toLocaleString()} transaction
													{count === 1 ? "" : "s"}
												</b>{" "}
												are kept, but they stop being filed under any account —
												your balances will change to match.
											</>
										)}
									</>
								),
								confirmLabel: "Delete permanently",
								danger: true,
								requirePhrase: a.name,
								// Archiving is nearly always what "get this off
								// my list" actually means — so it is the primary
								// button, and delete is the one you reach past.
								alternative: a.is_archived
									? undefined
									: {
											label: "Archive instead",
											hint: "Archiving keeps everything and can be undone — archived accounts are under Filter → Show archived.",
											onSelect: () =>
												setArchived.mutate({ id: a.id, archived: true }),
										},
								onConfirm: () => remove.mutate(a.id),
							});
						},
					},
				]}
				emptyTitle="No accounts yet"
				emptyBody="Add your first account — captures are filed against it on accept."
				footNote="Click a row to edit it."
			/>

			<Modal
				open={creating}
				onClose={() => setCreating(false)}
				title="New account"
				subtitle="Captures are filed against an account when you accept them."
			>
				<CreateAccountForm onDone={() => setCreating(false)} />
			</Modal>
		</>
	);
}

function EditAccountForm({
	account,
	onDone,
}: {
	account: AccountWithBalance;
	onDone: () => void;
}) {
	const qc = useQueryClient();
	const [name, setName] = useState(account.name);
	const [type, setType] = useState<AccountType>(account.type);
	const [currency, setCurrency] = useState(account.currency);
	const [institution, setInstitution] = useState(account.institution ?? "");
	const [openingBalance, setOpeningBalance] = useState(
		String(account.opening_balance),
	);

	const save = useMutation({
		mutationFn: async () => {
			const patch: Record<string, unknown> = {
				name: name.trim(),
				type,
				currency: currency.trim().toUpperCase(),
				institution: institution.trim() || null,
				opening_balance: Number(openingBalance) || 0,
			};
			// A manually set opening balance takes over from inference.
			if (
				account.metadata?.auto_balance &&
				Number(openingBalance) !== Number(account.opening_balance)
			) {
				patch.metadata = { ...account.metadata, auto_balance: false };
			}
			const { error } = await requireSupabase()
				.from("accounts")
				.update(patch)
				.eq("id", account.id);
			if (error) throw new Error(error.message);
		},
		onSuccess: () => {
			onDone();
			qc.invalidateQueries(); // balances, pickers, net worth all depend on accounts
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (name.trim()) save.mutate();
			}}
			className="grid gap-2 sm:grid-cols-2"
		>
			<Input value={name} onChange={(e) => setName(e.target.value)} required />
			<Picker
				options={TYPE_OPTIONS}
				value={type}
				onChange={setType}
				title="Account type"
			/>
			<Input
				value={currency}
				maxLength={3}
				onChange={(e) => setCurrency(e.target.value)}
				required
			/>
			<Input
				placeholder="Institution"
				value={institution}
				onChange={(e) => setInstitution(e.target.value)}
			/>
			<label className="flex items-center gap-2 text-xs text-slate-500">
				Opening balance
				<Input
					className="flex-1"
					type="number"
					step="0.01"
					value={openingBalance}
					onChange={(e) => setOpeningBalance(e.target.value)}
				/>
			</label>
			<div className="flex items-center gap-2">
				<button
					className="sb-btn sb-btn-primary"
					disabled={save.isPending || !name.trim()}
				>
					{save.isPending ? "Saving…" : "Save"}
				</button>
				<button type="button" className="sb-btn sb-btn-ghost" onClick={onDone}>
					Cancel
				</button>
			</div>
			{account.metadata?.auto_balance && (
				<p className="text-xs text-sky-300/70 sm:col-span-2">
					This account's opening balance is currently inferred from activity.
					Changing it here switches to your manual value permanently.
				</p>
			)}
			<div className="sm:col-span-2">
				<QueryError error={save.error} />
			</div>
		</form>
	);
}

function CreateAccountForm({ onDone }: { onDone: () => void }) {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [type, setType] = useState<AccountType>("checking");
	const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
	const [institution, setInstitution] = useState("");
	const [openingBalance, setOpeningBalance] = useState("0");

	const create = useMutation({
		mutationFn: async () => {
			const sb = requireSupabase();
			const { data: userData, error: userErr } = await sb.auth.getUser();
			if (userErr || !userData.user) throw new Error("not signed in");
			const { error } = await sb.from("accounts").insert({
				user_id: userData.user.id,
				name: name.trim(),
				type,
				currency: currency.trim().toUpperCase(),
				institution: institution.trim() || null,
				opening_balance: Number(openingBalance) || 0,
			});
			if (error) throw new Error(error.message);
		},
		onSuccess: () => {
			setName("");
			setInstitution("");
			setOpeningBalance("0");
			qc.invalidateQueries({ queryKey: QK.accounts });
			qc.invalidateQueries({ queryKey: QK.accountBalances });
			onDone();
		},
	});

	function submit(e: FormEvent) {
		e.preventDefault();
		if (name.trim()) create.mutate();
	}

	return (
		<form onSubmit={submit}>
			<div className="grid gap-2 sm:grid-cols-2">
				<Input
					placeholder="Name, e.g. GTBank Current"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
				/>
				<Picker
					options={TYPE_OPTIONS}
					value={type}
					onChange={setType}
					title="Account type"
				/>
				<Input
					placeholder="Currency (ISO), e.g. NGN"
					value={currency}
					onChange={(e) => setCurrency(e.target.value)}
					maxLength={3}
					required
				/>
				<Input
					placeholder="Institution (optional)"
					value={institution}
					onChange={(e) => setInstitution(e.target.value)}
				/>
				<Input
					type="number"
					step="0.01"
					placeholder="Opening balance"
					value={openingBalance}
					onChange={(e) => setOpeningBalance(e.target.value)}
				/>
			</div>
			<p className="mt-2.5 text-xs text-slate-500">
				The currency must exist in the currencies table — majors plus NGN, ZAR,
				KES, GHS, INR and AED are seeded by the migrations.
			</p>
			<div className="mt-2">
				<QueryError error={create.error} />
			</div>
			<div className="mt-4 flex items-center gap-2">
				<button
					className="sb-btn sb-btn-primary"
					disabled={create.isPending || !name.trim()}
				>
					{create.isPending ? "Creating…" : "Create account"}
				</button>
				<button type="button" className="sb-btn sb-btn-ghost" onClick={onDone}>
					Cancel
				</button>
			</div>
		</form>
	);
}
