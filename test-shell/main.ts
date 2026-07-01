// =============================================================================
// Sagebook · Test Shell client orchestration.
// Wires a barebones HTML form to the process-media edge function.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface Elements {
    supabaseUrl:      HTMLInputElement;
    supabaseAnonKey:  HTMLInputElement;
    authEmail:        HTMLInputElement;
    authPassword:     HTMLInputElement;
    authStatus:       HTMLElement;
    btnSignIn:        HTMLButtonElement;
    btnSignUp:        HTMLButtonElement;
    btnSignOut:       HTMLButtonElement;
    mediaFile:        HTMLInputElement;
    mediaText:        HTMLTextAreaElement;
    promptHint:       HTMLInputElement;
    baseCurrency:     HTMLInputElement;
    btnSubmit:        HTMLButtonElement;
    output:           HTMLElement;
    responseMeta:     HTMLElement;
}

const STORAGE_KEY = "sagebook.test-shell.config";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} missing from DOM`);
    return el as T;
};

const els: Elements = {
    supabaseUrl:      $("supabaseUrl"),
    supabaseAnonKey:  $("supabaseAnonKey"),
    authEmail:        $("authEmail"),
    authPassword:     $("authPassword"),
    authStatus:       $("authStatus"),
    btnSignIn:        $("btnSignIn"),
    btnSignUp:        $("btnSignUp"),
    btnSignOut:       $("btnSignOut"),
    mediaFile:        $("mediaFile"),
    mediaText:        $("mediaText"),
    promptHint:       $("promptHint"),
    baseCurrency:     $("baseCurrency"),
    btnSubmit:        $("btnSubmit"),
    output:           $("output"),
    responseMeta:     $("responseMeta"),
};

let client: SupabaseClient | null = null;
let lastSupabaseUrl = "";
let lastSupabaseKey = "";

// -----------------------------------------------------------------------------
// Persistence of connection fields (NOT credentials).
// -----------------------------------------------------------------------------

restoreConfig();
els.supabaseUrl.addEventListener("change", saveConfig);
els.supabaseAnonKey.addEventListener("change", saveConfig);

function saveConfig(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        url: els.supabaseUrl.value.trim(),
        key: els.supabaseAnonKey.value.trim(),
    }));
}

function restoreConfig(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const { url, key } = JSON.parse(raw);
        if (url) els.supabaseUrl.value = url;
        if (key) els.supabaseAnonKey.value = key;
    } catch {
        // Ignore malformed storage.
    }
}

// -----------------------------------------------------------------------------
// Supabase client lifecycle.
// -----------------------------------------------------------------------------

function ensureClient(): SupabaseClient {
    const url = els.supabaseUrl.value.trim();
    const key = els.supabaseAnonKey.value.trim();
    if (!url || !key) throw new Error("Supabase URL and anon key are required.");
    if (key.startsWith("sb_publishable_") || key.startsWith("sb_secret_") || key.startsWith("pk_")) {
        throw new Error("The provided key looks like a Stripe key. Enter your Supabase anon/public key from Project Settings → API.");
    }
    if (!key.startsWith("eyJ")) {
        throw new Error("The Supabase anon key appears invalid. It should start with the JSON Web Token prefix 'eyJ'.");
    }
    if (!client || url !== lastSupabaseUrl || key !== lastSupabaseKey) {
        client = createClient(url, key, {
            auth: { persistSession: true, autoRefreshToken: true },
        });
        lastSupabaseUrl = url;
        lastSupabaseKey = key;
    }
    return client;
}

async function refreshAuthStatus(): Promise<void> {
    if (!client) {
        els.authStatus.textContent = "Not signed in.";
        return;
    }
    const { data } = await client.auth.getSession();
    els.authStatus.textContent = data.session
        ? `Signed in as ${data.session.user.email ?? data.session.user.id}.`
        : "Not signed in.";
}

function generateRandomTestEmail(): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `test+${suffix}@example.com`;
}

// -----------------------------------------------------------------------------
// Event handlers.
// -----------------------------------------------------------------------------

els.btnSignIn.addEventListener("click", async () => {
    try {
        const supabase = ensureClient();
        const email = els.authEmail.value.trim();
        const password = els.authPassword.value;
        if (!email || !password) throw new Error("Email and password are required.");

        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) {
            const msg = result.error.message.toLowerCase();
            if (msg.includes("invalid login credentials") || msg.includes("user not found")) {
                throw new Error("Invalid login credentials. Use Sign Up to create a new account.");
            }
            throw result.error;
        }

        await refreshAuthStatus();
        els.output.textContent = "// Signed in successfully.";
    } catch (err) {
        await renderError(err);
    }
});

els.btnSignUp.addEventListener("click", async () => {
    try {
        const supabase = ensureClient();
        let email = els.authEmail.value.trim();
        const password = els.authPassword.value;
        if (!email || !password) throw new Error("Email and password are required.");
        if (password.length < 6) throw new Error("Password should be at least 6 characters.");

        let signUpResult = await supabase.auth.signUp({ email, password });
        if (signUpResult.error) {
            const msg = signUpResult.error.message.toLowerCase();
            if (msg.includes("email rate limit exceeded")) {
                email = generateRandomTestEmail();
                els.authEmail.value = email;
                signUpResult = await supabase.auth.signUp({ email, password });
            }
        }

        if (signUpResult.error) throw signUpResult.error;
        els.output.textContent = `// Account created for ${email}. Please sign in.`;
    } catch (err) {
        await renderError(err);
    }
});

els.btnSignOut.addEventListener("click", async () => {
    try {
        if (client) await client.auth.signOut();
        await refreshAuthStatus();
    } catch (err) {
        await renderError(err);
    }
});

els.btnSubmit.addEventListener("click", async () => {
    els.btnSubmit.disabled = true;
    try {
        const supabase = ensureClient();
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) throw new Error("Sign in before submitting media.");

        const body: Record<string, unknown> = {};
        const file = els.mediaFile.files?.[0];
        const text = els.mediaText.value.trim();

        if (file) {
            body.inlineMedia = {
                mimeType: file.type || "application/octet-stream",
                data:     await fileToBase64(file),
            };
        }
        if (text) body.text = text;
        if (els.promptHint.value.trim())   body.promptHint   = els.promptHint.value.trim();
        if (els.baseCurrency.value.trim()) body.baseCurrency = els.baseCurrency.value.trim().toUpperCase();

        if (!file && !text) throw new Error("Provide a file or some text to process.");

        els.output.textContent = "// Calling process-media...";

        const { data, error } = await supabase.functions.invoke("process-media", { body });
        if (error) throw error;
        const payload = data as {
            provider?: string;
            model?: string;
        } | null;
        const provider = payload?.provider ?? "unknown";
        const model = payload?.model ?? "unknown";

        els.responseMeta.textContent = payload?.provider || payload?.model
            ? `(${provider} · ${model})`
            : "";

        const providerLine = payload?.provider || payload?.model
            ? `// Provider: ${provider}\n// Model: ${model}\n\n`
            : "";

        els.output.textContent = `${providerLine}${JSON.stringify(data, null, 2)}`;
    } catch (err) {
        await renderError(err);
    } finally {
        els.btnSubmit.disabled = false;
    }
});

// -----------------------------------------------------------------------------
// Utilities.
// -----------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
                reject(new Error("Unexpected FileReader result."));
                return;
            }
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
        reader.readAsDataURL(file);
    });
}

async function renderError(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const details = await extractErrorDetails(err);
    els.responseMeta.textContent = "";
    els.output.textContent = details
        ? `// Error\n${message}\n\n${details}`
        : `// Error\n${message}`;
    console.error(err);
}

async function extractErrorDetails(err: unknown): Promise<string> {
    if (!(err instanceof Error)) return "";

    const maybeContext = err as Error & { context?: Response };
    if (!(maybeContext.context instanceof Response)) {
        return "";
    }

    try {
        const payload = await maybeContext.context.clone().json();
        return JSON.stringify(payload, null, 2);
    } catch {
        try {
            return await maybeContext.context.clone().text();
        } catch {
            return "";
        }
    }
}

// Boot.
void refreshAuthStatus();
