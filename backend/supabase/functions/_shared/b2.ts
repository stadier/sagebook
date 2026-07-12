// =============================================================================
// Sagebook · Backblaze B2 client (native API)
// -----------------------------------------------------------------------------
// Used by storage-proxy (uploads + signed downloads for the web app) and
// process-media (fetching captured media for extraction). Credentials live in
// function secrets: B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID, B2_BUCKET_NAME.
// Ingestion storage_path values for this backend are prefixed "b2:".
// =============================================================================

const B2_KEY_ID = Deno.env.get("B2_KEY_ID") ?? "";
const B2_APP_KEY = Deno.env.get("B2_APP_KEY") ?? "";
export const B2_BUCKET_ID = Deno.env.get("B2_BUCKET_ID") ?? "";
export const B2_BUCKET_NAME = Deno.env.get("B2_BUCKET_NAME") ?? "";

export function b2Configured(): boolean {
  return !!(B2_KEY_ID && B2_APP_KEY && B2_BUCKET_ID && B2_BUCKET_NAME);
}

interface B2Auth {
  apiUrl: string;
  downloadUrl: string;
  authToken: string;
  expiresAt: number;
}

let cachedAuth: B2Auth | null = null;

async function authorize(): Promise<B2Auth> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth;

  const basic = btoa(`${B2_KEY_ID}:${B2_APP_KEY}`);
  const res = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    throw new Error(`B2 authorize failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const storage = body?.apiInfo?.storageApi;
  if (!storage?.apiUrl || !body?.authorizationToken) {
    throw new Error("B2 authorize returned an unexpected shape");
  }
  cachedAuth = {
    apiUrl: storage.apiUrl,
    downloadUrl: storage.downloadUrl,
    authToken: body.authorizationToken,
    // Tokens last 24h; refresh well before that.
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
  };
  return cachedAuth;
}

function encodePath(path: string): string {
  // B2 wants each segment percent-encoded but slashes kept.
  return path.split("/").map(encodeURIComponent).join("/");
}

async function sha1Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function b2Upload(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const auth = await authorize();

  const urlRes = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: "POST",
    headers: { Authorization: auth.authToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
  });
  if (!urlRes.ok) {
    throw new Error(`B2 get_upload_url failed: ${urlRes.status} ${await urlRes.text()}`);
  }
  const { uploadUrl, authorizationToken } = await urlRes.json();

  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authorizationToken,
      "X-Bz-File-Name": encodePath(path),
      "Content-Type": contentType || "b2/x-auto",
      "X-Bz-Content-Sha1": await sha1Hex(bytes),
    },
    body: bytes,
  });
  if (!upRes.ok) {
    throw new Error(`B2 upload failed: ${upRes.status} ${await upRes.text()}`);
  }
}

export async function b2Download(
  path: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const auth = await authorize();
  const res = await fetch(
    `${auth.downloadUrl}/file/${B2_BUCKET_NAME}/${encodePath(path)}`,
    { headers: { Authorization: auth.authToken } },
  );
  if (!res.ok) {
    throw new Error(`B2 download failed: ${res.status} ${await res.text()}`);
  }
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Temporary read URL for a single object in the private bucket. */
export async function b2SignedUrl(path: string, validSeconds = 3600): Promise<string> {
  const auth = await authorize();
  const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_download_authorization`, {
    method: "POST",
    headers: { Authorization: auth.authToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: path,
      validDurationInSeconds: validSeconds,
    }),
  });
  if (!res.ok) {
    throw new Error(`B2 download auth failed: ${res.status} ${await res.text()}`);
  }
  const { authorizationToken } = await res.json();
  return `${auth.downloadUrl}/file/${B2_BUCKET_NAME}/${encodePath(path)}?Authorization=${encodeURIComponent(authorizationToken)}`;
}
