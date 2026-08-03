import { NavLink } from "react-router-dom";
import { useDuplicateGroups, usePendingReview } from "../lib/queries";
import { Icon, LEDGER_TABS } from "./nav";

/** The Ledger hub's tab bar — the money flow in one place. Tabs carry live
 *  work counts so "is there anything waiting" never needs a visit to find
 *  out: the review queue and the duplicate scan report their own badges. */
export default function LedgerTabs() {
	const pending = usePendingReview();
	const dups = useDuplicateGroups();
	const pendingCount = pending.data?.length ?? 0;
	const dupCount = dups.data?.length ?? 0;

	return (
		<nav
			aria-label="Ledger views"
			className="mb-5 flex w-full max-w-[860px] flex-wrap items-center gap-1.5"
		>
			{LEDGER_TABS.map((tab) => {
				const count =
					tab.to === "/transactions/review"
						? pendingCount
						: tab.to === "/transactions/duplicates"
							? dupCount
							: 0;
				return (
					<NavLink
						key={tab.to}
						to={tab.to}
						end={tab.to === "/transactions"}
						className={({ isActive }) =>
							`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.84375rem] font-semibold transition-colors ${
								isActive
									? "bg-coral text-coral-fg"
									: "bg-chip text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
							}`
						}
					>
						{({ isActive }) => (
							<>
								<Icon name={tab.icon} size={15} />
								{tab.label}
								{count > 0 && (
									<span
										className={`min-w-[1.125rem] rounded-full px-1 text-center text-[0.6875rem] font-bold leading-[1.125rem] ${
											isActive
												? "bg-coral-fg text-coral"
												: "bg-coral text-coral-fg"
										}`}
									>
										{count}
									</span>
								)}
							</>
						)}
					</NavLink>
				);
			})}
		</nav>
	);
}
