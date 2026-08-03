import { useCallback, useEffect, useState } from "react";
import {
	Link,
	NavLink,
	Outlet,
	useLocation,
	useNavigate,
	useSearchParams,
} from "react-router-dom";
import { STORAGE_KEYS } from "../lib/constants";
import { usePendingReview } from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { useTheme } from "../lib/useTheme";
import { GlobalSearchProvider } from "./GlobalSearch";
import {
	LogoutIcon,
	MenuIcon,
	PanelToggleIcon,
	PlusIcon,
	SparkIcon,
	ThemeIcon,
} from "./icons";
import { BrandMark, Icon, NAV, NAV_GROUPS, navItem } from "./nav";
import IngestModal from "./ingest/IngestModal";
import BulkReviewProgress from "./inbox/BulkReviewProgress";
import ImportProgress from "./ingest/ImportProgress";
import { useGlobalCapture } from "./ingest/useGlobalCapture";
import { SageDock } from "./sage/SageDock";
import { useSageSession } from "./sage/SageProvider";

/* The shell is a fixed dark rail, a scrolling column, and — when you call for
   it — Sage docked to the right. The sidebar never scrolls with the page, and
   it stays navy in both themes so the app always has one constant anchor. Below
   `lg` the rail becomes a slide-over drawer behind a sticky mobile top bar.

   From `lg` up the rail collapses to an icon strip. That is a desktop
   affordance only — the drawer already dismisses via its backdrop — so the
   collapsed state is expressed through `lg:` variants rather than by dropping
   labels from the tree, and the drawer stays fully labelled on a phone.

   Getting things *in* has three doors, and they are deliberately not the same
   door in three places:
   - **Add**, the floating "+" bubble, pinned bottom-right on every screen. It
     stays up even while Sage is docked — adding and asking are different jobs.
   - **Drop or paste anywhere.** No aiming required; see `useGlobalCapture`.
   - **Ask Sage**, the rail entry for the docked composer. */

export default function AppShell() {
	const navigate = useNavigate();
	const location = useLocation();
	const [params] = useSearchParams();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1",
	);
	const { theme, toggle: toggleTheme } = useTheme();
	const [email, setEmail] = useState<string | null>(null);
	const [ingestOpen, setIngestOpen] = useState(false);
	const [ingestText, setIngestText] = useState("");
	const [ingestFiles, setIngestFiles] = useState<File[] | undefined>();
	const [menuOpen, setMenuOpen] = useState(false);
	const sage = useSageSession();

	const pending = usePendingReview();
	const pendingCount = pending.data?.length ?? 0;

	// A file dropped or pasted anywhere in the app opens capture already holding
	// it — the shortest path there is from "I have a receipt" to it being filed.
	const captureFiles = useCallback((files: File[]) => {
		setIngestText("");
		setIngestFiles(files);
		setIngestOpen(true);
	}, []);
	const { dragging } = useGlobalCapture(captureFiles);

	/** What the user is looking at, so Sage knows what "this" refers to. */
	const viewing = navItem(location.pathname)?.label;

	// Close the drawer + the account menu whenever the route changes.
	useEffect(() => {
		setDrawerOpen(false);
		setMenuOpen(false);
	}, [location.pathname]);

	// Deep links / the PWA share target land on /capture or /import — open the
	// ingest modal (prefilled from any shared text) instead of a standalone page.
	useEffect(() => {
		if (location.pathname === "/capture" || location.pathname === "/import") {
			const shared = [
				params.get("title"),
				params.get("text"),
				params.get("url"),
			]
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

	function openIngest(text = "") {
		setIngestText(text);
		setIngestFiles(undefined);
		setIngestOpen(true);
	}

	function closeIngest() {
		setIngestOpen(false);
		setIngestFiles(undefined);
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
		<GlobalSearchProvider>
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
					collapsed={collapsed}
					sageOpen={sage.open}
					onToggleSage={sage.toggle}
					onToggleCollapsed={() => {
						const next = !collapsed;
						setCollapsed(next);
						localStorage.setItem(
							STORAGE_KEYS.sidebarCollapsed,
							next ? "1" : "0",
						);
						// The account popover is anchored to the expanded footer.
						setMenuOpen(false);
					}}
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
							<span className="text-[0.9375rem] font-extrabold tracking-tight">
								Sagebook
							</span>
						</Link>
						<button
							aria-label="Ask Sage"
							onClick={sage.toggle}
							className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-lg bg-chip text-coral"
						>
							<SparkIcon size={17} />
						</button>
						<button
							aria-label={
								theme === "dark"
									? "Switch to light mode"
									: "Switch to dark mode"
							}
							onClick={toggleTheme}
							className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-chip text-slate-200"
						>
							<ThemeIcon theme={theme} />
						</button>
					</div>

					<div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 pb-12 pt-5 sm:px-6 sm:pb-14 sm:pt-7 lg:px-10 lg:pb-16 lg:pt-8">
						<Outlet />
					</div>
				</main>

				<SageDock onCapture={(text) => openIngest(text)} viewing={viewing} />

				{/* Floating "+" — the single entry point for all ingestion. It
					stays up even while Sage is docked: adding and asking are
					different jobs. On `lg` the dock pushes the page, so the
					bubble shifts with it to stay over the page, clear of the
					panel; below `lg` the dock is a covering sheet, and the
					bubble keeps its corner. The var is always set (0 when
					closed) because an undefined var would make the calc invalid
					at computed-value time and drop the button to a static
					position. */}
				<button
					aria-label="Add"
					onClick={() => openIngest()}
					style={
						{
							"--sb-dock-w": sage.open ? `${sage.width}px` : "0px",
						} as React.CSSProperties
					}
					className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-coral text-coral-fg shadow-pop transition-transform hover:scale-105 hover:bg-coral-600 active:scale-95 lg:right-[calc(var(--sb-dock-w)_+_1.5rem)]"
				>
					<PlusIcon size={24} />
				</button>

				{/* Drop anything, anywhere. The overlay is the only thing that has to
					say so, since the drop target is the whole window. */}
				{dragging && !ingestOpen && (
					<div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-black/50 backdrop-blur-sm">
						<div className="rounded-3xl border-2 border-dashed border-coral bg-paper px-8 py-7 text-center shadow-pop">
							<span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-coral text-coral-fg">
								<PlusIcon size={22} />
							</span>
							<p className="mt-3 text-base font-bold text-slate-100">
								Drop it anywhere
							</p>
							<p className="mt-1 text-sm text-slate-400">
								Receipts, statements, voice notes — Sagebook will read it.
							</p>
						</div>
					</div>
				)}

				<IngestModal
					open={ingestOpen}
					onClose={closeIngest}
					initialText={ingestText}
					initialFiles={ingestFiles}
				/>

				{/* Persistent background-import progress, visible on every page. */}
				<BulkReviewProgress />
				{/* Persistent background-import progress, visible on every page. */}
				<ImportProgress />
			</div>
		</GlobalSearchProvider>
	);
}

/* -------------------------------------------------------------------------- */
/*  Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

function Sidebar({
	open,
	collapsed,
	onToggleCollapsed,
	sageOpen,
	onToggleSage,
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
	collapsed: boolean;
	onToggleCollapsed: () => void;
	sageOpen: boolean;
	onToggleSage: () => void;
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
			data-rail={collapsed ? "collapsed" : "expanded"}
			className={`sb-rail fixed inset-y-0 left-0 z-[60] flex h-full w-[248px] shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-sidebar px-3.5 pb-4 pt-5 text-[#eef0f4] transition-[transform,width] duration-200 ease-out lg:static lg:translate-x-0 ${
				open
					? "translate-x-0 shadow-[0_0_40px_rgba(0,0,0,0.4)]"
					: "-translate-x-full"
			}`}
		>
			{/* Brand + the collapse control, which sits to the right of the
                wordmark and drops beneath the mark once the rail is narrow. */}
			<div className="sb-rail-brand flex items-center gap-2.5 px-2.5 pb-4">
				<Link to="/" className="flex min-w-0 items-center gap-2.5">
					<span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] bg-coral text-coral-fg">
						<BrandMark />
					</span>
					<span className="sb-rail-label whitespace-nowrap text-[1.0625rem] font-extrabold tracking-tight">
						Sagebook
					</span>
				</Link>
				<button
					onClick={onToggleCollapsed}
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					aria-expanded={!collapsed}
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					className="sb-rail-toggle ml-auto hidden h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-[#9aa0ad] transition-colors hover:bg-white/[0.08] hover:text-[#eef0f4] lg:grid"
				>
					<PanelToggleIcon collapsed={collapsed} />
				</button>
			</div>

			{/* Ask — the one thing you come to the app to do in the place that
				never moves. Add lives in the floating "+" bubble instead. */}
			<div className="flex flex-col gap-1.5 pb-4">
				<button
					onClick={onToggleSage}
					aria-pressed={sageOpen}
					title="Ask Sage  (⌘J)"
					className={`sb-rail-item flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
						sageOpen
							? "bg-white/[0.12] text-[#eef0f4]"
							: "text-[#9aa0ad] hover:bg-white/[0.06] hover:text-[#eef0f4]"
					}`}
				>
					<span className="text-coral">
						<SparkIcon size={17} />
					</span>
					<span className="sb-rail-label whitespace-nowrap">Ask Sage</span>
					<span className="sb-rail-label ml-auto text-[0.6875rem] text-[#767d8c]">
						⌘J
					</span>
				</button>
			</div>

			<nav className="flex flex-col gap-3">
				{NAV_GROUPS.map((group, gi) => (
					<div key={group.id} className="flex flex-col gap-[3px]">
						{gi > 0 && (
							<>
								<div className="sb-rail-label px-3.5 pb-2 pt-3 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[#767d8c]">
									{group.label}
								</div>
								{/* Collapsed, the group label becomes a rule so
                                    the sections still read as separate. */}
								{collapsed && (
									<div className="mx-2 my-2 hidden border-t border-white/10 lg:block" />
								)}
							</>
						)}
						{NAV.filter((n) => n.group === group.id).map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								end={item.to === "/"}
								title={collapsed ? item.label : undefined}
								className={({ isActive }) =>
									`sb-rail-item relative flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
										isActive
											? "bg-coral font-bold text-coral-fg"
											: "font-medium text-[#9aa0ad] hover:bg-white/[0.06] hover:text-[#eef0f4]"
									}`
								}
							>
								{({ isActive }) => (
									<>
										<Icon name={item.icon} size={17} />
										<span className="sb-rail-label whitespace-nowrap">
											{item.label}
										</span>
										{item.to === "/inbox" && pendingCount > 0 && (
											<>
												<span
													className={`sb-rail-label ml-auto text-[0.6875rem] font-bold ${
														isActive ? "text-coral-fg" : "text-[#767d8c]"
													}`}
												>
													{pendingCount}
												</span>
												{/* The count has nowhere to go on
                                                    the rail, so it becomes a dot. */}
												{collapsed && (
													<span
														className={`absolute right-1 top-1 hidden h-[7px] w-[7px] rounded-full lg:block ${
															isActive ? "bg-coral-fg" : "bg-coral"
														}`}
													/>
												)}
											</>
										)}
									</>
								)}
							</NavLink>
						))}
					</div>
				))}
			</nav>

			{/* Collapsed footer — plain icon buttons. The expanded footer's
                popover would be clipped by this rail's own overflow. */}
			{collapsed && (
				<div className="mt-auto hidden flex-col items-center gap-1.5 pt-4 lg:flex">
					<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ffb443] text-[0.8125rem] font-bold text-[#191d24]">
						{initial}
					</span>
					<NavLink
						to="/settings"
						title="Settings"
						aria-label="Settings"
						className="grid h-[30px] w-[30px] place-items-center rounded-[9px] text-[#9aa0ad] transition-colors hover:bg-white/[0.08] hover:text-[#eef0f4]"
					>
						<Icon name="settings" size={16} />
					</NavLink>
					<button
						aria-label={
							theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
						}
						title={
							theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
						}
						onClick={onToggleTheme}
						className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-[#2c313d] text-[#d5d8de] transition-colors hover:text-white"
					>
						<ThemeIcon theme={theme} size={15} />
					</button>
					<button
						aria-label="Sign out"
						title="Sign out"
						onClick={onSignOut}
						className="grid h-[30px] w-[30px] place-items-center rounded-[9px] text-[#9aa0ad] transition-colors hover:bg-white/[0.08] hover:text-[#eef0f4]"
					>
						<LogoutIcon />
					</button>
				</div>
			)}

			{/* User footer — identity, plan, theme */}
			<div
				className={`relative mt-auto flex items-center gap-2.5 pt-4 ${
					collapsed ? "lg:hidden" : ""
				}`}
			>
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
						<span className="block text-[0.71875rem] text-[#767d8c]">
							Free plan
						</span>
					</span>
				</button>
				<button
					aria-label={
						theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
					}
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
