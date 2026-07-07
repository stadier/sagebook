import { requireSupabase } from "./supabase";

/** Upload to ingest/{userId}/... — the object doubles as the source archive. */
export async function uploadToIngest(file: File): Promise<string | null> {
    try {
        const sb = requireSupabase();
        const { data: userData } = await sb.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return null;
        const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "capture";
        const path = `${uid}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await sb.storage.from("ingest").upload(path, file, {
            contentType: file.type || undefined,
        });
        if (error) {
            console.warn("[storage] ingest upload failed:", error.message);
            return null;
        }
        return path;
    } catch {
        return null;
    }
}
