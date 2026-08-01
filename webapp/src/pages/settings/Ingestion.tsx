import { useEffect, useState } from "react";
import { Card, CardHeader, PageHeader } from "../components/ui";
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
        <>
            <PageHeader title="Settings" subtitle="How captures reach Sagebook." />

            <Card feature>
                <CardHeader title="Email forwarding" />
                <p className="mb-4 text-sm text-slate-400">
                    Forward receipts, invoices, and bank notifications to your personal Sagebook
                    address. They'll be extracted automatically and appear in your inbox for review.
                </p>

                {loading ? (
                    <div className="h-12 animate-pulse rounded-xl bg-slate-950" />
                ) : addr ? (
                    <div className="flex flex-col gap-3.5">
                        <div className="flex items-center gap-2">
                            <code className="sb-nested min-w-0 flex-1 select-all px-4 py-3 font-mono text-sm">
                                {fullAddress}
                            </code>
                            <button onClick={copyAddress} className="sb-btn sb-btn-ghost shrink-0 !py-3">
                                {copied ? "Copied!" : "Copy"}
                            </button>
                        </div>

                        <div className="sb-nested flex items-center justify-between gap-4 px-4 py-3">
                            <div>
                                <p className="text-sm font-semibold">
                                    {addr.is_active ? "Active" : "Paused"}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {addr.is_active
                                        ? "Incoming emails are being processed"
                                        : "Incoming emails will be rejected"}
                                </p>
                            </div>
                            <button
                                onClick={toggleActive}
                                disabled={toggling}
                                aria-label={
                                    addr.is_active ? "Pause email forwarding" : "Resume email forwarding"
                                }
                                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                                    addr.is_active ? "bg-emerald-400" : "bg-slate-700"
                                }`}
                            >
                                <span
                                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                                        addr.is_active ? "translate-x-5" : "translate-x-0.5"
                                    }`}
                                />
                            </button>
                        </div>

                        <div className="sb-nested px-4 py-3 text-sm text-slate-400">
                            <p className="mb-2 font-semibold text-slate-200">How it works</p>
                            <ol className="list-inside list-decimal space-y-1">
                                <li>Save this address as a contact on your phone</li>
                                <li>When you get a receipt or invoice, forward it to this address</li>
                                <li>Sagebook extracts the transaction and adds it to your inbox</li>
                                <li>Review, categorize, and accept — just like any other capture</li>
                            </ol>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">
                        No forwarding address found. It should be created automatically — try signing
                        out and back in.
                    </p>
                )}
            </Card>
        </>
    );
}
