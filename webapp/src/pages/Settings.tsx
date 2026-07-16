import { useEffect, useState } from "react";
import { requireSupabase } from "../lib/supabase";
import type { IngestAddress } from "../lib/types";

const INGEST_DOMAIN = "ingest.sagebook.app";

export default function Settings() {
    const [addr, setAddr] = useState<IngestAddress | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [toggling, setToggling] = useState(false);

    useEffect(() => {
        const sb = requireSupabase();
        sb.from("ingest_addresses")
            .select("id, slug, is_active, created_at")
            .single()
            .then(({ data }) => {
                setAddr(data);
                setLoading(false);
            });
    }, []);

    const fullAddress = addr ? `${addr.slug}@${INGEST_DOMAIN}` : "";

    async function copyAddress() {
        await navigator.clipboard.writeText(fullAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    async function toggleActive() {
        if (!addr) return;
        setToggling(true);
        const sb = requireSupabase();
        const { data } = await sb
            .from("ingest_addresses")
            .update({ is_active: !addr.is_active })
            .eq("id", addr.id)
            .select("id, slug, is_active, created_at")
            .single();
        if (data) setAddr(data);
        setToggling(false);
    }

    return (
        <div className="mx-auto max-w-2xl space-y-8">
            <h1 className="text-2xl font-bold">Settings</h1>

            {/* Email forwarding section */}
            <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
                <div>
                    <h2 className="text-lg font-semibold">Email forwarding</h2>
                    <p className="mt-1 text-sm text-muted">
                        Forward receipts, invoices, and bank notifications to your
                        personal Sagebook address. They'll be extracted automatically
                        and appear in your inbox for review.
                    </p>
                </div>

                {loading ? (
                    <div className="h-12 animate-pulse rounded-xl bg-muted/20" />
                ) : addr ? (
                    <>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 rounded-xl border border-border bg-paper px-4 py-3 text-sm font-mono select-all">
                                {fullAddress}
                            </code>
                            <button
                                onClick={copyAddress}
                                className="shrink-0 rounded-xl border border-border bg-paper px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/20"
                            >
                                {copied ? "Copied!" : "Copy"}
                            </button>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-border bg-paper px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">
                                    {addr.is_active ? "Active" : "Paused"}
                                </p>
                                <p className="text-xs text-muted">
                                    {addr.is_active
                                        ? "Incoming emails are being processed"
                                        : "Incoming emails will be rejected"}
                                </p>
                            </div>
                            <button
                                onClick={toggleActive}
                                disabled={toggling}
                                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                                    addr.is_active ? "bg-emerald-500" : "bg-slate-600"
                                }`}
                            >
                                <span
                                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                                        addr.is_active ? "translate-x-5" : "translate-x-0.5"
                                    }`}
                                />
                            </button>
                        </div>

                        <div className="rounded-xl border border-border bg-paper px-4 py-3 text-sm text-muted space-y-2">
                            <p className="font-medium text-foreground">How it works</p>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>Save this address as a contact on your phone</li>
                                <li>When you get a receipt or invoice, forward it to this address</li>
                                <li>Sagebook extracts the transaction and adds it to your inbox</li>
                                <li>Review, categorize, and accept — just like any other capture</li>
                            </ol>
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-muted">
                        No forwarding address found. It should be created automatically
                        — try signing out and back in.
                    </p>
                )}
            </section>
        </div>
    );
}
