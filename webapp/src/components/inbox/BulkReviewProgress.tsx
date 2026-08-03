import { dismissBulkReview, useBulkReviewJob } from "../../lib/bulkReviewJob";
import { useSageSession } from "../sage/SageProvider";

/**
 * Persistent bulk-review progress — a fixed card shown on every page while a
 * large inbox accept/reject action runs in chunked requests.
 *
 * Like the "+" bubble, the card shifts left of the docked Sage panel on `lg`
 * so it never covers it. The var is always set (0 when closed) — an undefined
 * var would make the `lg:right-[…]` calc invalid at computed-value time and
 * drop the card to its static position.
 */
export default function BulkReviewProgress() {
	const job = useBulkReviewJob();
	const sage = useSageSession();
	if (job.status === "idle") return null;

	const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

	return (
		<div
			className="fixed bottom-44 right-6 z-50 w-80 max-w-[calc(100vw-3rem)] sb-card p-4 shadow-pop lg:right-[calc(var(--sb-dock-w)_+_1.5rem)]"
			style={
				{
					"--sb-dock-w": sage.open ? `${sage.width}px` : "0px",
				} as React.CSSProperties
			}
		>
			<div className="mb-1 flex items-center justify-between gap-2">
				<span className="truncate text-sm font-medium text-slate-100">
					{job.status === "running" &&
						`Bulk ${job.action === "accept" ? "accepting" : "rejecting"}…`}
					{job.status === "done" && "Bulk review complete"}
					{job.status === "error" && "Bulk review stopped"}
				</span>
				{job.status !== "running" && (
					<button
						className="text-xs text-slate-500 hover:text-slate-300"
						onClick={dismissBulkReview}
					>
						Dismiss
					</button>
				)}
			</div>

			<p className="mb-2 truncate text-xs text-slate-500">
				{job.processed} / {job.total} transactions
			</p>

			<div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-800">
				<div
					className={`h-full rounded-full transition-all duration-300 ${
						job.status === "error" ? "bg-rose-500" : "bg-coral"
					}`}
					style={{ width: `${job.status === "done" ? 100 : pct}%` }}
				/>
			</div>

			<div className="flex items-center justify-between text-xs text-slate-400">
				<span>{job.status === "running" ? `${pct}%` : job.status}</span>
				{job.status === "done" && (
					<span className="text-emerald-400">Inbox updated</span>
				)}
			</div>

			{job.status === "error" && job.error && (
				<p className="mt-2 text-xs text-rose-400">{job.error}</p>
			)}
		</div>
	);
}
