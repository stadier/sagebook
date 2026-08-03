/* The Console — Sage with the room to spread out.

 * This is not a different Sage from the one in the dock. It is the same
 * conversation, held in `SageProvider` above the router, shown through a bigger
 * window: history gets a permanent rail instead of a popover, answers get the
 * generated dashboard panels underneath them, and the query traces open up.
 * "Dock it" hands the same thread back to the side panel mid-sentence.
 *
 * See docs/FINANCIAL_OS.md for why the voice is the front door at all. */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import IngestModal from "../components/ingest/IngestModal";
import { BrandMark } from "../components/nav";
import { SageConversationView } from "../components/sage/SageConversationView";
import { SageHistory } from "../components/sage/SageHistory";
import { useSageSession } from "../components/sage/SageProvider";
import { GridIcon, PanelToggleIcon, PlusIcon, ThemeIcon } from "../components/icons";
import { requireSupabase } from "../lib/supabase";
import { useTheme } from "../lib/useTheme";

export default function Console() {
    const { theme, toggle: toggleTheme } = useTheme();
    const navigate = useNavigate();
    const { conversationId, setConversationId, newConversation, setOpen } = useSageSession();
    const [email, setEmail] = useState<string | null>(null);
    const [ingestOpen, setIngestOpen] = useState(false);
    const [ingestText, setIngestText] = useState("");

    useEffect(() => {
        requireSupabase()
            .auth.getUser()
            .then(({ data }) => setEmail(data.user?.email ?? null))
            .catch(() => {});
    }, []);

    const name = email ? email.split("@")[0] : "there";
    const initial = (email?.[0] ?? "S").toUpperCase();

    function capture(text: string) {
        setIngestText(text);
        setIngestOpen(true);
    }

    /** Hand the conversation back to the dock, exactly where it stands. */
    function dockIt() {
        setOpen(true);
        navigate("/");
    }

    return (
        <div className="flex h-screen overflow-hidden bg-paper text-slate-200">
            {/* ---- Left rail — quiet, vertical, gets out of the way ---------- */}
            <aside className="hidden w-64 shrink-0 flex-col bg-sidebar px-3 py-4 text-white md:flex">
                <Link to="/console" className="mb-5 flex items-center gap-2.5 px-2">
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-coral text-coral-fg">
                        <BrandMark />
                    </span>
                    <span className="text-[1.0625rem] font-extrabold tracking-tight text-white">
                        Sagebook
                    </span>
                </Link>

                <button
                    onClick={newConversation}
                    className="mb-4 flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
                >
                    <PlusIcon size={17} />
                    New conversation
                </button>

                <div className="flex min-h-0 flex-1 flex-col">
                    <p className="px-2 pb-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-white/40">
                        History
                    </p>
                    <SageHistory
                        activeId={conversationId}
                        onPick={setConversationId}
                        onDeleted={() => setConversationId(null)}
                    />
                </div>

                <button
                    onClick={dockIt}
                    className="mt-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                    <PanelToggleIcon collapsed size={17} />
                    Dock to the side
                </button>
                <Link
                    to="/"
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                >
                    <GridIcon size={17} />
                    Classic dashboard
                </Link>

                <div className="mt-1 flex items-center gap-2 border-t border-white/10 pt-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ffb443] text-[0.8125rem] font-bold text-[#191d24]">
                        {initial}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-white/80">
                        {name}
                    </span>
                    <button
                        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        onClick={toggleTheme}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                    >
                        <ThemeIcon theme={theme} size={17} />
                    </button>
                </div>
            </aside>

            {/* ---- Right canvas --------------------------------------------- */}
            <main className="relative flex min-w-0 flex-1 flex-col" style={DOT_BG}>
                {/* Mobile brand + new (no rail below md) */}
                <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 md:hidden">
                    <Link to="/console" className="flex items-center gap-2">
                        <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-coral text-coral-fg">
                            <BrandMark size={14} />
                        </span>
                        <span className="text-[0.9375rem] font-extrabold tracking-tight text-slate-100">
                            Sagebook
                        </span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={newConversation}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-300 shadow-sm"
                        >
                            New
                        </button>
                        <Link to="/" className="rounded-lg px-2 py-1.5 text-sm text-slate-500">
                            Classic
                        </Link>
                    </div>
                </div>

                <SageConversationView variant="focus" onCapture={capture} viewing="Sage console" />
            </main>

            <IngestModal
                open={ingestOpen}
                onClose={() => setIngestOpen(false)}
                initialText={ingestText}
            />
        </div>
    );
}

/* Subtle scattered-dot ambience for the canvas, matching the calm reference. */
const DOT_BG: React.CSSProperties = {
    backgroundImage:
        "radial-gradient(circle, color-mix(in oklab, var(--color-slate-600) 22%, transparent) 1px, transparent 1px)",
    backgroundSize: "26px 26px",
};
