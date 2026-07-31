// =============================================================================
// Sagebook · sync-fx-rates Edge Function
// -----------------------------------------------------------------------------
// Pulls today's USD-based rates and upserts them into public.fx_rates as
// USD → quote rows (latest_fx_rate() resolves any pair via the USD cross).
// Sources: open.er-api.com for fiat (no key), CoinGecko for BTC/ETH (no key).
// Any authenticated user may trigger a sync — rates are shared reference data.
// Intended to run daily (Supabase scheduled function or manual from the app).
// =============================================================================

import { createApp, errorMessage, requireUser, serve } from "../_shared/http.ts";

const FIAT_URL = "https://open.er-api.com/v6/latest/USD";
const CRYPTO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd";

/** CoinGecko ids mapped to the ledger's currency codes. */
const COINS: Array<[id: string, code: string]> = [
  ["bitcoin", "BTC"],
  ["ethereum", "ETH"],
];

interface RateRow {
  base_code: string;
  quote_code: string;
  rate: number;
  as_of: string;
  source: string;
}

const app = createApp("sync-fx-rates");

app.post("/sync-fx-rates", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  // Only store rates for currencies the ledger actually knows about.
  const { data: currencies, error: curErr } = await auth.admin.from("currencies").select("code");
  if (curErr) {
    return c.json({ error: "could not load currencies", detail: curErr.message }, 500);
  }
  const known = new Set((currencies ?? []).map((r) => String(r.code).trim()));
  const asOf = new Date().toISOString().slice(0, 10);

  const rows: RateRow[] = [];
  const problems: string[] = [];

  // Fiat: response.rates is { EUR: 0.92, NGN: 1530, … } per 1 USD — already the
  // orientation fx_rates stores, so these go in as-is.
  try {
    const body = await fetchJson<{ rates?: Record<string, number> }>(FIAT_URL);
    for (const [code, rate] of Object.entries(body?.rates ?? {})) {
      if (code !== "USD" && known.has(code) && Number.isFinite(rate) && rate > 0) {
        rows.push({ base_code: "USD", quote_code: code, rate, as_of: asOf, source: "open.er-api.com" });
      }
    }
  } catch (err) {
    problems.push(`fiat fetch failed: ${errorMessage(err)}`);
  }

  // Crypto: CoinGecko quotes USD *per coin*, so invert to match fx_rates.
  try {
    const body = await fetchJson<Record<string, { usd?: number }>>(CRYPTO_URL);
    for (const [id, code] of COINS) {
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
    problems.push(`crypto fetch failed: ${errorMessage(err)}`);
  }

  if (!rows.length) {
    return c.json({ error: "no rates fetched", problems }, 502);
  }

  const { error: upsertErr } = await auth.admin
    .from("fx_rates")
    .upsert(rows, { onConflict: "base_code,quote_code,as_of" });
  if (upsertErr) {
    return c.json({ error: "upsert failed", detail: upsertErr.message }, 500);
  }

  // `problems` is non-fatal here: one source failing still updates the other.
  return c.json({ asOf, updated: rows.length, problems });
});

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as T;
}

serve(app);
