import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { requireSupabase } from "../lib/supabase";

const NAV = [
    { to: "/capture", label: "Capture", icon: "＋" },
    { to: "/inbox", label: "Inbox", icon: "📥" },
    { to: "/transactions", label: "Transactions", icon: "📒" },
    { to: "/accounts", label: "Accounts", icon: "🏦" },
    { to: "/categories", label: "Categories", icon: "🗂" },
    { to: "/rules", label: "Rules", icon: "⚙️" },
    { to: "/reports", label: "Reports", icon: "📊" },
    { to: "/net-worth", label: "Net worth", icon: "🪙" },
];

export default function AppShell() {
    const navigate = useNavigate();

    async function signOut() {
        await requireSupabase().auth.signOut();
        navigate("/");
    }

    return (
        <div className="flex min-h-screen">
            <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-6 px-2 text-lg font-semibold tracking-tight">
                    <span className="text-emerald-400">Sage</span>book
                </div>
                <nav className="flex flex-1 flex-col gap-1">
                    {NAV.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                                    isActive
                                        ? "bg-emerald-500/15 text-emerald-300"
                                        : "text-slate-300 hover:bg-slate-800"
                                }`
                            }
                        >
                            <span aria-hidden>{item.icon}</span>
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
                <button
                    onClick={signOut}
                    className="mt-4 rounded-lg px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                    Sign out
                </button>
            </aside>
            <main className="min-w-0 flex-1 p-6">
                <Outlet />
            </main>
        </div>
    );
}
