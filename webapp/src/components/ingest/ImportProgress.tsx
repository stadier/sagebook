import { Link } from "react-router-dom";
import { dismissImportJob, useImportJob } from "../../lib/importJob";

/**
 * Persistent import progress — a fixed card shown on every page while a
 * statement import runs in the background, so the user can minimize the import
 * modal and keep working. Rendered once, in AppShell.
 */
export default function ImportProgress() {
    const job = useImportJob();
    if (job.status === "idle") return null;

    const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

    return (
        <div className="fixed bottom-24 right-6 z-50 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-pop">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-100">
                    {job.status === "running" && "Importing…"}
                    {job.status === "done" && "Import complete"}
                    {job.status === "error" && "Import stopped"}
                </span>
                {job.status !== "running" && (
                    <button
                        className="text-xs text-slate-500 hover:text-slate-300"
                        onClick={dismissImportJob}
                    >
                        Dismiss
                    </button>
                )}
            </div>

            <p className="mb-2 truncate text-xs text-slate-500">{job.filename}</p>

            <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        job.status === "error" ? "bg-rose-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${job.status === "done" ? 100 : pct}%` }}
                />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                    {job.processed} / {job.total} rows
                    {job.duplicates > 0 && ` · ${job.duplicates} dup`}
                </span>
                {job.status === "running" && <span>{pct}%</span>}
                {job.status === "done" && (
                    <Link to="/inbox" className="font-medium text-emerald-400 hover:text-emerald-300">
                        Review in inbox →
                    </Link>
                )}
            </div>

            {job.status === "error" && (
                <p className="mt-2 text-xs text-rose-400">
                    {job.error} · {job.committed} of {job.total} imported before it stopped.
                </p>
            )}
        </div>
    );
}
