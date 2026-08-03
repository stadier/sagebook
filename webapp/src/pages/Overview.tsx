import { useState } from "react";
import { Link } from "react-router-dom";
import { useGlobalSearch } from "../components/GlobalSearch";
import { MicIcon, SearchIcon } from "../components/icons";
import NetWorthChart from "../components/NetWorthChart";
import {
	Avatar,
	Card,
	CardHeader,
	DarkPanel,
	DashedCard,
	Empty,
	LegendDot,
	Meter,
	MeterRow,
	PageHeader,
	Pill,
	Segmented,
	tintFor,
} from "../components/ui";
import { accountTypeLabel, DEFAULT_CURRENCY } from "../lib/constants";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "../lib/format";
import {
	currentBudget,
	useAccountBalances,
	useBudgetProgress,
	useBudgets,
	useCategorySummary,
	useMonthlySummary,
	useNetWorthSnapshots,
	usePendingReview,
	useRecentTransactions,
	useScheduled,
} from "../lib/queries";
import { CHART_COLORS, colorFor, seriesColor } from "../lib/theme";
import type { MonthlySummaryRow, NetWorthSnapshot } from "../lib/types";

type Range = "6m" | "1y" | "all";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
	{ value: "6m", label: "6M" },
	{ value: "1y", label: "1Y" },
	{ value: "all", label: "All" },
];

/** Rows the dashboard's compact lists show before linking to the full page. */
const ACTIVITY_ROWS = 4;
const UPCOMING_ROWS = 3;
const ACCOUNT_TILES = 4;
const BUDGET_ROWS = 3;
const SPEND_CATEGORIES = 5;

export default function Overview() {
	const monthLabel = new Date().toLocaleDateString(undefined, {
		month: "long",
	});
	const [range, setRange] = useState<Range>("1y");
	const search = useGlobalSearch();

	const snapshots = useNetWorthSnapshots();
	const monthly = useMonthlySummary();
	const byCategory = useCategorySummary();
	const recent = useRecentTransactions(ACTIVITY_ROWS);
	const upcoming = useScheduled({ activeOnly: true, limit: UPCOMING_ROWS });
	const pending = usePendingReview();
	const balances = useAccountBalances();
	const budgets = useBudgets();
	const budget = currentBudget(budgets.data);
	const progress = useBudgetProgress(budget?.id);

	/* --- Derived ---------------------------------------------------------- */

	const allRows = snapshots.data ?? [];
	const rows = sliceRange(allRows, range);
	const latest = allRows.length ? allRows[allRows.length - 1] : null;
	const first = rows.length ? rows[0] : null;
	const currency = latest?.base_currency ?? DEFAULT_CURRENCY;

	const startVal = first ? Number(first.net_worth) : 0;
	const endVal = latest ? Number(latest.net_worth) : 0;
	const pctChange =
		startVal !== 0 ? ((endVal - startVal) / Math.abs(startVal)) * 100 : null;
	const up = pctChange === null ? true : pctChange >= 0;

	const income = sumRows(
		(monthly.data ?? []).filter((r) => r.kind === "income"),
	);
	const expense = sumRows(
		(monthly.data ?? []).filter((r) => r.kind === "expense"),
	);
	const netSaved = income - expense;
	const savingRate = income > 0 ? Math.round((netSaved / income) * 100) : null;

	const spendRows = (byCategory.data ?? [])
		.filter((r) => Number(r.total_amount) > 0)
		.slice(0, SPEND_CATEGORIES);
	const spendTotal = spendRows.reduce((s, r) => s + Number(r.total_amount), 0);

	const activeAccounts = (balances.data ?? []).filter((a) => !a.is_archived);
	const assets = activeAccounts.reduce(
		(s, a) => s + Math.max(0, Number(a.current_balance)),
		0,
	);
	const debt = activeAccounts.reduce(
		(s, a) => s + Math.min(0, Number(a.current_balance)),
		0,
	);

	const budgetLines = (progress.data ?? [])
		.filter((l) => l.kind === "expense" && Number(l.planned_amount) > 0)
		.sort((a, b) => Number(b.planned_amount) - Number(a.planned_amount));

	const insight = buildInsight(
		budgetLines,
		pending.data?.length ?? 0,
		currency,
	);
	const greeting = timeGreeting();

	return (
		<>
			<PageHeader
				title={greeting}
				subtitle={
					pending.data?.length
						? `${pending.data.length} capture${
								pending.data.length === 1 ? "" : "s"
							} waiting on you.`
						: "Everything is filed. Nothing needs a look."
				}
			>
				{/* Capture lives on the floating "+" in the shell — a second
                    Add button here would be a duplicate entry point. This reads
                    as a search field rather than a button, because that is what
                    it opens. */}
				<button
					onClick={search.open}
					className="flex w-full items-center gap-2.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-left text-[0.8125rem] text-slate-500 shadow-card transition-colors hover:border-slate-600 hover:text-slate-400 sm:w-[22rem]"
				>
					<SearchIcon size={15} />
					<span className="min-w-0 flex-1 truncate">
						Search transactions, accounts, categories…
					</span>
					<kbd className="hidden shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[0.6875rem] text-slate-500 sm:inline">
						⌘K
					</kbd>
				</button>
			</PageHeader>

			{/* --- Hero: net worth + Sage's read of the month ----------------- */}
			<div className="grid items-start gap-[18px] xl:grid-cols-[1.55fr_1fr]">
				<Card feature>
					<div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
						<div>
							<div className="mb-[7px] text-[0.8125rem] font-semibold text-slate-400">
								Net worth
							</div>
							{latest ? (
								<div className="flex flex-wrap items-baseline gap-3">
									<span className="text-[2.625rem] font-extrabold leading-none tracking-[-0.035em] tnum">
										{fmtMoney(endVal, currency)}
									</span>
									{pctChange !== null && (
										<span
											className={`text-[0.84375rem] font-bold ${
												up ? "text-emerald-400" : "text-rose-400"
											}`}
										>
											{up ? "+" : ""}
											{pctChange.toFixed(1)}%
										</span>
									)}
								</div>
							) : (
								<div className="text-[2.625rem] font-extrabold leading-none text-slate-500">
									—
								</div>
							)}
						</div>
						<Segmented
							options={RANGE_OPTIONS}
							value={range}
							onChange={setRange}
						/>
					</div>

					{rows.length >= 2 ? (
						<NetWorthChart
							points={rows.map((s) => ({
								date: s.as_of,
								value: Number(s.net_worth),
							}))}
							currency={currency}
						/>
					) : (
						<Empty loading={snapshots.isLoading}>
							The trend line appears once there are snapshots on two or more
							days.
						</Empty>
					)}

					<div className="mt-1 flex flex-wrap items-center gap-5 border-t border-slate-800 pt-3.5 text-[0.78125rem] text-slate-400">
						<span className="flex items-center gap-[7px]">
							<LegendDot color={CHART_COLORS.primary} />
							Assets {fmtMoneyCompact(assets, currency)}
						</span>
						{latest && (
							<span className="flex items-center gap-[7px]">
								<LegendDot color={seriesColor(3)} />
								As of {fmtDate(latest.as_of)}
							</span>
						)}
						{debt < 0 && (
							<span className="ml-auto text-slate-500">
								Net of {fmtMoneyCompact(Math.abs(debt), currency)} in debt
							</span>
						)}
					</div>
				</Card>

				<div className="flex min-w-0 flex-col gap-[18px]">
					{/* Sage's one thing worth noticing */}
					<DarkPanel>
						<div className="mb-3 flex items-center gap-2">
							<span className="h-[7px] w-[7px] rounded-full bg-coral" />
							<span className="text-[0.71875rem] font-bold uppercase tracking-[0.1em] text-[#9aa0ad]">
								Sage noticed
							</span>
						</div>
						<p className="mb-2.5 text-lg font-semibold leading-[1.35] tracking-[-0.015em]">
							{insight.headline}
						</p>
						<p className="mb-4 text-[0.8125rem] leading-relaxed text-[#9aa0ad]">
							{insight.detail}
						</p>
						<div className="flex flex-wrap gap-2">
							<Link
								to={insight.to}
								className="sb-btn sb-btn-primary !py-2 !text-[0.78125rem]"
							>
								{insight.cta}
							</Link>
							<Link
								to="/console"
								className="sb-btn !py-2 !text-[0.78125rem] border border-[#2c313d] font-semibold text-[#d5d8de] hover:bg-white/5"
							>
								Ask Sage
							</Link>
						</div>
					</DarkPanel>

					{/* This month's spending, split by category */}
					<Card feature>
						<CardHeader
							title={`${monthLabel} spending`}
							aside={
								<span className="text-[0.78125rem] text-slate-400 tnum">
									{fmtMoney(expense, currency)}
									{income > 0 && ` of ${fmtMoney(income, currency)} in`}
								</span>
							}
						/>
						{spendRows.length > 0 ? (
							<>
								<div className="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
									{spendRows.map((r, i) => (
										<span
											key={`${r.category_group}-${r.category}`}
											style={{
												flex: Number(r.total_amount),
												background: colorFor(r.color, i),
											}}
										/>
									))}
									{spendTotal < expense && (
										<span
											style={{
												flex: expense - spendTotal,
												background: CHART_COLORS.track,
											}}
										/>
									)}
								</div>
								<div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
									{spendRows.map((r, i) => (
										<span
											key={`${r.category_group}-${r.category}`}
											className="flex items-center gap-2 text-[0.78125rem] text-slate-300"
										>
											<LegendDot color={colorFor(r.color, i)} />
											<span className="min-w-0 truncate">{r.category}</span>
											<span className="ml-auto shrink-0 font-bold text-slate-200 tnum">
												{fmtMoneyCompact(Number(r.total_amount), r.currency)}
											</span>
										</span>
									))}
								</div>
							</>
						) : (
							<Empty loading={byCategory.isLoading}>
								No accepted spending yet this month.
							</Empty>
						)}
					</Card>
				</div>
			</div>

			{/* --- Accounts at a glance --------------------------------------- */}
			<Card feature>
				<CardHeader title="Your accounts" to="/accounts" cta="Manage" />
				{activeAccounts.length > 0 ? (
					<div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
						{activeAccounts.slice(0, ACCOUNT_TILES).map((a) => {
							const bal = Number(a.current_balance);
							return (
								<Link
									key={a.id}
									to="/accounts"
									className="sb-nested px-4 py-[0.9375rem] transition-colors hover:brightness-[0.98]"
								>
									<div className="mb-1.5 truncate text-xs text-slate-400">
										{a.name}
									</div>
									<div
										className={`text-lg font-bold tnum ${
											bal < 0 ? "text-rose-400" : "text-slate-100"
										}`}
									>
										{fmtMoney(bal, a.currency)}
									</div>
									<div className="mt-1 text-[0.6875rem] uppercase tracking-wide text-slate-500">
										{accountTypeLabel(a.type)}
									</div>
								</Link>
							);
						})}
					</div>
				) : (
					<Empty loading={balances.isLoading}>
						No accounts yet — add one to start tracking balances.
					</Empty>
				)}
			</Card>

			{/* --- Budget progress + cash flow --------------------------------- */}
			<div className="grid gap-[18px] lg:grid-cols-2">
				<Card feature>
					<CardHeader
						title={budget ? budget.name : "Budgets"}
						to="/budgets"
						cta="View all"
					/>
					{budgetLines.length > 0 ? (
						<div className="flex flex-col gap-4">
							{budgetLines.slice(0, BUDGET_ROWS).map((line, i) => {
								const planned = Number(line.planned_amount);
								const actual = Number(line.actual_amount);
								const pct = planned > 0 ? (actual / planned) * 100 : 0;
								return (
									<MeterRow
										key={line.budget_category_id}
										label={line.label}
										value={`${fmtMoneyCompact(actual, currency)} of ${fmtMoneyCompact(
											planned,
											currency,
										)}`}
										pct={pct}
										color={pct > 100 ? CHART_COLORS.negative : seriesColor(i)}
									/>
								);
							})}
						</div>
					) : (
						<Empty loading={budgets.isLoading || progress.isLoading}>
							No budget lines yet. Set one up to track a plan against reality.
						</Empty>
					)}
				</Card>

				<Card feature className="flex flex-col">
					<CardHeader title="Cash flow this month" />
					<div className="mb-3.5 flex flex-col gap-2.5">
						<FlowRow
							label="Income"
							amount={income}
							max={Math.max(income, expense)}
							currency={currency}
							color={CHART_COLORS.positive}
						/>
						<FlowRow
							label="Expenses"
							amount={expense}
							max={Math.max(income, expense)}
							currency={currency}
							color={CHART_COLORS.negative}
						/>
					</div>
					<div className="mt-auto flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-800 pt-3.5">
						<span className="text-[0.78125rem] text-slate-400">Net saved</span>
						<span
							className={`text-xl font-extrabold tnum ${
								netSaved >= 0 ? "text-emerald-400" : "text-rose-400"
							}`}
						>
							{netSaved >= 0 ? "+" : "−"}
							{fmtMoney(Math.abs(netSaved), currency)}
						</span>
						{savingRate !== null && (
							<Pill tint="green">{savingRate}% rate</Pill>
						)}
					</div>
				</Card>
			</div>

			{/* --- Recent activity + what's coming ----------------------------- */}
			<div className="grid gap-[18px] xl:grid-cols-[1.55fr_1fr]">
				<Card feature>
					<CardHeader
						title="Recent activity"
						to="/transactions"
						cta="View all"
						className="mb-1.5"
					/>
					{(recent.data ?? []).length > 0 ? (
						<div className="flex flex-col">
							{(recent.data ?? []).map((t, i, arr) => {
								const payee = t.payee ?? "(no payee)";
								return (
									<div
										key={t.id}
										className={`flex items-center gap-3.5 py-[11px] ${
											i < arr.length - 1 ? "border-b border-slate-800" : ""
										}`}
									>
										<Avatar label={payee} tint={tintFor(payee)} />
										<div className="min-w-0 flex-1">
											<div className="truncate text-[0.84375rem] font-semibold">
												{payee}
											</div>
											<div className="text-xs text-slate-500">
												{fmtDate(t.occurred_at)}
											</div>
										</div>
										<span
											className={`shrink-0 text-[0.84375rem] font-bold tnum ${
												t.kind === "income"
													? "text-emerald-400"
													: "text-slate-200"
											}`}
										>
											{t.kind === "expense"
												? "−"
												: t.kind === "income"
													? "+"
													: ""}
											{fmtMoney(Number(t.amount), t.currency)}
										</span>
									</div>
								);
							})}
						</div>
					) : (
						<Empty loading={recent.isLoading}>
							No accepted transactions yet.
						</Empty>
					)}
				</Card>

				<DashedCard className="flex flex-col justify-between gap-4">
					<div>
						<h2 className="mb-3 text-[0.8125rem] font-bold text-slate-200">
							Coming up
						</h2>
						{(upcoming.data ?? []).length > 0 ? (
							<div className="flex flex-col gap-3">
								{(upcoming.data ?? []).map((s) => (
									<div
										key={s.id}
										className="flex items-baseline gap-3 text-[0.8125rem]"
									>
										<span className="w-[3.25rem] shrink-0 text-[0.71875rem] font-bold uppercase text-slate-500">
											{shortDate(s.next_due)}
										</span>
										<span className="min-w-0 flex-1 truncate text-slate-300">
											{s.name}
										</span>
										<span className="shrink-0 font-bold tnum">
											{fmtMoney(Number(s.amount), s.currency)}
										</span>
									</div>
								))}
							</div>
						) : (
							<Empty loading={upcoming.isLoading}>Nothing scheduled.</Empty>
						)}
					</div>
					<Link
						to="/console"
						className="flex items-center gap-2.5 rounded-[13px] bg-slate-900 px-3.5 py-2.5 shadow-card transition-colors hover:text-slate-200"
					>
						<MicIcon size={16} className="text-sky-300" />
						<span className="flex-1 text-[0.8125rem] text-slate-500">
							Tell Sage what you spent
						</span>
					</Link>
				</DashedCard>
			</div>
		</>
	);
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function FlowRow({
	label,
	amount,
	max,
	currency,
	color,
}: {
	label: string;
	amount: number;
	max: number;
	currency: string;
	color: string;
}) {
	return (
		<div className="flex items-center gap-2.5">
			<span className="w-[3.625rem] shrink-0 text-xs text-slate-400">
				{label}
			</span>
			<div className="min-w-0 flex-1">
				<Meter
					pct={max > 0 ? (amount / max) * 100 : 0}
					color={color}
					height={10}
				/>
			</div>
			<span className="w-[5.5rem] shrink-0 text-right text-[0.8125rem] font-bold tnum">
				{fmtMoneyCompact(amount, currency)}
			</span>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sumRows(rows: MonthlySummaryRow[]): number {
	return rows.reduce((s, r) => s + Number(r.total_amount), 0);
}

/** Trim the snapshot series to the selected window. */
function sliceRange(
	rows: NetWorthSnapshot[],
	range: Range,
): NetWorthSnapshot[] {
	if (range === "all" || rows.length === 0) return rows;
	const months = range === "6m" ? 6 : 12;
	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - months);
	const iso = cutoff.toISOString().slice(0, 10);
	const windowed = rows.filter((r) => r.as_of >= iso);
	// Keep at least two points so the chart never collapses on a sparse series.
	return windowed.length >= 2 ? windowed : rows.slice(-2);
}

/** "Jul 28" → the compact date the "Coming up" list uses. */
function shortDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "2-digit",
	});
}

function timeGreeting(): string {
	const h = new Date().getHours();
	if (h < 12) return "Good morning";
	if (h < 18) return "Good afternoon";
	return "Good evening";
}

/** Sage's single observation: the worst budget overrun if there is one, else
 *  the inbox, else a quiet all-clear. Keeps the panel meaningful with real
 *  data instead of showing a placeholder. */
function buildInsight(
	lines: Array<{
		label: string;
		planned_amount: number;
		actual_amount: number;
	}>,
	pendingCount: number,
	currency: string,
): { headline: string; detail: string; cta: string; to: string } {
	const over = lines
		.map((l) => ({
			...l,
			over: Number(l.actual_amount) - Number(l.planned_amount),
		}))
		.filter((l) => l.over > 0)
		.sort((a, b) => b.over - a.over)[0];

	if (over) {
		const pct = Math.round((over.over / Number(over.planned_amount)) * 100);
		return {
			headline: `${over.label} is running ${pct}% over its budget.`,
			detail: `${fmtMoney(Number(over.actual_amount), currency)} spent of ${fmtMoney(
				Number(over.planned_amount),
				currency,
			)}.`,
			cta: "Review budget",
			to: "/budgets",
		};
	}

	if (pendingCount > 0) {
		return {
			headline: `${pendingCount} capture${pendingCount === 1 ? "" : "s"} are waiting to be filed.`,
			detail: "Accepting them keeps balances, budgets and net worth accurate.",
			cta: "Open inbox",
			to: "/transactions/review",
		};
	}

	return {
		headline: "Nothing is off track right now.",
		detail: "Every capture is filed and no budget line is over its plan.",
		cta: "See reports",
		to: "/reports",
	};
}
