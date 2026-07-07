import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { getSupabase } from "./lib/supabase";
import Accounts from "./pages/Accounts";
import Capture from "./pages/Capture";
import Categories from "./pages/Categories";
import Inbox from "./pages/Inbox";
import Reports from "./pages/Reports";
import Rules from "./pages/Rules";
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
        const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
        return () => sub.subscription.unsubscribe();
    }, [sb]);

    return { session, loading };
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
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                {!session ? (
                    <Welcome />
                ) : (
                    <Routes>
                        <Route element={<AppShell />}>
                            <Route path="/" element={<Navigate to="/inbox" replace />} />
                            <Route path="/capture" element={<Capture />} />
                            <Route path="/inbox" element={<Inbox />} />
                            <Route path="/transactions" element={<Transactions />} />
                            <Route path="/accounts" element={<Accounts />} />
                            <Route path="/categories" element={<Categories />} />
                            <Route path="/rules" element={<Rules />} />
                            <Route path="/reports" element={<Reports />} />
                            <Route path="*" element={<Navigate to="/inbox" replace />} />
                        </Route>
                    </Routes>
                )}
            </BrowserRouter>
        </QueryClientProvider>
    );
}
