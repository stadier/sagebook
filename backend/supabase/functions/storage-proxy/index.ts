// =============================================================================
// Sagebook · storage-proxy Edge Function
// -----------------------------------------------------------------------------
// The web app never holds Backblaze credentials; it uploads and requests
// signed download URLs through this proxy instead. Objects live under
// {user_id}/... and every request is checked against the caller's own prefix.
//   POST /storage-proxy/upload  (raw bytes; x-file-name / x-file-type headers)
//     → { storagePath: "b2:<userId>/<uuid>-<name>" }
//   POST /storage-proxy/sign    { path: "b2:..." }
//     → { url } (temporary read URL)
// =============================================================================

import { b2Configured, b2SignedUrl, b2Upload } from "../_shared/b2.ts";
import { MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS } from "../_shared/constants.ts";
import {
  createApp,
  errorMessage,
  ownsStoragePath,
  readJson,
  requireUser,
  serve,
} from "../_shared/http.ts";

const app = createApp("storage-proxy", {
  allowHeaders: ["x-file-name", "x-file-type"],
  health: () => ({ b2: b2Configured() }),
});

app.post("/storage-proxy/upload", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;
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
  const path = `${auth.userId}/${crypto.randomUUID()}-${safeName}`;

  try {
    await b2Upload(path, bytes, contentType);
  } catch (err) {
    console.error("[storage-proxy] upload failed:", errorMessage(err));
    return c.json({ error: "upload failed", detail: errorMessage(err) }, 502);
  }

  return c.json({ storagePath: `b2:${path}` });
});

app.post("/storage-proxy/sign", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;
  if (!b2Configured()) return c.json({ error: "B2 storage is not configured" }, 503);

  const parsed = await readJson<{ path?: string }>(c);
  if (!parsed.ok) return parsed.response;

  const raw = parsed.body.path ?? "";
  if (!raw.startsWith("b2:")) return c.json({ error: "path must start with b2:" }, 400);
  if (!ownsStoragePath(auth.userId, raw)) {
    return c.json({ error: "path must be under your own folder" }, 403);
  }

  try {
    const url = await b2SignedUrl(raw.slice(3), SIGNED_URL_TTL_SECONDS);
    return c.json({ url });
  } catch (err) {
    console.error("[storage-proxy] sign failed:", errorMessage(err));
    return c.json({ error: "sign failed", detail: errorMessage(err) }, 502);
  }
});

serve(app);
