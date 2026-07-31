// =============================================================================
// Sagebook · Edge function HTTP layer
// -----------------------------------------------------------------------------
// Every function used to open with the same forty lines: build a Hono app, wire
// CORS, check the bearer token, construct a user-scoped client to resolve the
// caller, construct a service-role client for the actual work, and parse the
// body. That is all here now.
//
// Typical shape:
//
//   const app = createApp("review-transaction");
//   app.post("/review-transaction", async (c) => {
//     const auth = await requireUser(c);
//     if (!auth.ok) return auth.response;
//     const body = await readJson<Request>(c);
//     if (!body.ok) return body.response;
//     …use auth.userId and auth.admin…
//   });
//   serve(app);
//
// Note on authorisation: `admin` is a service-role client and bypasses RLS, so
// every query it makes must filter on `auth.userId` explicitly.
// =============================================================================

import { type Context, cors, createClient, Hono, type SupabaseClient } from "./deps.ts";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  warnIfMisconfigured,
} from "./env.ts";

/** Headers the browser client sends. `x-file-*` is the storage-proxy upload. */
const DEFAULT_ALLOW_HEADERS = [
  "authorization",
  "content-type",
  "x-client-info",
  "apikey",
];

/** Supabase clients are stateless here — never persist or refresh a session. */
const STATELESS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/**
 * A Hono app with CORS wired and a health endpoint mounted.
 *
 * @param fnName  Function name; also the route prefix for `/health`.
 * @param options.allowHeaders  Extra request headers to permit past CORS.
 * @param options.health  Extra fields to merge into the health response.
 */
export function createApp(
  fnName: string,
  options: { allowHeaders?: string[]; health?: () => Record<string, unknown> } = {},
): Hono {
  warnIfMisconfigured(fnName);

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: [...DEFAULT_ALLOW_HEADERS, ...(options.allowHeaders ?? [])],
      allowMethods: ["POST", "OPTIONS"],
    }),
  );

  app.get(`/${fnName}/health`, (c) => c.json({ ok: true, ...(options.health?.() ?? {}) }));

  return app;
}

/** Service-role client. Bypasses RLS — always scope queries by user id. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, STATELESS);
}

/** Client acting as the caller, used only to resolve their identity. */
function userClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...STATELESS,
    global: { headers: { Authorization: authHeader } },
  });
}

/** A resolved caller plus the admin client their request will run under. */
export interface AuthedRequest {
  ok: true;
  userId: string;
  admin: SupabaseClient;
}

/** Discriminated result: either a value, or the response to return instead. */
export type Guard<T> = T | { ok: false; response: Response };

/**
 * Resolve the bearer token to a user. On failure returns the 401 to return
 * directly, so callers stay a two-line guard rather than a nested try.
 */
export async function requireUser(c: Context): Promise<Guard<AuthedRequest>> {
  const authHeader = c.req.header("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, response: c.json({ error: "missing bearer token" }, 401) };
  }

  const { data, error } = await userClient(authHeader).auth.getUser();
  if (error || !data?.user) {
    return { ok: false, response: c.json({ error: "invalid session" }, 401) };
  }

  return { ok: true, userId: data.user.id, admin: adminClient() };
}

/** A parsed request body, or the 400 to return instead. */
export type ParsedBody<T> = Guard<{ ok: true; body: T }>;

/**
 * Parse a JSON body. Pass `fallback` for endpoints where an empty body is
 * meaningful (summarize-transactions treats it as "use the defaults").
 */
export async function readJson<T>(c: Context, fallback?: T): Promise<ParsedBody<T>> {
  try {
    return { ok: true, body: await c.req.json<T>() };
  } catch {
    if (fallback !== undefined) return { ok: true, body: fallback };
    return { ok: false, response: c.json({ error: "body must be JSON" }, 400) };
  }
}

/**
 * Reject a storage path that is not under the caller's own folder. Paths are
 * either "{userId}/…" (Supabase bucket) or "b2:{userId}/…" (B2 proxy).
 */
export function ownsStoragePath(userId: string, path: string): boolean {
  return path.replace(/^b2:/, "").startsWith(`${userId}/`);
}

/** Message from an unknown throw, without the `instanceof` dance everywhere. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Mount the app on Deno's server. Kept here so every function ends the same. */
export function serve(app: Hono): void {
  Deno.serve((req) => app.fetch(req));
}
