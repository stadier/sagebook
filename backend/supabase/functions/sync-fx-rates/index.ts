// =============================================================================
// Sagebook · sync-fx-rates Edge Function
// -----------------------------------------------------------------------------
// Pulls today's USD-based rates and upserts them into public.fx_rates as
// USD → quote rows (latest_fx_rate() resolves any pair via the USD cross).
// Sources: open.er-api.com for fiat (no key), CoinGecko for BTC/ETH (no key).
// Any authenticated user may trigger a sync — rates are shared reference data.
// Intended to run daily (Supabase scheduled function or manual from the app).
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FIAT_URL = "https://open.er-api.com/v6/latest/USD";
const CRYPTO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.get("/sync-fx-rates/health", (c) => c.json({ ok: true }));

app.post("/sync-fx-rates", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return c.json({ error: "invalid session" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Only store rates for currencies the ledger actually knows about.
  const { data: currencies, error: curErr } = await admin
    .from("currencies")
    .select("code");
  if (curErr) {
    return c.json({ error: "could not load currencies", detail: curErr.message }, 500);
  }
  const known = new Set((currencies ?? []).map((r) => String(r.code).trim()));
  const asOf = new Date().toISOString().slice(0, 10);

  const rows: Array<{
    base_code: string;
    quote_code: string;
    rate: number;
    as_of: string;
    source: string;
  }> = [];
  const problems: string[] = [];

  // Fiat rates: response.rates is { EUR: 0.92, NGN: 1530, ... } per 1 USD.
  try {
    const res = await fetch(FIAT_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    const rates = (body?.rates ?? {}) as Record<string, number>;
    for (const [code, rate] of Object.entries(rates)) {
      if (code !== "USD" && known.has(code) && Number.isFinite(rate) && rate > 0) {
        rows.push({
          base_code: "USD",
          quote_code: code,
          rate,
          as_of: asOf,
          source: "open.er-api.com",
        });
      }
    }
  } catch (err) {
    problems.push(`fiat fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Crypto: CoinGecko returns USD per coin; fx_rates stores quote per 1 USD.
  try {
    const res = await fetch(CRYPTO_URL);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json() as Record<string, { usd?: number }>;
    const coins: Array<[string, string]> = [["bitcoin", "BTC"], ["ethereum", "ETH"]];
    for (const [id, code] of coins) {
      const usdPerCoin = body?.[id]?.usd;
      if (known.has(code) && typeof usdPerCoin === "number" && usdPerCoin > 0) {
        rows.push({
          base_code: "USD",
          quote_code: code,
          rate: 1 / usdPerCoin,
          as_of: asOf,
          source: "coingecko",
        });
      }
    }
  } catch (err) {
    problems.push(`crypto fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!rows.length) {
    return c.json({ error: "no rates fetched", problems }, 502);
  }

  const { error: upsertErr } = await admin
    .from("fx_rates")
    .upsert(rows, { onConflict: "base_code,quote_code,as_of" });
  if (upsertErr) {
    return c.json({ error: "upsert failed", detail: upsertErr.message }, 500);
  }

  return c.json({ asOf, updated: rows.length, problems });
});

Deno.serve((req) => app.fetch(req));
