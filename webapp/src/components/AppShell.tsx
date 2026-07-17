import { type FormEvent, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { requireSupabase } from "../lib/supabase";
import { useTheme } from "../lib/useTheme";
import { Icon, NAV, navItem, Svg } from "./nav";
import IngestModal from "./ingest/IngestModal";
import ImportProgress from "./ingest/ImportProgress";

// The top bar only has room for a few destinations. Overview is always pinned
// first; the next RECENT_LIMIT slots track the most-recently-visited pages, so
// the bar quietly follows where you work. Everything else lives behind "Apps".
const RECENT_KEY = "sb-nav-recent";
const RECENT_LIMIT = 2; // Overview (pinned) + these + the Apps button = 4 slots
const DEFAULT_RECENT = ["/transactions", "/inbox"];

function loadRecent(): string[] {
    try {
        const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "null");
        if (Array.isArray(raw)) {
            const valid = raw.filter((r) => typeof r === "string" && r !== "/" && navItem(r));
            if (valid.length) return valid.slice(0, RECENT_LIMIT);
        }
    } catch {
        /* ignore malformed storage */
    }
    return DEFAULT_RECENT;
}

export default function AppShell() {
    const navigate = useNavigate();
    const location = useLocation();
    const [params] = useSearchParams();
    const [open, setOpen] = useState(false);
    const { theme, toggle: toggleTheme } = useTheme();
    const [email, setEmail] = useState<string | null>(null);
    const [ingestOpen, setIngestOpen] = useState(false);
    const [ingestText, setIngestText] = useState("");
    const [captureText, setCaptureText] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [appsOpen, setAppsOpen] = useState(false);
    const [recent, setRecent] = useState<string[]>(loadRecent);

    // Close the mobile drawer + the Apps popup whenever the route changes.
    useEffect(() => {
        setOpen(false);
        setAppsOpen(false);
    }, [location.pathname]);

    // Track visited pages so the top bar keeps the current one within reach.
    // New destinations are prepended; existing ones keep their slot (no reshuffle
    // on every click), and the oldest drops off past the limit. Overview is
    // pinned separately, so it never occupies a recent slot.
    useEffect(() => {
        const path = location.pathname;
        if (path === "/" || !navItem(path)) return;
        setRecent((prev) => (prev.includes(path) ? prev : [path, ...prev].slice(0, RECENT_LIMIT)));
    }, [location.pathname]);

    useEffect(() => {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    }, [recent]);

    // Pinned Overview + the recent slots — the routes shown as top-bar pills.
    const topNav = ["/", ...recent];

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

    // Typing in the top-bar "capture" field and pressing Enter is the fast path
    // into the ingest modal — mapping Twisty's prominent search bar onto
    // Sagebook's capture-first core.
    function submitCapture(e: FormEvent) {
        e.preventDefault();
        setIngestText(captureText);
        setIngestOpen(true);
        setCaptureText("");
    }

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-paper">
            {/* ---- Top navigation bar (Twisty-style) — fixed above the scroll  */}
            <header className="z-30 shrink-0 border-b border-slate-800 bg-paper/85 backdrop-blur">
                <div className="flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6">
                    {/* Hamburger (below lg) + brand */}
                    <button
                        aria-label="Open menu"
                        onClick={() => setOpen(true)}
                        className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 lg:hidden"
                    >
                        <MenuIcon />
                    </button>
                    <Link to="/" className="flex shrink-0 items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-coral text-white shadow-sm">
                            <BookIcon />
                        </span>
                        <span className="text-lg font-semibold tracking-tight text-slate-200">
                            Sage<span className="text-coral">book</span>
                        </span>
                    </Link>

                    {/* Primary nav — pinned Overview + recent pages on lg+; the
                        full set lives behind the "Apps" launcher. */}
                    <nav className="ml-1 hidden min-w-0 flex-1 items-center gap-1 lg:flex">
                        {topNav.map((to) => {
                            const item = navItem(to);
                            if (!item) return null;
                            return (
                                <NavLink
                                    key={to}
                                    to={to}
                                    end={to === "/"}
                                    className={({ isActive }) =>
                                        `shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                                            isActive
                                                ? "bg-coral-soft font-semibold text-coral-ink"
                                                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                                        }`
                                    }
                                >
                                    {item.label}
                                </NavLink>
                            );
                        })}

                        <div className="relative">
                            <button
                                onClick={() => setAppsOpen((v) => !v)}
                                aria-label="All apps"
                                aria-expanded={appsOpen}
                                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                                    appsOpen
                                        ? "bg-slate-800 text-slate-200"
                                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                                }`}
                            >
                                <GridIcon />
                                Apps
                            </button>
                            {appsOpen && (
                                <>
                                    <button
                                        aria-hidden
                                        tabIndex={-1}
                                        onClick={() => setAppsOpen(false)}
                                        className="fixed inset-0 z-40 cursor-default"
                                    />
                                    <div className="absolute left-0 top-11 z-50 w-[340px] rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-pop">
                                        <p className="px-2 pb-1.5 pt-1 text-[0.7rem] font-medium uppercase tracking-wide text-slate-500">
                                            All apps
                                        </p>
                                        <div className="grid grid-cols-3 gap-1">
                                            {NAV.map((item) => {
                                                const active = location.pathname === item.to;
                                                return (
                                                    <Link
                                                        key={item.to}
                                                        to={item.to}
                                                        onClick={() => setAppsOpen(false)}
                                                        className={`flex flex-col items-center gap-2 rounded-xl px-2 py-3 text-center transition-colors ${
                                                            active
                                                                ? "bg-coral-soft text-coral-ink"
                                                                : "text-slate-300 hover:bg-slate-950"
                                                        }`}
                                                    >
                                                        <span
                                                            className={`grid h-9 w-9 place-items-center rounded-lg ${
                                                                active ? "bg-coral/15" : "bg-slate-950"
                                                            }`}
                                                        >
                                                            <Icon name={item.icon} />
                                                        </span>
                                                        <span className="text-xs font-medium leading-tight">
                                                            {item.label}
                                                        </span>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </nav>

                    {/* Right cluster: capture, theme, avatar */}
                    <div className="ml-auto flex items-center gap-2 sm:gap-3">
                        <form onSubmit={submitCapture} className="hidden sm:block">
                            <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3.5 py-2 shadow-sm focus-within:border-coral/60 focus-within:ring-2 focus-within:ring-coral/20">
                                <SearchIcon />
                                <input
                                    value={captureText}
                                    onChange={(e) => setCaptureText(e.target.value)}
                                    placeholder="Capture anything…"
                                    className="w-28 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none lg:w-40 xl:w-52"
                                />
                            </div>
                        </form>

                        {/* Sage — the financial voice (the generative console) */}
                        <Link
                            to="/console"
                            aria-label="Open Sage — the financial voice"
                            className="flex shrink-0 items-center gap-1.5 rounded-full bg-coral px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-coral-600"
                        >
                            <SparkIcon />
                            <span className="hidden sm:inline">Ask Sage</span>
                        </Link>

                        <button
                            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                            onClick={toggleTheme}
                            className="grid h-10 w-10 place-items-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 shadow-sm hover:text-slate-200"
                        >
                            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                        </button>

                        <div className="relative">
                            <button
                                onClick={() => setMenuOpen((v) => !v)}
                                aria-label="Account menu"
                                className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-coral-400 to-coral-600 text-sm font-semibold text-white shadow-sm ring-2 ring-slate-900 transition-transform hover:scale-105"
                            >
                                {initial}
                            </button>
                            {menuOpen && (
                                <>
                                    <button
                                        aria-hidden
                                        tabIndex={-1}
                                        onClick={() => setMenuOpen(false)}
                                        className="fixed inset-0 z-40 cursor-default"
                                    />
                                    <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-pop">
                                        <div className="border-b border-slate-800 px-4 py-3">
                                            <p className="text-[0.7rem] uppercase tracking-wide text-slate-500">
                                                Welcome back
                                            </p>
                                            <p className="truncate text-sm font-medium capitalize text-slate-200">
                                                {name}
                                            </p>
                                        </div>
                                        <NavLink
                                            to="/settings"
                                            onClick={() => setMenuOpen(false)}
                                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                                        >
                                            <Icon name="settings" />
                                            Settings
                                        </NavLink>
                                        <button
                                            onClick={() => {
                                                setMenuOpen(false);
                                                signOut();
                                            }}
                                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-800"
                                        >
                                            <LogoutIcon />
                                            Sign out
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* ---- Mobile slide-over drawer (below lg) ---------------------- */}
            {open && (
                <button
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
                />
            )}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-sidebar p-4 transition-transform duration-300 ease-out lg:hidden ${
                    open ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="mb-6 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-coral text-white">
                            <BookIcon />
                        </span>
                        <span className="text-lg font-semibold tracking-tight text-white">
                            Sage<span className="text-coral-400">book</span>
                        </span>
                    </div>
                    <button
                        aria-label="Close menu"
                        onClick={() => setOpen(false)}
                        className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                    >
                        <CloseIcon />
                    </button>
                </div>

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

            {/* ---- Main content — the only scrolling region ---------------- */}
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                <Outlet />
            </main>

            {/* Floating "+" — the single entry point for all ingestion */}
            <button
                aria-label="Add"
                onClick={openIngest}
                className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-coral text-white shadow-pop transition-transform hover:scale-105 hover:bg-coral-600 active:scale-95"
            >
                <PlusIcon />
            </button>

            <IngestModal open={ingestOpen} onClose={closeIngest} initialText={ingestText} />

            {/* Persistent background-import progress, visible on every page. */}
            <ImportProgress />
        </div>
    );
}

/* --- Icons local to the shell chrome ------------------------------------- */

function GridIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
            <rect x="4" y="4" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="4" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="4" y="14" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
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

function SparkIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
            <path
                d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function SearchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-slate-500">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
