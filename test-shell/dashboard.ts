// =============================================================================
// Sagebook · Dashboard
// Queries v_monthly_summary, v_category_summary, and pending inbox.
// Reads Supabase config + persisted session from the test-shell localStorage.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "sagebook.test-shell.config";

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────

const appEl     = document.getElementById("app")!;
const headerMeta = document.getElementById("headerMeta")!;
const btnRefresh = document.getElementById("btnRefresh") as HTMLButtonElement;

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

function getConfig(): { url: string; key: string } | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const { url, key } = JSON.parse(raw);
        if (url && key) return { url, key };
    } catch { /* ignore */ }
    return null;
}

const cfg = getConfig();

if (!cfg) {
    appEl.innerHTML = `
        <div class="error-card">
            <h2 style="margin-bottom:.75rem">Not connected</h2>
            <p>Open the <a href="/">Test Shell</a>, enter your Supabase URL + key, and sign in first.</p>
        </div>`;
    throw new Error("no config");
}

const supabase: SupabaseClient = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true },
});

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

const now        = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().slice(0, 10);   // "2026-07-01"
const monthLabel = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

function fmt(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        month: "short", day: "numeric",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────────────────────

interface MonthlySummaryRow {
    month: string;
    kind: string;
    currency: string;
    total_amount: number;
    tx_count: number;
}

interface CategorySummaryRow {
    category: string;
    icon: string | null;
    color: string | null;
    currency: string;
    total_amount: number;
    tx_count: number;
}

interface RecentTxRow {
    id: string;
    payee: string | null;
    amount: number;
    currency: string;
    kind: string;
    occurred_at: string;
    category_name: string | null;
    category_icon: string | null;
}

interface PendingRow {
    id: string;
    amount: number;
    currency: string;
}

async function fetchDashboard() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        appEl.innerHTML = `
            <div class="error-card">
                <h2 style="margin-bottom:.75rem">Not signed in</h2>
                <p>Go to the <a href="/">Test Shell</a> and sign in first.</p>
            </div>`;
        return;
    }

    headerMeta.textContent = `${monthLabel} · ${user.email ?? user.id}`;

    // Run all queries in parallel
    const [summaryRes, catsRes, pendingRes, recentRes] = await Promise.all([
        supabase
            .from("v_monthly_summary")
            .select("month, kind, currency, total_amount, tx_count")
            .eq("month", monthStart),

        supabase
            .from("v_category_summary")
            .select("category, icon, color, currency, total_amount, tx_count")
            .eq("month", monthStart)
            .order("total_amount", { ascending: false })
            .limit(8),

        supabase
            .from("v_pending_review")
            .select("id, amount, currency"),

        supabase
            .from("v_pending_review")
            .select("id, payee, amount, currency, kind, occurred_at, category_name, category_icon")
            .order("occurred_at", { ascending: false })
            .limit(5),
    ]);

    const summaryRows = (summaryRes.data ?? []) as MonthlySummaryRow[];
    const catRows     = (catsRes.data ?? []) as CategorySummaryRow[];
    const pending     = (pendingRes.data ?? []) as PendingRow[];
    const recentTxs   = (recentRes.data ?? []) as RecentTxRow[];

    // ── Aggregate KPIs (pick dominant currency) ──────────────────────────────

    // find which currency has the most activity
    const currencyVotes = new Map<string, number>();
    for (const r of summaryRows) {
        currencyVotes.set(r.currency, (currencyVotes.get(r.currency) ?? 0) + r.tx_count);
    }
    // also count pending
    for (const p of pending) {
        currencyVotes.set(p.currency, (currencyVotes.get(p.currency) ?? 0) + 1);
    }

    const baseCurrency = [...currencyVotes.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

    let income   = 0;
    let expenses = 0;
    let incomeTx = 0;
    let expTx    = 0;

    for (const r of summaryRows) {
        if (r.currency !== baseCurrency) continue;
        if (r.kind === "income") {
            income += r.total_amount;
            incomeTx += r.tx_count;
        } else if (r.kind === "expense") {
            expenses += r.total_amount;
            expTx += r.tx_count;
        }
    }

    const net = income - expenses;

    const pendingCount  = pending.length;
    const pendingAmount = pending
        .filter(p => p.currency === baseCurrency)
        .reduce((s, p) => s + p.amount, 0);

    // ── Category bars (expenses only, same currency) ─────────────────────────

    const expCats = catRows.filter(r => r.currency === baseCurrency);
    const maxCat  = expCats[0]?.total_amount ?? 1;

    // ── Render ────────────────────────────────────────────────────────────────

    const multiCurrNote = currencyVotes.size > 1
        ? `<p style="font-size:.78rem;color:var(--muted);margin-bottom:1rem">
               Showing ${baseCurrency} only · ${currencyVotes.size} currencies detected
           </p>`
        : "";

    const catHtml = expCats.length
        ? expCats.map(c => {
            const pct = Math.round((c.total_amount / maxCat) * 100);
            const color = c.color ?? "#64748b";
            return `
            <div class="cat-row">
                <div class="cat-icon">${c.icon ?? "📌"}</div>
                <div class="cat-bar-wrap">
                    <div class="cat-name">
                        <span>${escHtml(c.category)}</span>
                        <span class="cat-amount">${fmt(c.total_amount, baseCurrency)} · ${c.tx_count} tx</span>
                    </div>
                    <div class="cat-bar-bg">
                        <div class="cat-bar" style="width:${pct}%;background:${escHtml(color)}"></div>
                    </div>
                </div>
            </div>`;
        }).join("")
        : `<p class="empty">No accepted transactions this month.</p>`;

    const recentHtml = recentTxs.length
        ? recentTxs.map(tx => {
            const sign = tx.kind === "income" ? "+" : "−";
            const cls  = tx.kind === "income" ? "income" : "expense";
            return `
            <div class="tx-row">
                <div>
                    <div class="tx-payee">${escHtml(tx.payee ?? "Unknown")}</div>
                    <div class="tx-meta">
                        ${tx.category_icon ?? ""} ${escHtml(tx.category_name ?? "Uncategorized")}
                        · ${fmtDate(tx.occurred_at)}
                    </div>
                </div>
                <div class="tx-amount ${cls}">${sign}${fmt(tx.amount, tx.currency)}</div>
            </div>`;
        }).join("")
        : `<p class="empty">No pending transactions.</p>`;

    appEl.innerHTML = `
        ${multiCurrNote}

        <div class="kpi-grid">
            <div class="kpi income">
                <div class="label">Income · ${monthLabel}</div>
                <div class="value">${fmt(income, baseCurrency)}</div>
                <div class="sub">${incomeTx} transaction${incomeTx !== 1 ? "s" : ""} accepted</div>
            </div>
            <div class="kpi expense">
                <div class="label">Expenses · ${monthLabel}</div>
                <div class="value">${fmt(expenses, baseCurrency)}</div>
                <div class="sub">${expTx} transaction${expTx !== 1 ? "s" : ""} accepted</div>
            </div>
            <div class="kpi net ${net >= 0 ? "positive" : "negative"}">
                <div class="label">Net</div>
                <div class="value">${net >= 0 ? "+" : ""}${fmt(net, baseCurrency)}</div>
                <div class="sub">${net >= 0 ? "Surplus" : "Deficit"} this month</div>
            </div>
            <div class="kpi pending">
                <div class="label">Pending review</div>
                <div class="value">${pendingCount}</div>
                <div class="sub">
                    ${pendingCount > 0
                        ? `${fmt(pendingAmount, baseCurrency)} waiting`
                        : "Inbox is clear"}
                </div>
                ${pendingCount > 0
                    ? `<a class="pending-link" href="/">Review in Test Shell →</a>`
                    : ""}
            </div>
        </div>

        <div class="panels">
            <div class="panel">
                <h2>Spending by category</h2>
                ${catHtml}
            </div>
            <div class="panel">
                <h2>Pending inbox (latest ${recentTxs.length})</h2>
                ${recentHtml}
                ${pendingCount > recentTxs.length
                    ? `<p style="margin-top:.75rem;font-size:.8rem;color:var(--muted)">
                           + ${pendingCount - recentTxs.length} more · <a href="/" style="color:var(--blue)">view all</a>
                       </p>`
                    : ""}
            </div>
        </div>`;
}

function escHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

btnRefresh.addEventListener("click", () => { void fetchDashboard(); });

void fetchDashboard();
