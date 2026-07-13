import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { requireSupabase } from "../lib/supabase";
import { useTheme } from "../lib/useTheme";
import IngestModal from "./ingest/IngestModal";
import ImportProgress from "./ingest/ImportProgress";

type IconName =
    | "overview"
    | "inbox"
    | "transactions"
    | "accounts"
    | "categories"
    | "rules"
    | "scheduled"
    | "reports"
    | "networth"
    | "activity";

const NAV: { to: string; label: string; icon: IconName }[] = [
    { to: "/", label: "Overview", icon: "overview" },
    { to: "/inbox", label: "Inbox", icon: "inbox" },
    { to: "/transactions", label: "Transactions", icon: "transactions" },
    { to: "/accounts", label: "Accounts", icon: "accounts" },
    { to: "/categories", label: "Categories", icon: "categories" },
    { to: "/rules", label: "Rules", icon: "rules" },
    { to: "/scheduled", label: "Scheduled", icon: "scheduled" },
    { to: "/reports", label: "Reports", icon: "reports" },
    { to: "/net-worth", label: "Net worth", icon: "networth" },
    { to: "/activity", label: "Activity", icon: "activity" },
];

export default function AppShell() {
    const navigate = useNavigate();
    const location = useLocation();
    const [params] = useSearchParams();
    const [open, setOpen] = useState(false);
    const { theme, toggle: toggleTheme } = useTheme();
    const [email, setEmail] = useState<string | null>(null);
    const [ingestOpen, setIngestOpen] = useState(false);
    const [ingestText, setIngestText] = useState("");

    // Close the mobile drawer whenever the route changes.
    useEffect(() => setOpen(false), [location.pathname]);

    // Deep links / the PWA share target land on /capture or /import — open the
    // ingest modal (prefilled from any shared text) instead of a standalone page.
    useEffect(() => {
        if (location.pathname === "/capture" || location.pathname === "/import") {
            const shared = [params.get("title"), params.get("text"), params.get("url")]
                .filter(Boolean)
                .join("\n");
            setIngestText(shared);
            setIngestOpen(true);
        }
        // params is derived from the URL; pathname changing is the trigger we want.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    function openIngest() {
        setIngestText("");
        setIngestOpen(true);
    }

    function closeIngest() {
        setIngestOpen(false);
        // Leave the /capture|/import URL so the effect above doesn't re-open it.
        if (location.pathname === "/capture" || location.pathname === "/import") {
            navigate("/", { replace: true });
        }
    }

    useEffect(() => {
        requireSupabase()
            .auth.getUser()
            .then(({ data }) => setEmail(data.user?.email ?? null))
            .catch(() => {});
    }, []);

    async function signOut() {
        await requireSupabase().auth.signOut();
        navigate("/");
    }

    const name = email ? email.split("@")[0] : "there";
    const initial = (email?.[0] ?? "S").toUpperCase();

    return (
        <div className="flex min-h-screen bg-paper">
            {/* Backdrop (mobile only, when drawer is open) */}
            {open && (
                <button
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
                />
            )}

            {/* Sidebar — static on desktop, slide-over drawer on mobile */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-sidebar p-4 transition-transform duration-300 ease-out lg:static lg:z-auto lg:translate-x-0 ${
                    open ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                {/* Brand */}
                <div className="mb-6 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
                            <BookIcon />
                        </span>
                        <span className="text-lg font-semibold tracking-tight text-white">
                            <span className="text-emerald-400">Sage</span>book
                        </span>
                    </div>
                    <button
                        aria-label="Close menu"
                        onClick={() => setOpen(false)}
                        className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
                    >
                        <CloseIcon />
                    </button>
                </div>

                {/* Welcome / avatar */}
                <div className="mb-5 flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm font-semibold text-white">
                        {initial}
                    </span>
                    <div className="min-w-0">
                        <p className="text-[0.7rem] uppercase tracking-wide text-white/40">
                            Welcome back
                        </p>
                        <p className="truncate text-sm font-medium capitalize text-white/90">
                            {name}
                        </p>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
                    {NAV.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === "/"}
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                                    isActive
                                        ? "bg-white font-medium text-sidebar shadow-sm"
                                        : "text-white/65 hover:bg-white/10 hover:text-white"
                                }`
                            }
                        >
                            <Icon name={item.icon} />
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <button
                    onClick={toggleTheme}
                    className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/55 hover:bg-white/10 hover:text-white"
                >
                    {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button
                    onClick={signOut}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/55 hover:bg-white/10 hover:text-white"
                >
                    <LogoutIcon />
                    Sign out
                </button>
            </aside>

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Mobile top bar */}
                <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
                    <button
                        aria-label="Open menu"
                        onClick={() => setOpen(true)}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
                    >
                        <MenuIcon />
                    </button>
                    <span className="text-base font-semibold tracking-tight">
                        <span className="text-emerald-500">Sage</span>book
                    </span>
                </header>

                <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>

            {/* Floating "+" — the single entry point for all ingestion */}
            <button
                aria-label="Add"
                onClick={openIngest}
                className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white shadow-pop transition-transform hover:scale-105 hover:bg-emerald-500 active:scale-95"
            >
                <PlusIcon />
            </button>

            <IngestModal open={ingestOpen} onClose={closeIngest} initialText={ingestText} />

            {/* Persistent background-import progress, visible on every page. */}
            <ImportProgress />
        </div>
    );
}

/* --- Icons (inline, stroke-based line set) ------------------------------- */

function Svg({ children }: { children: React.ReactNode }) {
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

function Icon({ name }: { name: IconName }) {
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
    }
}

function BookIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v13H6a2 2 0 0 0-2 2z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
            />
            <path
                d="M4 19a2 2 0 0 0 2 2h12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
            />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function MenuIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <Svg>
            <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
            <path d="M10 12h9m0 0-3-3m3 3-3 3" />
            <path d="M10 12H3" />
        </Svg>
    );
}

function SunIcon() {
    return (
        <Svg>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </Svg>
    );
}

function MoonIcon() {
    return (
        <Svg>
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
        </Svg>
    );
}
