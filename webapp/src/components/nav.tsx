/* Shared navigation model + icon set, used by the AppShell top bar / Apps
   launcher and by dashboard quick-actions. Kept in one place so the icon for a
   route is always consistent wherever it appears. */

export type IconName =
    | "overview"
    | "inbox"
    | "transactions"
    | "accounts"
    | "categories"
    | "rules"
    | "scheduled"
    | "budgets"
    | "reports"
    | "networth"
    | "activity"
    | "settings";

export interface NavItem {
    to: string;
    label: string;
    icon: IconName;
}

export const NAV: NavItem[] = [
    { to: "/", label: "Overview", icon: "overview" },
    { to: "/inbox", label: "Inbox", icon: "inbox" },
    { to: "/transactions", label: "Transactions", icon: "transactions" },
    { to: "/accounts", label: "Accounts", icon: "accounts" },
    { to: "/categories", label: "Categories", icon: "categories" },
    { to: "/rules", label: "Rules", icon: "rules" },
    { to: "/scheduled", label: "Scheduled", icon: "scheduled" },
    { to: "/budgets", label: "Budgets", icon: "budgets" },
    { to: "/reports", label: "Reports", icon: "reports" },
    { to: "/net-worth", label: "Net worth", icon: "networth" },
    { to: "/activity", label: "Activity", icon: "activity" },
    { to: "/settings", label: "Settings", icon: "settings" },
];

/** Look up a nav item by its route. */
export function navItem(to: string): NavItem | undefined {
    return NAV.find((n) => n.to === to);
}

export function Svg({ children }: { children: React.ReactNode }) {
    return (
        <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="shrink-0"
        >
            {children}
        </svg>
    );
}

export function Icon({ name }: { name: IconName }) {
    switch (name) {
        case "overview":
            return (
                <Svg>
                    <rect x="4" y="4" width="7" height="9" rx="1.5" />
                    <rect x="4" y="16" width="7" height="4" rx="1.5" />
                    <rect x="14" y="4" width="6" height="4" rx="1.5" />
                    <rect x="14" y="11" width="6" height="9" rx="1.5" />
                </Svg>
            );
        case "inbox":
            return (
                <Svg>
                    <path d="M4 13h4l1.5 3h5L16 13h4" />
                    <path d="M5 13 7 5h10l2 8v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
                </Svg>
            );
        case "transactions":
            return (
                <Svg>
                    <path d="M6 3h9l3 3v15l-2-1-2 1-2-1-2 1-2-1-2 1V4a1 1 0 0 1 1-1z" />
                    <path d="M9 8h6M9 12h6M9 16h4" />
                </Svg>
            );
        case "accounts":
            return (
                <Svg>
                    <path d="M3 10 12 4l9 6" />
                    <path d="M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18" />
                </Svg>
            );
        case "categories":
            return (
                <Svg>
                    <rect x="4" y="4" width="7" height="7" rx="1.5" />
                    <rect x="13" y="4" width="7" height="7" rx="1.5" />
                    <rect x="4" y="13" width="7" height="7" rx="1.5" />
                    <rect x="13" y="13" width="7" height="7" rx="1.5" />
                </Svg>
            );
        case "rules":
            return (
                <Svg>
                    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
                    <circle cx="16" cy="6" r="2" />
                    <circle cx="8" cy="12" r="2" />
                    <circle cx="14" cy="18" r="2" />
                </Svg>
            );
        case "scheduled":
            return (
                <Svg>
                    <rect x="4" y="5" width="16" height="16" rx="2" />
                    <path d="M4 9h16M8 3v4M16 3v4" />
                    <path d="M12 13v3l2 1" />
                </Svg>
            );
        case "budgets":
            return (
                <Svg>
                    <path d="M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" />
                    <path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                    <path d="M12 12v4M10 14h4" />
                </Svg>
            );
        case "reports":
            return (
                <Svg>
                    <path d="M4 20V4M20 20H4" />
                    <rect x="7" y="12" width="3" height="5" rx="0.5" />
                    <rect x="12" y="8" width="3" height="9" rx="0.5" />
                    <rect x="17" y="10" width="3" height="7" rx="0.5" />
                </Svg>
            );
        case "networth":
            return (
                <Svg>
                    <path d="M3 17l5-5 3 3 4-6 3 4" />
                    <path d="M3 21h18" />
                    <path d="M16 6h4v4" />
                </Svg>
            );
        case "activity":
            return (
                <Svg>
                    <path d="M3 12h4l2 6 4-14 2 8h6" />
                </Svg>
            );
        case "settings":
            return (
                <Svg>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </Svg>
            );
    }
}
