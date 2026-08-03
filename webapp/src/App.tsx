import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";
import AppShell from "./components/AppShell";
import { PaletteProvider } from "./components/CommandPalette";
import { ConfirmProvider } from "./components/Confirm";
import { SageProvider } from "./components/sage/SageProvider";
import { getSupabase } from "./lib/supabase";
import Accounts from "./pages/Accounts";
import Activity from "./pages/Activity";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import Console from "./pages/Console";
import Documents from "./pages/Documents";
import Duplicates from "./pages/Duplicates";
import Inbox from "./pages/Inbox";
import NetWorth from "./pages/NetWorth";
import Overview from "./pages/Overview";
import Reports from "./pages/Reports";
import Scheduled from "./pages/Scheduled";
import Settings from "./pages/Settings";
import Ingestion from "./pages/settings/Ingestion";
import Rules from "./pages/settings/Rules";
import Transactions from "./pages/Transactions";
import Welcome from "./pages/Welcome";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, staleTime: 30_000 },
	},
});

function useSession() {
	const sb = getSupabase();
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(!!sb);

	useEffect(() => {
		if (!sb) return;
		sb.auth.getSession().then(({ data }) => {
			setSession(data.session);
			setLoading(false);
		});
		const { data: sub } = sb.auth.onAuthStateChange((_event, s) =>
			setSession(s),
		);
		return () => sub.subscription.unsubscribe();
	}, [sb]);

	return { session, loading };
}

/** `/rules` → `/settings/rules`, carrying the query string. The inbox's
 *  "+ Rule" button prefills the form through it, so dropping the search here
 *  would silently empty the new-rule form. */
function RulesRedirect() {
	const { search } = useLocation();
	return <Navigate to={`/settings/rules${search}`} replace />;
}

export default function App() {
	const { session, loading } = useSession();

	if (loading) {
		return (
			<div className="grid min-h-screen place-items-center text-slate-400">
				Loading…
			</div>
		);
	}

	return (
		<QueryClientProvider client={queryClient}>
			{/* One palette instance for the whole app — every <Picker>, on every
                route and inside every modal, opens into it. */}
			<PaletteProvider>
				{/* Likewise one confirmation dialog — nothing destructive in the
                    app happens without passing through it. */}
				<ConfirmProvider>
					{/* Which conversation Sage is on outlives both the dock and
                        the console route, so it sits above the router — walking
                        between them is changing window, not changing subject. */}
					<SageProvider>
						<BrowserRouter
							future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
						>
							{!session ? (
								<Welcome />
							) : (
								<Routes>
									{/* Sage — the financial voice. Full-screen shell with its
                                    own sidebar, so it sits outside the AppShell top nav. */}
									<Route path="/console" element={<Console />} />
									<Route element={<AppShell />}>
										<Route path="/" element={<Overview />} />
										{/* Deep links / PWA share target — AppShell opens the
                                        ingest modal over the dashboard for these paths. */}
										<Route path="/capture" element={<Overview />} />
										<Route path="/import" element={<Overview />} />
										<Route path="/inbox" element={<Inbox />} />
										<Route path="/documents" element={<Documents />} />
										<Route path="/transactions" element={<Transactions />} />
										<Route path="/duplicates" element={<Duplicates />} />
										<Route path="/accounts" element={<Accounts />} />
										<Route path="/categories" element={<Categories />} />
										{/* Rules moved under Settings; the old path is
                                        kept so the inbox's prefilled "+ Rule" link
                                        and any bookmarks still land correctly. */}
										<Route path="/rules" element={<RulesRedirect />} />
										<Route path="/scheduled" element={<Scheduled />} />
										<Route path="/budgets" element={<Budgets />} />
										<Route path="/reports" element={<Reports />} />
										<Route path="/net-worth" element={<NetWorth />} />
										<Route path="/activity" element={<Activity />} />
										<Route path="/settings" element={<Settings />}>
											<Route
												index
												element={<Navigate to="/settings/ingestion" replace />}
											/>
											<Route path="ingestion" element={<Ingestion />} />
											<Route path="rules" element={<Rules />} />
										</Route>
										<Route path="*" element={<Navigate to="/" replace />} />
									</Route>
								</Routes>
							)}
						</BrowserRouter>
					</SageProvider>
				</ConfirmProvider>
			</PaletteProvider>
		</QueryClientProvider>
	);
}
