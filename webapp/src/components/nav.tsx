/* Shared navigation model + icon set, used by the AppShell sidebar and by
   dashboard quick-actions. Kept in one place so the icon for a route is always
   consistent wherever it appears.

   Icons follow the design's line language: 24px box, 1.9 stroke, round caps,
   drawn from as few strokes as possible. */

export type IconName =
	| "overview"
	| "inbox"
	| "documents"
	| "transactions"
	| "duplicates"
	| "accounts"
	| "categories"
	| "rules"
	| "scheduled"
	| "budgets"
	| "reports"
	| "networth"
	| "activity"
	| "settings";

/** Sidebar sections, in the order the design stacks them. */
export type NavGroup = "money" | "plan" | "insight";

export interface NavItem {
	to: string;
	label: string;
	icon: IconName;
	group: NavGroup;
}

export const NAV: NavItem[] = [
	{ to: "/", label: "Overview", icon: "overview", group: "money" },
	{
		to: "/transactions",
		label: "Ledger",
		icon: "transactions",
		group: "money",
	},
	{ to: "/accounts", label: "Accounts", icon: "accounts", group: "money" },
	{ to: "/budgets", label: "Budgets", icon: "budgets", group: "plan" },
	{ to: "/scheduled", label: "Scheduled", icon: "scheduled", group: "plan" },
	{ to: "/categories", label: "Categories", icon: "categories", group: "plan" },
	{ to: "/reports", label: "Reports", icon: "reports", group: "insight" },
	{ to: "/net-worth", label: "Net worth", icon: "networth", group: "insight" },
	{ to: "/activity", label: "Activity", icon: "activity", group: "insight" },
	{ to: "/settings", label: "Settings", icon: "settings", group: "insight" },
];

export const NAV_GROUPS: Array<{ id: NavGroup; label: string }> = [
	{ id: "money", label: "Money" },
	{ id: "plan", label: "Plan" },
	{ id: "insight", label: "Insight" },
];

/** The Ledger hub's tabs — the money flow in one place. Each tab is a real
 *  route under /transactions so deep links (search hits, the ?doc= capture
 *  link) and the review/duplicate flows keep stable URLs. */
export interface LedgerTab {
	to: string;
	label: string;
	icon: IconName;
}

export const LEDGER_TABS: LedgerTab[] = [
	{ to: "/transactions", label: "Ledger", icon: "transactions" },
	{ to: "/transactions/review", label: "Needs review", icon: "inbox" },
	{ to: "/transactions/duplicates", label: "Duplicates", icon: "duplicates" },
	{ to: "/transactions/documents", label: "Documents", icon: "documents" },
];

/** Sections of the Settings sub-app. These configure the pipeline rather than
 *  record money, which is why they sit behind Settings and not on the rail. */
export const SETTINGS_NAV: Array<{
	to: string;
	label: string;
	icon: IconName;
	description: string;
}> = [
	{
		to: "/settings/ingestion",
		label: "Ingestion",
		icon: "inbox",
		description: "Your forwarding address and how captures get in",
	},
	{
		to: "/settings/rules",
		label: "Rules",
		icon: "rules",
		description: "Auto-categorise recurring payees on the way in",
	},
];

/** Look up a nav item by its route. Hub routes resolve to their parent so
 *  /transactions/review (and the like) read as "Ledger" wherever the label is
 *  shown — the Sage context line and the rail's active state included. */
export function navItem(to: string): NavItem | undefined {
	const exact = NAV.find((n) => n.to === to);
	if (exact) return exact;
	return NAV.find((n) => to.startsWith(n.to + "/"));
}

export function Svg({
	children,
	size = 18,
}: {
	children: React.ReactNode;
	size?: number;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
			className="shrink-0"
		>
			{children}
		</svg>
	);
}

export function Icon({ name, size }: { name: IconName; size?: number }) {
	switch (name) {
		case "overview":
			return (
				<Svg size={size}>
					<path d="M4 12 12 5l8 7" />
					<path d="M6 11v8h12v-8" />
				</Svg>
			);
		case "inbox":
			return (
				<Svg size={size}>
					<path d="M4 13h4l1.5 3h5L16 13h4" />
					<path d="M5 13 7 5h10l2 8v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
				</Svg>
			);
		case "documents":
			return (
				<Svg size={size}>
					<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
					<path d="M14 3v4h4M9 12h6M9 16h6" />
				</Svg>
			);
		case "transactions":
			return (
				<Svg size={size}>
					<path d="M4 7h12M4 12h8M4 17h14" />
				</Svg>
			);
		case "duplicates":
			return (
				<Svg size={size}>
					{/* Two stacked copies of the same page — a charge recorded twice. */}
					<path d="M9 5h6l4 4v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
					<path d="M15 5v4h4" />
					<path d="M6 9H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2" />
				</Svg>
			);
		case "accounts":
			return (
				<Svg size={size}>
					<rect x="3" y="6" width="18" height="13" rx="3" />
					<path d="M3 11h18" />
				</Svg>
			);
		case "categories":
			return (
				<Svg size={size}>
					<rect x="4" y="4" width="7" height="7" rx="2" />
					<rect x="13" y="4" width="7" height="7" rx="2" />
					<rect x="4" y="13" width="7" height="7" rx="2" />
					<rect x="13" y="13" width="7" height="7" rx="2" />
				</Svg>
			);
		case "rules":
			return (
				<Svg size={size}>
					<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
					<circle cx="16" cy="6" r="2" />
					<circle cx="8" cy="12" r="2" />
					<circle cx="14" cy="18" r="2" />
				</Svg>
			);
		case "scheduled":
			return (
				<Svg size={size}>
					<rect x="4" y="5" width="16" height="16" rx="3" />
					<path d="M4 10h16M9 3v4M15 3v4" />
				</Svg>
			);
		case "budgets":
			return (
				<Svg size={size}>
					<circle cx="12" cy="12" r="8" />
					<path d="M12 4a8 8 0 0 1 8 8h-8z" />
				</Svg>
			);
		case "reports":
			return (
				<Svg size={size}>
					<rect x="4" y="4" width="16" height="16" rx="4" />
					<path d="M8 15v-3M12 15V9M16 15v-5" />
				</Svg>
			);
		case "networth":
			return (
				<Svg size={size}>
					<path d="M4 17l4.5-5 3 3L16 8" />
					<path d="M13 8h3v3" />
					<path d="M4 21h16" />
				</Svg>
			);
		case "activity":
			return (
				<Svg size={size}>
					<path d="M3 12h4l2 6 4-14 2 8h6" />
				</Svg>
			);
		case "settings":
			return (
				<Svg size={size}>
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</Svg>
			);
	}
}

/** The Sagebook mark — a sage leaf, used in the sidebar and mobile top bar. */
export function BrandMark({ size = 17 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M12 21c0-5 3-8 8-9-1 6-4 9-8 9z" />
			<path d="M12 21c0-6-3-9-8-10 1 7 4 10 8 10z" />
			<path d="M12 21V9" />
		</svg>
	);
}
