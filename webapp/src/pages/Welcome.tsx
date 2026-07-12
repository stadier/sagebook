import { type FormEvent, useState } from "react";
import { getStoredConfig, getSupabase, storeConfig } from "../lib/supabase";

export default function Welcome() {
    return getStoredConfig() ? <AuthForm /> : <ConnectForm />;
}

function ConnectForm() {
    const [url, setUrl] = useState("");
    const [anonKey, setAnonKey] = useState("");
    const [error, setError] = useState("");

    function connect(e: FormEvent) {
        e.preventDefault();
        if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url.trim())) {
            setError("Enter your project URL, e.g. https://xxxx.supabase.co");
            return;
        }
        storeConfig({ url: url.trim().replace(/\/$/, ""), anonKey: anonKey.trim() });
        // Client is created lazily from stored config; a reload keeps this simple.
        window.location.reload();
    }

    return (
        <CenterCard title="Connect to Supabase">
            <p className="mb-4 text-sm text-slate-400">
                One-time setup: paste your Supabase project URL and anon key. They are
                stored only in this browser.
            </p>
            <form onSubmit={connect} className="flex flex-col gap-3">
                <input
                    className={inputCls}
                    placeholder="https://xxxx.supabase.co"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                />
                <input
                    className={inputCls}
                    placeholder="anon key"
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    required
                />
                {error && <p className="text-sm text-rose-400">{error}</p>}
                <button className={primaryBtnCls}>Connect</button>
            </form>
        </CenterCard>
    );
}

// In dev, prefill sign-in creds so we don't retype them on every reload.
const DEV_EMAIL = import.meta.env.DEV ? "rjemekoba@gmail.com" : "";
const DEV_PASSWORD = import.meta.env.DEV ? "Password1$" : "";

function AuthForm() {
    const [email, setEmail] = useState(DEV_EMAIL);
    const [password, setPassword] = useState(DEV_PASSWORD);
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

    async function submit(e: FormEvent) {
        e.preventDefault();
        const sb = getSupabase();
        if (!sb) return;
        setBusy(true);
        setMessage("");
        try {
            const { error } =
                mode === "signin"
                    ? await sb.auth.signInWithPassword({ email, password })
                    : await sb.auth.signUp({ email, password });
            if (error) setMessage(error.message);
            else if (mode === "signup") setMessage("Account created — check your email if confirmation is enabled, then sign in.");
            // On successful sign-in, the auth listener in App re-renders into the shell.
        } finally {
            setBusy(false);
        }
    }

    return (
        <CenterCard title={mode === "signin" ? "Sign in" : "Create account"}>
            <form onSubmit={submit} className="flex flex-col gap-3">
                <input
                    className={inputCls}
                    type="email"
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <input
                    className={inputCls}
                    type="password"
                    placeholder="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                {message && <p className="text-sm text-amber-400">{message}</p>}
                <button className={primaryBtnCls} disabled={busy}>
                    {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
                </button>
            </form>
            <button
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="mt-4 text-sm text-slate-400 hover:text-slate-200"
            >
                {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
        </CenterCard>
    );
}

function CenterCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="grid min-h-screen place-items-center bg-paper p-4">
            <div className="sb-card w-full max-w-sm p-6 sm:p-7">
                <div className="mb-5 flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white">
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
                    </span>
                    <span className="text-lg font-semibold tracking-tight text-slate-100">
                        <span className="text-emerald-600">Sage</span>book
                    </span>
                </div>
                <h1 className="mb-4 text-base font-semibold text-slate-200">{title}</h1>
                {children}
            </div>
        </div>
    );
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";
const primaryBtnCls =
    "rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50";
