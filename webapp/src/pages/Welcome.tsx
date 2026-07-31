import { type FormEvent, useState } from "react";
import { BrandMark } from "../components/nav";
import { Input } from "../components/ui";
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
                <Input
                    className="py-2.5"
                    placeholder="https://xxxx.supabase.co"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                />
                <Input
                    className="py-2.5"
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
                <Input
                    className="py-2.5"
                    type="email"
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <Input
                    className="py-2.5"
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
            <div className="sb-card-lg w-full max-w-sm p-6 sm:p-7">
                <div className="mb-5 flex items-center gap-2.5">
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-coral text-coral-fg">
                        <BrandMark />
                    </span>
                    <span className="text-[1.0625rem] font-extrabold tracking-tight text-slate-100">
                        Sagebook
                    </span>
                </div>
                <h1 className="mb-4 text-base font-bold text-slate-200">{title}</h1>
                {children}
            </div>
        </div>
    );
}

const primaryBtnCls = "sb-btn sb-btn-primary !py-2.5";
