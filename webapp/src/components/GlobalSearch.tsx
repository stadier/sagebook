/* One search box for the whole app.

   Unlike the CommandPalette next door — which picks a value from a list the
   caller already has — this searches *records*: the ledger, accounts,
   categories, rules, scheduled money, and the app's own pages. It is mounted
   once in the shell so ⌘K reaches it from anywhere.

   Only transactions hit the network. Accounts, the taxonomy, rules and
   scheduled items are already in the query cache for the sidebar and the
   pickers, so searching them is free and instant; asking the server again
   would be slower and no more correct. */

import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { fileNameOf, fmtBytes, fmtDate, fmtMoney } from "../lib/format";
import {
	useAccounts,
	useCategoryById,
	useDocuments,
	useRules,
	useScheduled,
	useTaxonomy,
} from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { SearchIcon } from "./icons";
import { Icon, NAV, SETTINGS_NAV, type IconName } from "./nav";

/** Below this, a substring search matches most of the ledger. */
const MIN_QUERY = 2;
/** Ledger rows fetched per search. Enough to recognise, few enough to scan. */
const TX_LIMIT = 8;
/** Cap on cached-collection matches, per section. */
const SECTION_LIMIT = 5;

interface Hit {
	id: string;
	section: string;
	icon: IconName;
	label: string;
	detail?: string;
	trailing?: string;
	to: string;
}

interface GlobalSearchApi {
	open: () => void;
}

const GlobalSearchContext = createContext<GlobalSearchApi | null>(null);

/** Opens the app-wide search. Safe to call from anywhere inside the shell. */
export function useGlobalSearch(): GlobalSearchApi {
	const api = useContext(GlobalSearchContext);
	if (!api)
		throw new Error(
			"useGlobalSearch must be used inside <GlobalSearchProvider>",
		);
	return api;
}

export function GlobalSearchProvider({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const api = useMemo(() => ({ open }), [open]);

	// ⌘K / Ctrl-K from anywhere, unless the user is typing into something.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
			e.preventDefault();
			setIsOpen(true);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<GlobalSearchContext.Provider value={api}>
			{children}
			{isOpen && <SearchPanel onClose={() => setIsOpen(false)} />}
		</GlobalSearchContext.Provider>
	);
}

/* -------------------------------------------------------------------------- */

function SearchPanel({ onClose }: { onClose: () => void }) {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	// Typing outruns the network; the ledger query follows one beat behind.
	const [debounced, setDebounced] = useState("");
	const [active, setActive] = useState(0);
	const [visible, setVisible] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	const accounts = useAccounts();
	const taxonomy = useTaxonomy();
	const categoryById = useCategoryById();
	const rules = useRules();
	const scheduled = useScheduled();
	const documents = useDocuments();

	useEffect(() => {
		const id = setTimeout(() => setDebounced(query.trim()), 180);
		return () => clearTimeout(id);
	}, [query]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setVisible(true));
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			cancelAnimationFrame(frame);
			document.body.style.overflow = previousOverflow;
		};
	}, []);

	const transactions = useQuery({
		queryKey: ["global-search-tx", debounced],
		enabled: debounced.length >= MIN_QUERY,
		queryFn: async () => {
			// PostgREST needs the wildcards inline, and a comma inside a value
			// would be read as another filter — so drop them from the pattern.
			const safe = debounced.replace(/[,()]/g, " ");
			const { data, error } = await requireSupabase()
				.from("transactions")
				.select("id, summary, payee, memo, amount, currency, kind, occurred_at")
				.eq("review_status", "accepted")
				.or(
					`summary.ilike.%${safe}%,payee.ilike.%${safe}%,memo.ilike.%${safe}%`,
				)
				.order("occurred_at", { ascending: false })
				.limit(TX_LIMIT);
			if (error) throw new Error(error.message);
			return data ?? [];
		},
	});

	const hits = useMemo<Hit[]>(() => {
		const q = debounced.toLowerCase();
		if (q.length < MIN_QUERY) return [];
		const has = (text: string | null | undefined) =>
			(text ?? "").toLowerCase().includes(q);
		const out: Hit[] = [];

		for (const t of transactions.data ?? []) {
			out.push({
				id: `tx-${t.id}`,
				section: "Ledger",
				icon: "transactions",
				label: t.summary ?? t.payee ?? "(no description)",
				detail: `${fmtDate(t.occurred_at)}${t.payee && t.summary ? ` · ${t.payee}` : ""}`,
				trailing: `${t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}${fmtMoney(Number(t.amount), t.currency)}`,
				to: "/transactions",
			});
		}

		// Documents mirror the ledger: file name, kind and summary are the
		// searchable text, and a hit opens the library with that row expanded.
		for (const d of (documents.data ?? [])
			.filter(
				(d) =>
					has(fileNameOf(d.storage_path)) ||
					has(d.media_kind) ||
					has(d.mime_type) ||
					has(d.parsed_payload?.summary),
			)
			.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `doc-${d.id}`,
				section: "Documents",
				icon: "documents",
				label: fileNameOf(d.storage_path),
				detail:
					d.parsed_payload?.summary ??
					`${d.status}${d.mime_type ? ` · ${d.mime_type}` : ""}`,
				trailing: d.bytes ? fmtBytes(d.bytes) : d.media_kind,
				to: `/transactions/documents?doc=${d.id}`,
			});
		}

		for (const a of (accounts.data ?? [])
			.filter((a) => has(a.name) || has(a.institution))
			.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `acct-${a.id}`,
				section: "Accounts",
				icon: "accounts",
				label: a.name,
				detail: a.institution ?? undefined,
				trailing: a.currency,
				to: "/accounts",
			});
		}

		const categories = (taxonomy.data ?? []).flatMap((g) =>
			g.categories
				.filter((c) => has(c.name))
				.map((c) => ({ group: g.name, c })),
		);
		for (const { group, c } of categories.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `cat-${c.id}`,
				section: "Categories",
				icon: "categories",
				label: `${c.icon ?? ""} ${c.name}`.trim(),
				detail: group,
				to: "/categories",
			});
		}

		for (const r of (rules.data ?? [])
			.filter(
				(r) =>
					has(r.name) ||
					has(r.match_value) ||
					has(
						r.set_category_id
							? categoryById.get(r.set_category_id)?.name
							: null,
					),
			)
			.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `rule-${r.id}`,
				section: "Rules",
				icon: "rules",
				label: r.name,
				detail: `${r.match_field} ${r.match_op.replace("_", " ")} "${r.match_value}"`,
				to: "/settings/rules",
			});
		}

		for (const s of (scheduled.data ?? [])
			.filter((s) => has(s.name) || has(s.payee))
			.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `sched-${s.id}`,
				section: "Scheduled",
				icon: "scheduled",
				label: s.name,
				detail: `next ${fmtDate(s.next_due)}`,
				trailing: fmtMoney(Number(s.amount), s.currency),
				to: "/scheduled",
			});
		}

		// Settings sections are destinations too — they are off the rail, so
		// search is the fastest way to reach one by name.
		const destinations = [
			...NAV,
			...SETTINGS_NAV.map((s) => ({ to: s.to, label: s.label, icon: s.icon })),
		];
		for (const item of destinations
			.filter((n) => has(n.label))
			.slice(0, SECTION_LIMIT)) {
			out.push({
				id: `nav-${item.to}`,
				section: "Go to",
				icon: item.icon,
				label: item.label,
				to: item.to,
			});
		}

		return out;
	}, [
		debounced,
		transactions.data,
		documents.data,
		accounts.data,
		taxonomy.data,
		categoryById,
		rules.data,
		scheduled.data,
	]);

	useEffect(() => setActive(0), [hits.length]);

	useEffect(() => {
		listRef.current
			?.querySelector('[data-active="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const choose = useCallback(
		(hit: Hit | undefined) => {
			if (!hit) return;
			navigate(hit.to);
			onClose();
		},
		[navigate, onClose],
	);

	// Bound to the window: the panel is portalled outside React's root, and the
	// search owns the keyboard while it is up.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				choose(hits[active]);
				return;
			}
			const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
			if (step && hits.length) {
				e.preventDefault();
				setActive((i) => (i + step + hits.length) % hits.length);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const searching = debounced.length >= MIN_QUERY;
	const loading = searching && transactions.isLoading;

	return createPortal(
		<div className="fixed inset-0 z-[80] flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]">
			<button
				aria-hidden
				tabIndex={-1}
				onClick={onClose}
				className={`absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px] transition-opacity duration-150 ${
					visible ? "opacity-100" : "opacity-0"
				}`}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search Sagebook"
				className={`sb-cmd relative flex w-full max-w-2xl flex-col transition-all duration-150 ease-out ${
					visible
						? "translate-y-0 scale-100 opacity-100"
						: "-translate-y-2 scale-[0.98] opacity-0"
				}`}
			>
				<div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3.5">
					<span className="shrink-0 text-slate-600">
						<SearchIcon size={17} />
					</span>
					<input
						// eslint-disable-next-line jsx-a11y/no-autofocus
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search transactions, accounts, documents, categories, rules…"
						className="w-full bg-transparent text-[0.9375rem] text-slate-200 outline-none placeholder:text-slate-600"
					/>
					{loading && (
						<span className="shrink-0 text-xs text-slate-500">…</span>
					)}
				</div>

				<div
					ref={listRef}
					role="listbox"
					aria-label="Search results"
					className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-1.5"
				>
					{!searching && (
						<p className="px-3 py-8 text-center text-sm text-slate-500">
							Type at least {MIN_QUERY} characters to search everything you've
							captured.
						</p>
					)}
					{searching && !loading && hits.length === 0 && (
						<p className="px-3 py-8 text-center text-sm text-slate-500">
							Nothing matches “{debounced}”.
						</p>
					)}

					{hits.map((hit, i) => {
						const heading =
							hit.section !== hits[i - 1]?.section ? hit.section : null;
						return (
							<div key={hit.id}>
								{heading && <div className="sb-cmd-heading">{heading}</div>}
								<div
									role="option"
									aria-selected={i === active}
									data-active={i === active}
									onMouseMove={() => setActive(i)}
									onClick={() => choose(hit)}
									className="sb-cmd-item"
								>
									<span className="shrink-0 text-slate-500">
										<Icon name={hit.icon} size={16} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate">{hit.label}</span>
										{hit.detail && (
											<span className="block truncate text-xs text-slate-500">
												{hit.detail}
											</span>
										)}
									</span>
									{hit.trailing && (
										<span className="shrink-0 text-xs text-slate-400 tnum">
											{hit.trailing}
										</span>
									)}
								</div>
							</div>
						);
					})}
				</div>

				<div className="hidden items-center gap-3 border-t border-slate-800 px-4 py-2 text-[0.6875rem] text-slate-500 sm:flex">
					<Key>↑</Key>
					<Key>↓</Key>
					<span>navigate</span>
					<Key>↵</Key>
					<span>open</span>
					<Key>esc</Key>
					<span>close</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function Key({ children }: { children: ReactNode }) {
	return (
		<kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-sans text-[0.6875rem] text-slate-400">
			{children}
		</kbd>
	);
}
