// Supabase client bootstrap. Config comes from Vite env when baked into the
// build, otherwise from a one-time connect screen persisted in localStorage.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "sagebook.webapp.config";

export interface SupabaseConfig {
    url: string;
    anonKey: string;
}

export function getStoredConfig(): SupabaseConfig | null {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (url && anonKey) return { url, anonKey };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as SupabaseConfig;
            if (parsed.url && parsed.anonKey) return parsed;
        }
    } catch {
        /* ignore corrupt config */
    }
    return null;
}

export function storeConfig(cfg: SupabaseConfig): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearConfig(): void {
    localStorage.removeItem(STORAGE_KEY);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
    if (client) return client;
    const cfg = getStoredConfig();
    if (!cfg) return null;
    client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
    });
    return client;
}

/** Requires a connected client; throws otherwise. Use inside authed screens. */
export function requireSupabase(): SupabaseClient {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is not configured");
    return sb;
}

/** Invoke an edge function and surface the backend's error/detail message. */
export async function invokeFn<T>(name: string, body: Record<string, unknown> | object): Promise<T> {
    const sb = requireSupabase();
    const { data, error } = await sb.functions.invoke(name, { body: body as Record<string, unknown> });
    if (error) {
        let detail = error.message;
        try {
            const ctx = await (error as { context?: Response }).context?.json();
            if (ctx?.error) detail = ctx.detail ? `${ctx.error}: ${ctx.detail}` : String(ctx.error);
        } catch {
            /* response body unavailable */
        }
        throw new Error(detail);
    }
    return data as T;
}
