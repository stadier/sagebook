import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { currentBudget, useBudgetProgress, useBudgets, usePendingReview } from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { CHART_COLORS } from "../lib/theme";
import { useTheme } from "../lib/useTheme";
import { LogoutIcon, MenuIcon, PlusIcon, ThemeIcon } from "./icons";
import { BrandMark, Icon, NAV, NAV_GROUPS } from "./nav";
import IngestModal from "./ingest/IngestModal";
import ImportProgress from "./ingest/ImportProgress";

/* The shell is a fixed dark rail plus a single scrolling column, exactly as in
   the design: the sidebar never scrolls with the page, and it stays navy in
   both themes so the app always has one constant anchor. Below `lg` the rail
   becomes a slide-over drawer behind a sticky mobile top bar. */

export default function AppShell() {
    const navigate = useNavigate();
    const location = useLocation();
    const [params] = useSearchParams();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { theme, toggle: toggleTheme } = useTheme();
    const [email, setEmail] = useState<string | null>(null);
    const [ingestOpen, setIngestOpen] = useState(false);
    const [ingestText, setIngestText] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);

    const pending = usePendingReview();
    const pendingCount = pending.data?.length ?? 0;

    // Close the drawer + the account menu whenever the route changes.
    useEffect(() => {
        setDrawerOpen(false);
        setMenuOpen(false);
    }, [location.pathname]);

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

    useEffect(() => {
        requireSupabase()
            .auth.getUser()
            .then(({ data }) => setEmail(data.user?.email ?? null))
            .catch(() => {});
    }, []);

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

    async function signOut() {
        await requireSupabase().auth.signOut();
        navigate("/");
    }

    const name = email ? email.split("@")[0] : "there";
    const initial = (email?.[0] ?? "S").toUpperCase();

    return (
        <div className="flex h-screen w-full overflow-hidden bg-paper text-slate-200">
            {/* Drawer backdrop (below lg only) */}
            {drawerOpen && (
                <button
                    aria-label="Close menu"
                    onClick={() => setDrawerOpen(false)}
                    className="fixed inset-0 z-[55] bg-black/50 lg:hidden"
                />
            )}

            <Sidebar
                open={drawerOpen}
                pendingCount={pendingCount}
                name={name}
                initial={initial}
                theme={theme}
                onToggleTheme={toggleTheme}
                onSignOut={signOut}
                menuOpen={menuOpen}
                setMenuOpen={setMenuOpen}
            />

            <main className="h-full min-w-0 flex-1 overflow-y-auto">
                {/* Sticky mobile top bar — hamburger, brand, theme */}
                <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
                    <button
                        aria-label="Open menu"
                        onClick={() => setDrawerOpen(true)}
                        className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-chip text-slate-200"
                    >
                        <MenuIcon />
                    </button>
                    <Link to="/" className="flex items-center gap-2">
                        <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-coral text-coral-fg">
                            <BrandMark size={14} />
                        </span>
                        <span className="text-[0.9375rem] font-extrabold tracking-tight">Sagebook</span>
                    </Link>
                    <button
                        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        onClick={toggleTheme}
                        className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-lg bg-chip text-slate-200"
                    >
                        <ThemeIcon theme={theme} />
                    </button>
                </div>

                <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 pb-12 pt-5 sm:px-6 sm:pb-14 sm:pt-7 lg:px-10 lg:pb-16 lg:pt-8">
                    <Outlet />
                </div>
            </main>

            {/* Floating "+" — the single entry point for all ingestion */}
            <button
                aria-label="Add"
                onClick={openIngest}
                className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-coral text-coral-fg shadow-pop transition-transform hover:scale-105 hover:bg-coral-600 active:scale-95"
            >
                <PlusIcon size={24} />
            </button>

            <IngestModal open={ingestOpen} onClose={closeIngest} initialText={ingestText} />

            {/* Persistent background-import progress, visible on every page. */}
            <ImportProgress />
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

function Sidebar({
    open,
    pendingCount,
    name,
    initial,
    theme,
    onToggleTheme,
    onSignOut,
    menuOpen,
    setMenuOpen,
}: {
    open: boolean;
    pendingCount: number;
    name: string;
    initial: string;
    theme: string;
    onToggleTheme: () => void;
    onSignOut: () => void;
    menuOpen: boolean;
    setMenuOpen: (v: boolean) => void;
}) {
    return (
        <aside
            className={`fixed inset-y-0 left-0 z-[60] flex h-full w-[248px] shrink-0 flex-col overflow-y-auto bg-sidebar px-3.5 pb-4 pt-5 text-[#eef0f4] transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
                open ? "translate-x-0 shadow-[0_0_40px_rgba(0,0,0,0.4)]" : "-translate-x-full"
            }`}
        >
            <Link to="/" className="flex items-center gap-2.5 px-2.5 pb-6">
                <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-coral text-coral-fg">
                    <BrandMark />
                </span>
                <span className="text-[1.0625rem] font-extrabold tracking-tight">Sagebook</span>
            </Link>

            <nav className="flex flex-col gap-3">
                {NAV_GROUPS.map((group, gi) => (
                    <div key={group.id} className="flex flex-col gap-[3px]">
                        {gi > 0 && (
                            <div className="px-3.5 pb-2 pt-3 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[#767d8c]">
                                {group.label}
                            </div>
                        )}
                        {NAV.filter((n) => n.group === group.id).map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.to === "/"}
                                className={({ isActive }) =>
                                    `flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
                                        isActive
                                            ? "bg-coral font-bold text-coral-fg"
                                            : "font-medium text-[#9aa0ad] hover:bg-white/[0.06] hover:text-[#eef0f4]"
                                    }`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Icon name={item.icon} size={17} />
                                        {item.label}
                                        {item.to === "/inbox" && pendingCount > 0 && (
                                            <span
                                                className={`ml-auto text-[0.6875rem] font-bold ${
                                                    isActive ? "text-coral-fg" : "text-[#767d8c]"
                                                }`}
                                            >
                                                {pendingCount}
                                            </span>
                                        )}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </div>
                ))}
            </nav>

            <SidebarBudgets />

            {/* User footer — identity, plan, theme */}
            <div className="relative mt-auto flex items-center gap-2.5 pt-4">
                <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]"
                    aria-label="Account menu"
                    aria-expanded={menuOpen}
                >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ffb443] text-[0.8125rem] font-bold text-[#191d24]">
                        {initial}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-semibold capitalize">
                            {name}
                        </span>
                        <span className="block text-[0.71875rem] text-[#767d8c]">Free plan</span>
                    </span>
                </button>
                <button
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    onClick={onToggleTheme}
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[#2c313d] text-[#d5d8de] transition-colors hover:text-white"
                >
                    <ThemeIcon theme={theme} size={15} />
                </button>

                {menuOpen && (
                    <>
                        <button
                            aria-hidden
                            tabIndex={-1}
                            onClick={() => setMenuOpen(false)}
                            className="fixed inset-0 z-40 cursor-default"
                        />
                        <div className="absolute bottom-[calc(100%+0.25rem)] left-0 z-50 w-[210px] overflow-hidden rounded-xl bg-[#2c313d] py-1 shadow-[0_12px_34px_rgba(0,0,0,0.45)]">
                            <NavLink
                                to="/settings"
                                onClick={() => setMenuOpen(false)}
                                className="flex items-center gap-2.5 px-3.5 py-2.5 text-[0.8125rem] text-[#d5d8de] hover:bg-white/10"
                            >
                                <Icon name="settings" size={16} />
                                Settings
                            </NavLink>
                            <button
                                onClick={() => {
                                    setMenuOpen(false);
                                    onSignOut();
                                }}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[0.8125rem] text-[#d5d8de] hover:bg-white/10"
                            >
                                <LogoutIcon />
                                Sign out
                            </button>
                        </div>
                    </>
                )}
            </div>
        </aside>
    );
}

/** The design's goal-progress rail. Sagebook plans in budgets, so the rail
 *  shows the live budget's biggest lines — the same "am I on track?" glance. */
function SidebarBudgets() {
    const budgets = useBudgets();
    const budget = currentBudget(budgets.data);
    const progress = useBudgetProgress(budget?.id);

    const lines = (progress.data ?? [])
        .filter((l) => l.kind === "expense" && Number(l.planned_amount) > 0)
        .sort((a, b) => Number(b.planned_amount) - Number(a.planned_amount))
        .slice(0, 3);

    if (!budget || lines.length === 0) return null;

    return (
        <div className="pt-6">
            <div className="px-3.5 pb-2.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[#767d8c]">
                {budget.name}
            </div>
            <div className="flex flex-col gap-3.5 px-3.5">
                {lines.map((line) => {
                    const pct = Math.round(Number(line.pct_used) * (Number(line.pct_used) <= 1 ? 100 : 1));
                    const over = pct > 100;
                    return (
                        <div key={line.budget_category_id}>
                            <div className="mb-1.5 flex justify-between gap-2 text-[0.78125rem]">
                                <span className="min-w-0 truncate text-[#d5d8de]">{line.label}</span>
                                <span className="shrink-0 text-[#9aa0ad] tnum">{pct}%</span>
                            </div>
                            <div className="h-[5px] rounded-full bg-[#2c313d]">
                                <div
                                    className="h-[5px] rounded-full"
                                    style={{
                                        width: `${Math.min(100, pct)}%`,
                                        background: over ? CHART_COLORS.negative : CHART_COLORS.primary,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

