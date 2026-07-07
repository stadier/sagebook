// Client-side event log → public.app_logs. Fire-and-forget: logging must
// never break the action being logged, so failures fall back to the console.

import { getSupabase } from "./supabase";

export type LogLevel = "info" | "warn" | "error";
export type LogSource = "capture" | "import" | "inbox" | "networth" | "app";

export function logEvent(
    level: LogLevel,
    source: LogSource,
    message: string,
    context: Record<string, unknown> = {},
): void {
    void (async () => {
        try {
            const sb = getSupabase();
            if (!sb) return;
            const { data } = await sb.auth.getUser();
            const uid = data.user?.id;
            if (!uid) return;
            const { error } = await sb.from("app_logs").insert({
                user_id: uid,
                level,
                source,
                message: message.slice(0, 500),
                context,
            });
            if (error) console.warn("[logger] insert failed:", error.message);
        } catch (err) {
            console.warn("[logger] failed:", err);
        }
    })();
}
