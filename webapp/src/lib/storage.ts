import { logEvent } from "./logger";
import { requireSupabase } from "./supabase";

/**
 * Upload captured media for AI processing + archival.
 *
 * Preferred backend: Backblaze B2 via the storage-proxy edge function (the
 * browser never holds B2 credentials); returns a "b2:{userId}/..." path.
 * Fallback: the Supabase 'ingest' bucket; returns a plain "{userId}/..." path.
 * process-media and the media preview dispatch on the "b2:" prefix.
 */
export async function uploadToIngest(file: File): Promise<string | null> {
    const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "capture";

    try {
        const sb = requireSupabase();
        const { data, error } = await sb.functions.invoke("storage-proxy/upload", {
            body: file,
            headers: {
                "x-file-name": safeName,
                "x-file-type": file.type || "application/octet-stream",
            },
        });
        if (!error && data?.storagePath) return data.storagePath as string;
        if (error) console.warn("[storage] proxy upload failed:", error.message);
    } catch (err) {
        console.warn("[storage] proxy upload failed:", err);
    }

    // Fallback: direct upload to the Supabase 'ingest' bucket.
    try {
        const sb = requireSupabase();
        const { data: userData } = await sb.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return null;
        const path = `${uid}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await sb.storage.from("ingest").upload(path, file, {
            contentType: file.type || undefined,
        });
        if (error) {
            console.warn("[storage] ingest upload failed:", error.message);
            logEvent("warn", "app", `Storage upload failed on both backends: ${error.message}`, {
                file: { name: file.name, size: file.size, type: file.type },
            });
            return null;
        }
        return path;
    } catch {
        return null;
    }
}

/** Temporary read URL for a stored capture, whichever backend holds it. */
export async function signedUrlFor(storagePath: string): Promise<string> {
    const sb = requireSupabase();
    if (storagePath.startsWith("b2:")) {
        const { data, error } = await sb.functions.invoke("storage-proxy/sign", {
            body: { path: storagePath },
        });
        if (error) throw new Error(error.message);
        if (!data?.url) throw new Error("sign endpoint returned no url");
        return data.url as string;
    }
    const signed = await sb.storage.from("ingest").createSignedUrl(storagePath, 3600);
    if (signed.error) throw new Error(signed.error.message);
    return signed.data.signedUrl;
}
