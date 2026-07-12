// =============================================================================
// Sagebook · storage-proxy Edge Function
// -----------------------------------------------------------------------------
// The web app never holds Backblaze credentials; it uploads and requests
// signed download URLs through this proxy instead. Objects live under
// {user_id}/... and every request is checked against the caller's own prefix.
//   POST /storage-proxy/upload  (raw bytes; x-file-name / x-file-type headers)
//     → { storagePath: "b2:<userId>/<uuid>-<name>" }
//   POST /storage-proxy/sign    { path: "b2:..." }
//     → { url } (temporary read URL, 1h)
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { b2Configured, b2SignedUrl, b2Upload } from "../_shared/b2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

async function requireUser(authHeader: string): Promise<string | null> {
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data?.user ? null : data.user.id;
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "authorization", "content-type", "x-client-info", "apikey",
      "x-file-name", "x-file-type",
    ],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.get("/storage-proxy/health", (c) => c.json({ ok: true, b2: b2Configured() }));

app.post("/storage-proxy/upload", async (c) => {
  const userId = await requireUser(c.req.header("authorization") ?? "");
  if (!userId) return c.json({ error: "invalid session" }, 401);
  if (!b2Configured()) return c.json({ error: "B2 storage is not configured" }, 503);

  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return c.json({ error: "empty body" }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` }, 413);
  }

  const rawName = c.req.header("x-file-name") ?? "capture";
  const safeName = rawName.replace(/[^\w.-]+/g, "_").slice(-80) || "capture";
  const contentType =
    c.req.header("x-file-type") ||
    c.req.header("content-type") ||
    "application/octet-stream";
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;

  try {
    await b2Upload(path, bytes, contentType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[storage-proxy] upload failed:", message);
    return c.json({ error: "upload failed", detail: message }, 502);
  }

  return c.json({ storagePath: `b2:${path}` });
});

app.post("/storage-proxy/sign", async (c) => {
  const userId = await requireUser(c.req.header("authorization") ?? "");
  if (!userId) return c.json({ error: "invalid session" }, 401);
  if (!b2Configured()) return c.json({ error: "B2 storage is not configured" }, 503);

  let body: { path?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }

  const raw = body.path ?? "";
  if (!raw.startsWith("b2:")) return c.json({ error: "path must start with b2:" }, 400);
  const path = raw.slice(3);
  if (!path.startsWith(`${userId}/`)) {
    return c.json({ error: "path must be under your own folder" }, 403);
  }

  try {
    const url = await b2SignedUrl(path, 3600);
    return c.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[storage-proxy] sign failed:", message);
    return c.json({ error: "sign failed", detail: message }, 502);
  }
});

Deno.serve((req) => app.fetch(req));
