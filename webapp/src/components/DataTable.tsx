/* The app's one table.

   Every list of records — the ledger, accounts, rules, scheduled money, the
   net-worth breakdown, the activity log — renders through this component, so
   searching, sorting, filtering, paging, column visibility and multi-select
   behave identically everywhere and a page only has to describe its columns.

   Two renderings of the same data are emitted and swapped with a media query
   rather than a resize listener: a real `<table>` from `md` up, and a stacked
   card list below it. A phone never gets a horizontally scrolling grid.

   Colour and spacing decisions live in index.css (`.sb-th`, `.sb-row`,
   `.sb-check`, `.sb-page`, …) — nothing here contains a hex value. */

import {
	Fragment,
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CloseIcon,
	ColumnsIcon,
	DownloadIcon,
	FilterIcon,
	MoreIcon,
	SearchIcon,
	SlidersIcon,
	SortArrowIcon,
	SortIcon,
} from "./icons";
import { Picker } from "./ui";
import { usePersisted } from "../lib/persist";

/* --- Column model ---------------------------------------------------------- */

export type ColumnAlign = "left" | "right" | "center";

/**
 * How a table styles its expense figures, set from the table's Settings menu
 * and persisted per table under `storageKey`. A column opts in by marking
 * itself `amount`; its cell then reads these from the cell context.
 */
export interface AmountPrefs {
	/** Expenses carry a minus sign, e.g. "−$12.50" instead of "$12.50". */
	negativeExpenses: boolean;
	/** Expenses are tinted red to set them apart from income at a glance. */
	redExpenses: boolean;
}

/**
 * Where a column lands in the mobile card.
 * `title` is the headline, `trailing` the right-hand figure, `meta` a
 * label/value line beneath, `hidden` drops out of the card entirely.
 */
export type MobileSlot = "title" | "subtitle" | "trailing" | "meta" | "hidden";

export interface Column<T> {
	/** Stable id — used for sort state, column visibility, and React keys. */
	id: string;
	/** Plain-text name, used in the column menu and as the mobile meta label. */
	label: string;
	/** Header content, when it needs to be richer than `label`. */
	header?: ReactNode;
	/** Small glyph before the header label. */
	icon?: ReactNode;
	/**
	 * `dense` follows the Compact toggle, so a cell can clamp a long secondary
	 * line to one line instead of two.
	 *
	 * To clamp, pair `line-clamp-*` with `break-words`. Both matter: the table
	 * uses auto layout, so a column is sized by its content's *minimum* width,
	 * and a bank narration is one long unbroken token. Without `break-words`
	 * that minimum stays huge and the column simply grows; `truncate` is worse
	 * still, since `nowrap` makes the minimum the entire string.
	 */
	cell: (row: T, ctx: { dense: boolean; amounts: AmountPrefs }) => ReactNode;
	/** Supplying this makes the column sortable. */
	sortValue?: (row: T) => string | number | null | undefined;
	/** Text the global search matches against. Falls back to `sortValue`. */
	searchValue?: (row: T) => string | null | undefined;
	/** Value written to the CSV export. Falls back to `searchValue`/`sortValue`. */
	exportValue?: (row: T) => string | number | null | undefined;
	align?: ColumnAlign;
	/**
	 * Marks the column as a money figure. The table then offers the Settings
	 * menu — "expenses as negative numbers", "expenses in red" — and passes the
	 * chosen `AmountPrefs` into the cell's context so the page can honour them.
	 */
	amount?: boolean;
	/** CSS width for the column, e.g. "12rem" or "1%". */
	width?: string;
	/** false pins the column visible in the column menu. Default true. */
	hideable?: boolean;
	/** Start hidden — the user can turn it on from the column menu. */
	defaultHidden?: boolean;
	mobile?: MobileSlot;
	/** Extra classes on every body cell of this column. */
	cellClassName?: string;
}

export interface SortState {
	columnId: string;
	direction: "asc" | "desc";
}

/* --- Row actions ------------------------------------------------------------
   A row's verbs are described, not drawn. They used to be a row of bare glyphs
   revealed on hover, which meant Archive and Delete were two adjacent unlabelled
   targets — easy to hit the wrong one, impossible to hit either on a phone.
   A page now names its actions and the table renders one handle that opens them
   as a labelled menu. */

export interface RowAction {
	/** The verb, in words. This is the whole affordance — write it plainly. */
	label: string;
	onSelect: () => void;
	icon?: ReactNode;
	/** Secondary text on the right of the entry — a shortcut, a count, a caveat. */
	hint?: string;
	/** Paints it red and drops it below a separator at the foot of the menu. */
	danger?: boolean;
	disabled?: boolean;
	/** Drop the entry entirely — cleaner at a call site than a conditional array. */
	hidden?: boolean;
}

/* --- Props ------------------------------------------------------------------ */

export interface DataTableProps<T> {
	data: T[];
	columns: Array<Column<T>>;
	rowId: (row: T) => string;

	/** Persists column visibility, density and page size under this key. */
	storageKey?: string;

	/* Query state */
	loading?: boolean;
	/** Placeholder for the search box; omit `searchable` to drop the box. */
	searchPlaceholder?: string;
	searchable?: boolean;
	/** Controls rendered inside the filter drawer. */
	filters?: ReactNode;
	/** How many filters currently hold a value — shown on the Filter button. */
	activeFilterCount?: number;
	onClearFilters?: () => void;
	/** Buttons pinned to the right of the toolbar (page-specific verbs). */
	toolbarActions?: ReactNode;
	/**
	 * Base filename (no extension) for the built-in export. Supplying it adds
	 * an Export menu offering the current view as CSV or JSON.
	 */
	exportFilename?: string;
	/**
	 * Extra entries appended to the Export menu — for exports the table can't
	 * do itself, such as "everything matching the filters" when the table only
	 * holds the pages loaded so far.
	 */
	exportActions?: Array<{ label: string; hint?: string; onSelect: () => void }>;
	/** Smallest width the table lays out at before the card scrolls sideways. */
	minWidth?: string;

	/* Sorting */
	initialSort?: SortState;

	/* Selection */
	selectable?: boolean;
	/** Rendered in the selection bar; `clear` empties the selection. */
	bulkActions?: (ctx: {
		ids: string[];
		rows: T[];
		clear: () => void;
	}) => ReactNode;

	/* Rows */
	/** Expandable detail beneath a row; clicking the row toggles it. */
	renderExpanded?: (row: T) => ReactNode;
	/** Drive expansion from the page (e.g. an "Edit" verb opens the panel). */
	expandedIds?: string[];
	onExpandedChange?: (ids: string[]) => void;
	onRowClick?: (row: T) => void;
	/** The row's verbs, opened from a menu at the end of the row. */
	rowActions?: (row: T) => RowAction[];
	/** Names the row in the action menu's accessible name ("Actions for Zenith"). */
	rowLabel?: (row: T) => string;
	rowClassName?: (row: T) => string;

	/* Paging */
	paginated?: boolean;
	defaultPageSize?: number;
	pageSizeOptions?: number[];
	/** Server-side continuation, offered once the last local page is reached. */
	hasMore?: boolean;
	loadingMore?: boolean;
	onLoadMore?: () => void;

	/* States */
	emptyTitle?: string;
	emptyBody?: ReactNode;
	/** Shown at the bottom-left of the footer, beside the row count. */
	footNote?: ReactNode;
	/** Singular noun for counts — "entry" yields "entries". */
	rowNoun?: string;
	/** Override when the plural isn't the regular one. */
	rowNounPlural?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/* --- Small helpers ---------------------------------------------------------- */

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			if (!ref.current?.contains(e.target as Node)) close();
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") close();
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, close]);
	return ref;
}

function textOf(value: string | number | null | undefined): string {
	return value === null || value === undefined ? "" : String(value);
}

const alignClass: Record<ColumnAlign, string> = {
	left: "text-left",
	right: "text-right",
	center: "text-center",
};

/** Page numbers with ellipses: 1 … 4 5 6 … 12. */
function pageList(current: number, total: number): Array<number | "gap"> {
	if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
	const out: Array<number | "gap"> = [1];
	const start = Math.max(2, current - 1);
	const end = Math.min(total - 1, current + 1);
	if (start > 2) out.push("gap");
	for (let i = start; i <= end; i++) out.push(i);
	if (end < total - 1) out.push("gap");
	out.push(total);
	return out;
}

function csvCell(value: string): string {
	return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function download(filename: string, mime: string, content: string) {
	const blob = new Blob([content], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/* --- Row action menu --------------------------------------------------------
   Portalled and positioned from the trigger's rect rather than dropped into the
   cell: the desktop table lives inside `overflow-x-auto`, which clips in both
   axes, so an absolutely-positioned panel would be cut off at the row's edge. */

function RowMenu({ actions, label }: { actions: RowAction[]; label: string }) {
	const [open, setOpen] = useState(false);
	const [at, setAt] = useState<{
		top: number;
		right: number;
		above: boolean;
	} | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const items = actions.filter((a) => !a.hidden);
	const [safe, dangerous] = [
		items.filter((a) => !a.danger),
		items.filter((a) => a.danger),
	];

	function place() {
		const box = triggerRef.current?.getBoundingClientRect();
		if (!box) return;
		// ~44px an entry plus the panel's own padding, enough to know which way
		// to open without measuring the panel itself.
		const needed = items.length * 36 + 24;
		const below = window.innerHeight - box.bottom;
		setAt({
			top: below < needed && box.top > needed ? box.top - 6 : box.bottom + 6,
			right: window.innerWidth - box.right,
			above: below < needed && box.top > needed,
		});
	}

	useEffect(() => {
		if (!open) return;
		function reposition() {
			// A scroll under an open menu detaches it from its row, so close
			// rather than chase the row down the page.
			setOpen(false);
		}
		function onDown(e: MouseEvent) {
			if (!(e.target as HTMLElement).closest("[data-row-menu]")) setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		}
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("resize", reposition);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	if (items.length === 0) return null;

	function entry(action: RowAction, i: number) {
		return (
			<button
				key={`${action.label}-${i}`}
				type="button"
				role="menuitem"
				disabled={action.disabled}
				className={`sb-menu-item ${action.danger ? "is-danger" : ""}`}
				onClick={() => {
					setOpen(false);
					action.onSelect();
				}}
			>
				<span className="grid h-4 w-4 shrink-0 place-items-center opacity-70">
					{action.icon}
				</span>
				<span className="min-w-0 flex-1 truncate">{action.label}</span>
				{action.hint && (
					<span className="shrink-0 text-xs text-slate-500">{action.hint}</span>
				)}
			</button>
		);
	}

	return (
		<span data-row-menu className="inline-flex">
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`Actions for ${label}`}
				title={`Actions for ${label}`}
				className="grid h-7 w-7 place-items-center rounded-lg border border-transparent text-slate-500 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-slate-200 aria-expanded:border-slate-700 aria-expanded:bg-slate-800 aria-expanded:text-slate-200"
				onClick={() => {
					if (!open) place();
					setOpen((v) => !v);
				}}
			>
				<MoreIcon size={16} />
			</button>

			{open &&
				at &&
				createPortal(
					<div
						data-row-menu
						role="menu"
						aria-label={`Actions for ${label}`}
						className="sb-menu"
						style={{
							position: "fixed",
							top: at.above ? undefined : at.top,
							bottom: at.above ? window.innerHeight - at.top : undefined,
							right: at.right,
						}}
					>
						{safe.map(entry)}
						{dangerous.length > 0 && safe.length > 0 && (
							<div className="sb-menu-sep" />
						)}
						{dangerous.map(entry)}
					</div>,
					document.body,
				)}
		</span>
	);
}

/* --- Component -------------------------------------------------------------- */

export function DataTable<T>({
	data,
	columns,
	rowId,
	storageKey,
	loading = false,
	searchable = true,
	searchPlaceholder = "Search…",
	filters,
	activeFilterCount = 0,
	onClearFilters,
	toolbarActions,
	exportFilename,
	exportActions,
	minWidth = "36rem",
	initialSort,
	selectable = false,
	bulkActions,
	renderExpanded,
	expandedIds,
	onExpandedChange,
	onRowClick,
	rowActions,
	rowLabel,
	rowClassName,
	paginated = true,
	defaultPageSize = 25,
	pageSizeOptions = DEFAULT_PAGE_SIZES,
	hasMore = false,
	loadingMore = false,
	onLoadMore,
	emptyTitle = "Nothing here yet",
	emptyBody,
	footNote,
	rowNoun = "row",
	rowNounPlural,
}: DataTableProps<T>) {
	const [prefs, setPrefs] = usePersisted(
		storageKey && `sagebook.webapp.table.${storageKey}`,
		{
			hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id),
			/** Column ids, left to right. Empty means the page's own order. */
			order: [] as string[],
			dense: false,
			pageSize: defaultPageSize,
			/** Expense display, set from the Settings menu (see `Column.amount`). */
			amounts: { negativeExpenses: true, redExpenses: false },
			/** Pixel widths set by dragging a header edge. Empty means the
			    browser's auto layout sizes every column. */
			widths: {} as Record<string, number>,
			/** The user's column sort — `null` once they clear it, `undefined`
			    until they sort once, so the page's `initialSort` is the fallback. */
			sort: undefined as SortState | null | undefined,
			/** The search box text, so a reload comes back mid-search. */
			search: "",
		},
	);

	const pageSizeOpts = useMemo(
		() =>
			pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / page` })),
		[pageSizeOptions],
	);

	const [search, setSearch] = useState(prefs.search ?? "");
	const [sort, setSort] = useState<SortState | null>(
		prefs.sort !== undefined ? prefs.sort : (initialSort ?? null),
	);
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [ownExpanded, setOwnExpanded] = useState<string[]>([]);
	const expanded = useMemo(
		() => new Set(expandedIds ?? ownExpanded),
		[expandedIds, ownExpanded],
	);
	const [filtersOpen, setFiltersOpen] = useState(false);
	/* Checkboxes are opt-in. A gutter of empty boxes on every row is a
       permanent cost for an occasional action, so selecting is a mode you turn
       on — and leaving it drops the selection with it. */
	const [selecting, setSelecting] = useState(false);
	const selectionOn = selectable && selecting;

	function endSelecting() {
		setSelecting(false);
		setSelected(new Set());
	}
	const [menu, setMenu] = useState<
		"columns" | "sort" | "export" | "settings" | null
	>(null);

	const closeMenu = () => setMenu(null);
	const columnsRef = useDismiss(menu === "columns", closeMenu);
	const sortRef = useDismiss(menu === "sort", closeMenu);
	const exportRef = useDismiss(menu === "export", closeMenu);
	const settingsRef = useDismiss(menu === "settings", closeMenu);

	const hiddenIds = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

	/* Column resize. Committed widths live in `prefs.widths` (saved on release,
       so they survive reloads); `dragWidths` is the transient state while a
       handle is held, so a pointermove never writes localStorage per frame. */
	const thRefs = useRef(new Map<string, HTMLTableCellElement>());
	const [dragWidths, setDragWidths] = useState<Record<string, number> | null>(
		null,
	);
	const renderWidths = dragWidths ?? prefs.widths;
	/* Fixed layout once the user has sized anything: auto layout is the better
       default, but honouring a width the user set is the whole point. */
	const fixedLayout = Object.keys(renderWidths).length > 0;
	const resizing = dragWidths !== null;

	const MIN_COL_WIDTH = 48;

	function setThRef(key: string) {
		return (el: HTMLTableCellElement | null) => {
			if (el) thRefs.current.set(key, el);
			else thRefs.current.delete(key);
		};
	}

	/* The active drag's cleanup, so a new drag can disarm a previous one whose
       pointerup was missed (e.g. the pointer left the window mid-drag). */
	const resizeDrag = useRef<{ finish: () => void } | null>(null);

	/**
	 * Begin dragging a header edge. The first drag of a session snapshots every
	 * visible column's rendered width, so switching from auto to fixed layout
	 * reflows nothing — from then on the widths are real pixels the user owns.
	 *
	 * Move/up listeners go on `window` rather than a captured pointer: a resize
	 * is exactly the gesture where the cursor may outrun the handle.
	 */
	function startResize(id: string, e: ReactPointerEvent<HTMLSpanElement>) {
		e.preventDefault();
		e.stopPropagation();
		resizeDrag.current?.finish();

		const snapshot: Record<string, number> = {};
		thRefs.current.forEach((el, key) => {
			snapshot[key] = el.getBoundingClientRect().width;
		});
		const base = { ...snapshot, ...prefs.widths };
		const startX = e.clientX;
		const startWidth = base[id] ?? snapshot[id] ?? 160;
		let current = base;
		let moved = false;

		function move(ev: PointerEvent) {
			if (Math.abs(ev.clientX - startX) < 2) return;
			moved = true;
			current = {
				...base,
				[id]: Math.max(MIN_COL_WIDTH, startWidth + ev.clientX - startX),
			};
			setDragWidths(current);
		}
		function finish() {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", finish);
			window.removeEventListener("pointercancel", finish);
			resizeDrag.current = null;
			// A plain click on the handle is a no-op — only an actual drag
			// should make widths stick (so double-click reset is clean).
			if (moved) setPrefs({ ...prefs, widths: current });
			setDragWidths(null);
		}
		resizeDrag.current = { finish };
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", finish);
		window.addEventListener("pointercancel", finish);
	}

	/** Double-click a header edge to hand that column back to auto layout. */
	function resetWidth(id: string) {
		const { [id]: _dropped, ...rest } = prefs.widths;
		setPrefs({ ...prefs, widths: rest });
	}

	/* The user's left-to-right order, if they've set one. A column the page has
       added since then isn't in the stored list, so it keeps its declared
       position rather than being dropped or shunted to the end. */
	const orderedColumns = useMemo(() => {
		if (prefs.order.length === 0) return columns;
		const rank = new Map(prefs.order.map((id, i) => [id, i]));
		const fallback = (i: number) => {
			// Sit an unknown column just after the declared column before it.
			for (let j = i - 1; j >= 0; j--) {
				const r = rank.get(columns[j].id);
				if (r !== undefined) return r + 0.5;
			}
			return -1;
		};
		return columns
			.map((c, i) => ({ c, r: rank.get(c.id) ?? fallback(i) }))
			.sort((a, b) => a.r - b.r)
			.map((x) => x.c);
	}, [columns, prefs.order]);

	const visibleColumns = orderedColumns.filter((c) => !hiddenIds.has(c.id));
	const sortableColumns = orderedColumns.filter((c) => c.sortValue);
	/* The Settings menu only earns its place where an amount column is visible
       — on a table of names and dates it would offer nothing to change. */
	const hasAmountColumns = visibleColumns.some((c) => c.amount);

	/* Search → sort. Both are pure derivations of `data`, so a refetch never
       drops the user's view. */
	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return data;
		return data.filter((row) =>
			columns.some((c) => {
				const raw = c.searchValue
					? c.searchValue(row)
					: c.sortValue
						? c.sortValue(row)
						: null;
				return textOf(raw).toLowerCase().includes(term);
			}),
		);
	}, [data, columns, search]);

	const sorted = useMemo(() => {
		if (!sort) return filtered;
		const column = columns.find((c) => c.id === sort.columnId);
		if (!column?.sortValue) return filtered;
		const direction = sort.direction === "asc" ? 1 : -1;
		return [...filtered].sort((a, b) => {
			const av = column.sortValue!(a);
			const bv = column.sortValue!(b);
			// Blanks sort last regardless of direction — an empty cell is never
			// "the biggest" thing in a column.
			const aEmpty = av === null || av === undefined || av === "";
			const bEmpty = bv === null || bv === undefined || bv === "";
			if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
			if (typeof av === "number" && typeof bv === "number") {
				return (av - bv) * direction;
			}
			return (
				String(av).localeCompare(String(bv), undefined, { numeric: true }) *
				direction
			);
		});
	}, [filtered, columns, sort]);

	const pageSize = paginated ? prefs.pageSize : sorted.length || 1;
	const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
	const currentPage = Math.min(page, pageCount);
	const pageRows = paginated
		? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
		: sorted;

	// Any change to the view resets to the first page; a stale page number
	// would otherwise show an empty table after a filter narrows the results.
	useEffect(() => {
		setPage(1);
	}, [search, data.length, sort?.columnId, sort?.direction, pageSize]);

	// Selections only mean anything for rows still on screen.
	useEffect(() => {
		setSelected((prev) => {
			if (prev.size === 0) return prev;
			const live = new Set(data.map(rowId));
			const next = new Set([...prev].filter((id) => live.has(id)));
			return next.size === prev.size ? prev : next;
		});
		// rowId is a render-scoped closure; data identity is the real trigger.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data]);

	const selectedRows = data.filter((r) => selected.has(rowId(r)));
	const pageIds = pageRows.map(rowId);
	const allPageSelected =
		pageIds.length > 0 && pageIds.every((id) => selected.has(id));
	const somePageSelected = pageIds.some((id) => selected.has(id));

	const headCheckRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (headCheckRef.current) {
			headCheckRef.current.indeterminate = somePageSelected && !allPageSelected;
		}
	}, [somePageSelected, allPageSelected]);

	function toggleRow(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function togglePageSelection(on: boolean) {
		setSelected((prev) => {
			const next = new Set(prev);
			for (const id of pageIds) {
				if (on) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	}

	function toggleExpanded(id: string) {
		const next = expanded.has(id)
			? [...expanded].filter((x) => x !== id)
			: [...expanded, id];
		if (expandedIds) onExpandedChange?.(next);
		else setOwnExpanded(next);
	}

	/** asc → desc → unsorted, so a header click is always reversible. The
	    result is persisted, so the table reloads with the same view. */
	function cycleSort(columnId: string) {
		const next: SortState | null =
			sort?.columnId !== columnId
				? { columnId, direction: "asc" }
				: sort.direction === "asc"
					? { columnId, direction: "desc" }
					: null;
		setSort(next);
		setPrefs({ ...prefs, sort: next });
	}

	function toggleColumn(id: string) {
		const next = hiddenIds.has(id)
			? prefs.hidden.filter((h) => h !== id)
			: [...prefs.hidden, id];
		setPrefs({ ...prefs, hidden: next });
	}

	/** Flip one of the amount display options from the Settings menu. */
	function toggleAmounts(patch: Partial<AmountPrefs>) {
		setPrefs({ ...prefs, amounts: { ...prefs.amounts, ...patch } });
	}

	/**
	 * Shift a column one place left or right. The step is measured against the
	 * *visible* neighbours, so a hidden column in between never makes a press
	 * look like it did nothing.
	 */
	function moveColumn(id: string, direction: -1 | 1) {
		const ids = orderedColumns.map((c) => c.id);
		const visibleIds = visibleColumns.map((c) => c.id);
		const target = visibleIds[visibleIds.indexOf(id) + direction];
		if (!target) return; // already at the end it was heading for
		const next = ids.filter((x) => x !== id);
		next.splice(next.indexOf(target) + (direction === 1 ? 1 : 0), 0, id);
		setPrefs({ ...prefs, order: next });
	}

	/** The value a column contributes to an export, in preference order. */
	function exportValueOf(column: Column<T>, row: T): string {
		const raw = column.exportValue
			? column.exportValue(row)
			: column.searchValue
				? column.searchValue(row)
				: column.sortValue
					? column.sortValue(row)
					: "";
		return textOf(raw);
	}

	/** The rows as shown — filtered, sorted, every page, visible columns only. */
	function exportView(format: "csv" | "json") {
		const cols = visibleColumns;
		if (format === "json") {
			const records = sorted.map((row) =>
				Object.fromEntries(cols.map((c) => [c.label, exportValueOf(c, row)])),
			);
			download(
				`${exportFilename}.json`,
				"application/json",
				JSON.stringify(records, null, 2),
			);
			return;
		}
		const header = cols.map((c) => csvCell(c.label)).join(",");
		const body = sorted.map((row) =>
			cols.map((c) => csvCell(exportValueOf(c, row))).join(","),
		);
		download(`${exportFilename}.csv`, "text/csv", [header, ...body].join("\n"));
	}

	const dense = prefs.dense;
	const cellPad = dense ? "!py-[0.4375rem]" : "";
	const total = sorted.length;
	const firstRow = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
	const lastRow = Math.min(currentPage * pageSize, total);
	const countNoun =
		total === 1
			? rowNoun
			: (rowNounPlural ??
				(rowNoun.endsWith("y") ? `${rowNoun.slice(0, -1)}ies` : `${rowNoun}s`));

	const showEmpty = !loading && total === 0;
	const leadColSpan =
		visibleColumns.length + (selectionOn ? 1 : 0) + (rowActions ? 1 : 0);

	return (
		<div className="flex flex-col gap-3">
			{/* --- Toolbar ------------------------------------------------- */}
			<div className="flex flex-wrap items-center gap-2">
				{searchable && (
					<div className="relative min-w-0 flex-1 sm:min-w-[15rem] sm:max-w-[20rem]">
						<SearchIcon
							size={15}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
						/>
						<input
							className="sb-input !py-[0.4375rem] !pl-9 !pr-8 text-[0.8125rem]"
							placeholder={searchPlaceholder}
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								setPrefs({ ...prefs, search: e.target.value });
							}}
							aria-label={searchPlaceholder}
						/>
						{search && (
							<button
								aria-label="Clear search"
								onClick={() => {
									setSearch("");
									setPrefs({ ...prefs, search: "" });
								}}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300"
							>
								<CloseIcon size={14} />
							</button>
						)}
					</div>
				)}

				{filters && (
					<button
						className={`sb-tbtn ${activeFilterCount > 0 ? "is-on" : ""}`}
						aria-expanded={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
					>
						<FilterIcon size={15} />
						Filter
						{activeFilterCount > 0 && (
							<span className="sb-tbtn-count">{activeFilterCount}</span>
						)}
					</button>
				)}

				{sortableColumns.length > 0 && (
					<div className="relative" ref={sortRef}>
						<button
							className={`sb-tbtn ${sort ? "is-on" : ""}`}
							aria-expanded={menu === "sort"}
							onClick={() => setMenu(menu === "sort" ? null : "sort")}
						>
							<SortIcon size={15} />
							Sort
						</button>
						{menu === "sort" && (
							<div className="sb-menu left-0 top-[calc(100%+0.375rem)]">
								{sortableColumns.map((c) => (
									<button
										key={c.id}
										className="sb-menu-item"
										onClick={() => {
											cycleSort(c.id);
										}}
									>
										<SortArrowIcon
											direction={
												sort?.columnId === c.id ? sort.direction : null
											}
										/>
										<span className="min-w-0 flex-1 truncate">{c.label}</span>
										{sort?.columnId === c.id && (
											<span className="text-xs text-slate-500">
												{sort.direction === "asc" ? "A→Z" : "Z→A"}
											</span>
										)}
									</button>
								))}
								{sort && (
									<button
										className="sb-menu-item text-slate-500"
										onClick={() => {
											setSort(null);
											setPrefs({ ...prefs, sort: null });
										}}
									>
										<CloseIcon size={14} />
										Clear sort
									</button>
								)}
							</div>
						)}
					</div>
				)}

				<div className="ml-auto flex flex-wrap items-center gap-2">
					{toolbarActions}

					{selectable && (
						<button
							className={`sb-tbtn ${selecting ? "is-on" : ""}`}
							aria-pressed={selecting}
							title={
								selecting
									? "Done selecting — hides the checkboxes"
									: "Show checkboxes to act on several rows at once"
							}
							onClick={() => (selecting ? endSelecting() : setSelecting(true))}
						>
							<CheckIcon size={15} />
							<span className="hidden sm:inline">
								{selecting ? "Done" : "Select"}
							</span>
						</button>
					)}

					{exportFilename && (
						<div className="relative" ref={exportRef}>
							<button
								className="sb-tbtn"
								aria-expanded={menu === "export"}
								disabled={total === 0}
								onClick={() => setMenu(menu === "export" ? null : "export")}
							>
								<DownloadIcon size={15} />
								<span className="hidden sm:inline">Export</span>
								<ChevronDownIcon size={13} className="text-slate-600" />
							</button>
							{menu === "export" && (
								<div className="sb-menu right-0 top-[calc(100%+0.375rem)]">
									<div className="px-2 pb-1 pt-1 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-slate-500">
										This view · {total} {countNoun}
									</div>
									{(["csv", "json"] as const).map((format) => (
										<button
											key={format}
											className="sb-menu-item"
											onClick={() => {
												exportView(format);
												closeMenu();
											}}
										>
											<DownloadIcon size={14} className="text-slate-500" />
											{format.toUpperCase()}
										</button>
									))}
									{exportActions && exportActions.length > 0 && (
										<div className="mt-1 border-t border-slate-800 pt-1">
											{exportActions.map((action) => (
												<button
													key={action.label}
													className="sb-menu-item"
													title={action.hint}
													onClick={() => {
														action.onSelect();
														closeMenu();
													}}
												>
													<DownloadIcon size={14} className="text-slate-500" />
													<span className="min-w-0 flex-1">{action.label}</span>
												</button>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{hasAmountColumns && (
						<div className="relative" ref={settingsRef}>
							<button
								className="sb-tbtn"
								aria-expanded={menu === "settings"}
								onClick={() => setMenu(menu === "settings" ? null : "settings")}
							>
								<SlidersIcon size={15} />
								<span className="hidden sm:inline">Settings</span>
								<ChevronDownIcon size={13} className="text-slate-600" />
							</button>
							{menu === "settings" && (
								<div className="sb-menu right-0 top-[calc(100%+0.375rem)]">
									<div className="px-2 pb-1 pt-1 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-slate-500">
										Amounts
									</div>
									<button
										className="sb-menu-item"
										title={
											prefs.amounts.negativeExpenses
												? "Expenses carry a minus sign — e.g. −$12.50"
												: "Expenses show as plain numbers, e.g. $12.50"
										}
										onClick={() =>
											toggleAmounts({
												negativeExpenses: !prefs.amounts.negativeExpenses,
											})
										}
									>
										<span
											className={`grid h-4 w-4 place-items-center rounded ${
												prefs.amounts.negativeExpenses
													? "text-coral"
													: "text-transparent"
											}`}
										>
											<CheckIcon size={13} />
										</span>
										<span className="min-w-0 flex-1 truncate">
											Expenses as negative numbers
										</span>
									</button>
									<button
										className="sb-menu-item"
										title={
											prefs.amounts.redExpenses
												? "Expenses are tinted red"
												: "Expenses use the table's default ink"
										}
										onClick={() =>
											toggleAmounts({
												redExpenses: !prefs.amounts.redExpenses,
											})
										}
									>
										<span
											className={`grid h-4 w-4 place-items-center rounded ${
												prefs.amounts.redExpenses
													? "text-coral"
													: "text-transparent"
											}`}
										>
											<CheckIcon size={13} />
										</span>
										<span className="min-w-0 flex-1 truncate">
											Expenses in red
										</span>
									</button>
								</div>
							)}
						</div>
					)}

					<div className="relative" ref={columnsRef}>
						<button
							className="sb-tbtn"
							aria-expanded={menu === "columns"}
							onClick={() => setMenu(menu === "columns" ? null : "columns")}
						>
							<ColumnsIcon size={15} />
							<span className="hidden sm:inline">View</span>
							<ChevronDownIcon size={13} className="text-slate-600" />
						</button>
						{menu === "columns" && (
							<div className="sb-menu right-0 top-[calc(100%+0.375rem)]">
								<div className="px-2 pb-1 pt-1 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-slate-500">
									Columns · drag a header edge to resize
								</div>
								{orderedColumns.map((c) => {
									const locked = c.hideable === false;
									const on = !hiddenIds.has(c.id);
									const at = visibleColumns.findIndex((v) => v.id === c.id);
									return (
										<div
											key={c.id}
											className="flex items-center gap-1 rounded-md pr-1 hover:bg-slate-800"
										>
											<button
												className="sb-menu-item min-w-0 flex-1 hover:bg-transparent disabled:opacity-40"
												disabled={locked}
												title={
													locked
														? `${c.label} can't be hidden`
														: on
															? `Hide ${c.label}`
															: `Show ${c.label}`
												}
												onClick={() => toggleColumn(c.id)}
											>
												<span
													className={`grid h-4 w-4 place-items-center rounded ${
														on ? "text-coral" : "text-transparent"
													}`}
												>
													<CheckIcon size={13} />
												</span>
												<span className="min-w-0 flex-1 truncate">
													{c.label}
												</span>
											</button>
											<button
												aria-label={`Move ${c.label} left`}
												title={`Move ${c.label} left`}
												className="grid h-6 w-5 place-items-center rounded text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-25 disabled:hover:bg-transparent"
												disabled={!on || at <= 0}
												onClick={() => moveColumn(c.id, -1)}
											>
												<ChevronLeftIcon size={13} />
											</button>
											<button
												aria-label={`Move ${c.label} right`}
												title={`Move ${c.label} right`}
												className="grid h-6 w-5 place-items-center rounded text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-25 disabled:hover:bg-transparent"
												disabled={
													!on || at < 0 || at >= visibleColumns.length - 1
												}
												onClick={() => moveColumn(c.id, 1)}
											>
												<ChevronRightIcon size={13} />
											</button>
										</div>
									);
								})}
								<div className="mt-1 border-t border-slate-800 pt-1">
									<button
										className="sb-menu-item"
										title="Tighter rows, and long secondary lines clamp to one line"
										onClick={() => setPrefs({ ...prefs, dense: !dense })}
									>
										<span
											className={`grid h-4 w-4 place-items-center rounded ${
												dense ? "text-coral" : "text-transparent"
											}`}
										>
											<CheckIcon size={13} />
										</span>
										Compact rows
									</button>
									{(prefs.hidden.length > 0 ||
										prefs.order.length > 0 ||
										Object.keys(prefs.widths).length > 0) && (
										<button
											className="sb-menu-item text-slate-500"
											title="Back to this page's own columns, order and widths"
											onClick={() =>
												setPrefs({
													...prefs,
													// Back to the defaults, which is not the same
													// as showing everything — some columns ship
													// hidden on purpose.
													hidden: columns
														.filter((c) => c.defaultHidden)
														.map((c) => c.id),
													order: [],
													widths: {},
												})
											}
										>
											<span className="w-4" />
											Reset columns
										</button>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* --- Filter drawer -------------------------------------------- */}
			{filters && filtersOpen && (
				<div className="sb-card p-4">
					<div className="mb-3 flex items-center justify-between gap-3">
						<span className="sb-eyebrow">Filters</span>
						<div className="flex items-center gap-3">
							{activeFilterCount > 0 && onClearFilters && (
								<button
									className="text-xs font-semibold text-slate-500 hover:text-slate-300"
									onClick={onClearFilters}
								>
									Clear all
								</button>
							)}
							<button
								aria-label="Close filters"
								className="text-slate-600 hover:text-slate-300"
								onClick={() => setFiltersOpen(false)}
							>
								<CloseIcon size={15} />
							</button>
						</div>
					</div>
					{filters}
				</div>
			)}

			{/* --- Selection bar --------------------------------------------- */}
			{selectionOn && selected.size > 0 && (
				<div className="sb-card flex flex-wrap items-center gap-2.5 border border-coral/30 px-4 py-2.5">
					<span className="text-[0.8125rem] font-bold text-slate-200">
						{selected.size} selected
					</span>
					<button
						className="text-xs font-semibold text-slate-500 hover:text-slate-300"
						onClick={() => setSelected(new Set())}
					>
						Clear
					</button>
					{selected.size < total && (
						<button
							className="text-xs font-semibold text-sky-300 hover:text-sky-200"
							onClick={() => setSelected(new Set(sorted.map(rowId)))}
						>
							Select all {total}
						</button>
					)}
					<span className="ml-auto flex flex-wrap items-center gap-2">
						{bulkActions?.({
							ids: [...selected],
							rows: selectedRows,
							clear: () => setSelected(new Set()),
						})}
					</span>
				</div>
			)}

			{/* --- The table ------------------------------------------------- */}
			<div className="sb-card">
				{loading && total === 0 ? (
					<SkeletonRows columns={Math.min(visibleColumns.length, 4)} />
				) : showEmpty ? (
					<div className="px-5 py-14 text-center">
						<p className="text-[0.9375rem] font-bold text-slate-200">
							{emptyTitle}
						</p>
						{emptyBody && (
							<p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] text-slate-500">
								{emptyBody}
							</p>
						)}
					</div>
				) : (
					<>
						{/* Desktop: a real table. */}
						{/* Auto layout, deliberately. `table-fixed` honours every
                            declared width literally, which starves the one
                            flexible column and shrinks the checkbox gutter to
                            its stated 1%. A cell clamps itself instead — see
                            the note on `Column.cell`. */}
						{/* `relative` is load-bearing, not decoration. An absolutely
                            positioned descendant — the `sr-only` label on the
                            actions header below is one — resolves against the
                            nearest positioned ancestor, and without one here that
                            is the viewport: it then escapes both this scroller and
                            the card's `overflow: hidden`, and parks itself at the
                            far edge of a wide table. The document grows a
                            horizontal scrollbar for a 1px label, which steals
                            15px of height, which pushes the shell's `h-screen`
                            past the viewport and grows a *second* vertical
                            scrollbar beside the one `main` already owns. */}
						<div
							className={`relative hidden overflow-x-auto md:block ${
								resizing ? "cursor-col-resize select-none" : ""
							}`}
						>
							<table
								className={`w-full border-collapse text-sm ${
									fixedLayout ? "table-fixed" : ""
								}`}
								style={{ minWidth }}
							>
								<thead className="sb-thead">
									<tr>
										{selectionOn && (
											<th
												scope="col"
												ref={setThRef("__check")}
												className="sb-th sb-col-pin bg-slate-950 !px-4"
												style={{
													width: fixedLayout
														? (renderWidths.__check ?? "3rem")
														: "1%",
												}}
											>
												<input
													ref={headCheckRef}
													type="checkbox"
													className="sb-check"
													aria-label="Select all rows on this page"
													checked={allPageSelected}
													onChange={(e) =>
														togglePageSelection(e.target.checked)
													}
												/>
											</th>
										)}
										{visibleColumns.map((c) => {
											const active = sort?.columnId === c.id;
											const direction = active ? sort!.direction : null;
											const w = renderWidths[c.id];
											return (
												<th
													key={c.id}
													scope="col"
													ref={setThRef(c.id)}
													className={`sb-th ${alignClass[c.align ?? "left"]}`}
													style={
														w
															? { width: w }
															: c.width
																? { width: c.width }
																: undefined
													}
													aria-sort={
														active
															? direction === "asc"
																? "ascending"
																: "descending"
															: c.sortValue
																? "none"
																: undefined
													}
												>
													{c.sortValue ? (
														<button
															className="sb-th-sortable"
															onClick={() => cycleSort(c.id)}
															title={`Sort by ${c.label}`}
														>
															{c.icon}
															{c.header ?? c.label}
															<SortArrowIcon direction={direction} />
														</button>
													) : (
														<span className="inline-flex items-center gap-1.5">
															{c.icon}
															{c.header ?? c.label}
														</span>
													)}
													<span
														aria-hidden="true"
														className="sb-col-resize"
														title="Drag to resize · double-click to reset"
														onPointerDown={(e) => startResize(c.id, e)}
														onDoubleClick={() => resetWidth(c.id)}
													/>
												</th>
											);
										})}
										{rowActions && (
											<th
												scope="col"
												ref={setThRef("__actions")}
												className="sb-th text-right"
												style={{
													width: fixedLayout
														? (renderWidths.__actions ?? "3rem")
														: "1%",
												}}
											>
												<span className="sr-only">Actions</span>
											</th>
										)}
									</tr>
								</thead>
								<tbody>
									{pageRows.map((row) => {
										const id = rowId(row);
										const isSelected = selected.has(id);
										const isOpen = expanded.has(id);
										const clickable = !!renderExpanded || !!onRowClick;
										return (
											<Fragment key={id}>
												<tr
													data-row-id={id}
													className={`sb-row ${
														isSelected ? "is-selected" : ""
													} ${clickable ? "cursor-pointer" : ""} ${
														rowClassName?.(row) ?? ""
													}`}
													onClick={() => {
														if (renderExpanded) toggleExpanded(id);
														onRowClick?.(row);
													}}
												>
													{selectionOn && (
														<td
															className={`sb-td sb-col-pin !px-4 ${cellPad}`}
															onClick={(e) => e.stopPropagation()}
														>
															<input
																type="checkbox"
																className="sb-check"
																aria-label="Select row"
																checked={isSelected}
																onChange={() => toggleRow(id)}
															/>
														</td>
													)}
													{visibleColumns.map((c) => (
														<td
															key={c.id}
															className={`sb-td ${cellPad} ${
																alignClass[c.align ?? "left"]
															} ${c.cellClassName ?? ""}`}
														>
															{c.cell(row, {
																dense,
																amounts: prefs.amounts,
															})}
														</td>
													))}
													{rowActions && (
														<td
															className={`sb-td ${cellPad} text-right`}
															onClick={(e) => e.stopPropagation()}
														>
															<span className="sb-row-actions inline-flex items-center gap-2 whitespace-nowrap">
																<RowMenu
																	actions={rowActions(row)}
																	label={rowLabel?.(row) ?? "this row"}
																/>
															</span>
														</td>
													)}
												</tr>
												{isOpen && renderExpanded && (
													<tr className="border-t border-slate-800">
														<td
															colSpan={leadColSpan}
															className="bg-slate-950 px-5 py-4"
														>
															{renderExpanded(row)}
														</td>
													</tr>
												)}
											</Fragment>
										);
									})}
								</tbody>
							</table>
						</div>

						{/* Mobile: the same rows, stacked. */}
						<div className="md:hidden">
							{pageRows.map((row) => (
								<div key={rowId(row)} data-row-id={rowId(row)}>
									<MobileRow
										row={row}
										columns={visibleColumns}
										selectable={selectionOn}
										selected={selected.has(rowId(row))}
										onToggleSelect={() => toggleRow(rowId(row))}
										expanded={expanded.has(rowId(row))}
										onClick={() => {
											if (renderExpanded) toggleExpanded(rowId(row));
											onRowClick?.(row);
										}}
										renderExpanded={renderExpanded}
										rowActions={rowActions}
										rowLabel={rowLabel}
										dense={dense}
										amounts={prefs.amounts}
										className={rowClassName?.(row) ?? ""}
									/>
								</div>
							))}
						</div>
					</>
				)}

				{/* --- Footer ------------------------------------------------ */}
				{(total > 0 || footNote) && (
					<div className="flex flex-col gap-3 border-t border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.78125rem] text-slate-500">
							{total > 0 && (
								<span className="whitespace-nowrap">
									Showing{" "}
									<span className="font-semibold text-slate-300 tnum">
										{firstRow}–{lastRow}
									</span>{" "}
									of{" "}
									<span className="font-semibold text-slate-300 tnum">
										{total}
										{hasMore ? "+" : ""}
									</span>{" "}
									{countNoun}
								</span>
							)}
							{footNote && <span className="min-w-0">{footNote}</span>}
						</div>

						<div className="flex flex-wrap items-center gap-2">
							{paginated && total > pageSizeOptions[0] && (
								<Picker
									className="!w-auto !py-1 text-xs"
									options={pageSizeOpts}
									value={String(prefs.pageSize)}
									aria-label="Rows per page"
									title="Rows per page"
									onChange={(v) => setPrefs({ ...prefs, pageSize: Number(v) })}
								/>
							)}

							{paginated && pageCount > 1 && (
								<nav
									className="flex items-center gap-1"
									aria-label="Pagination"
								>
									<button
										className="sb-page !px-2"
										disabled={currentPage === 1}
										onClick={() => setPage(currentPage - 1)}
										aria-label="Previous page"
									>
										<ChevronLeftIcon size={15} />
									</button>
									{pageList(currentPage, pageCount).map((p, i) =>
										p === "gap" ? (
											<span
												key={`gap-${i}`}
												className="px-1 text-xs text-slate-600"
											>
												…
											</span>
										) : (
											<button
												key={p}
												className={`sb-page ${p === currentPage ? "is-current" : ""}`}
												aria-current={p === currentPage ? "page" : undefined}
												onClick={() => setPage(p)}
											>
												{p}
											</button>
										),
									)}
									<button
										className="sb-page !px-2"
										disabled={currentPage === pageCount}
										onClick={() => setPage(currentPage + 1)}
										aria-label="Next page"
									>
										<ChevronRightIcon size={15} />
									</button>
								</nav>
							)}

							{/* Server-side continuation, offered once the local
                                pages run out so it can't be missed mid-list. */}
							{onLoadMore && hasMore && currentPage === pageCount && (
								<button
									className="sb-tbtn"
									disabled={loadingMore}
									onClick={onLoadMore}
								>
									{loadingMore ? "Loading…" : "Load more"}
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/* --- Mobile row ------------------------------------------------------------- */

function MobileRow<T>({
	row,
	columns,
	selectable,
	selected,
	onToggleSelect,
	expanded,
	onClick,
	renderExpanded,
	rowActions,
	rowLabel,
	dense,
	amounts,
	className,
}: {
	row: T;
	columns: Array<Column<T>>;
	selectable: boolean;
	selected: boolean;
	onToggleSelect: () => void;
	expanded: boolean;
	onClick: () => void;
	renderExpanded?: (row: T) => ReactNode;
	rowActions?: (row: T) => RowAction[];
	rowLabel?: (row: T) => string;
	dense: boolean;
	amounts: AmountPrefs;
	className: string;
}) {
	// The first column is the headline unless a column claims the slot; the
	// last numeric-looking one usually claims `trailing`.
	const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
	const subtitleCol = columns.find((c) => c.mobile === "subtitle");
	const trailingCol = columns.find((c) => c.mobile === "trailing");
	const metaCols = columns.filter(
		(c) =>
			c !== titleCol &&
			c !== subtitleCol &&
			c !== trailingCol &&
			c.mobile !== "hidden",
	);

	return (
		<div
			className={`sb-row px-4 py-3.5 first:border-t-0 ${
				selected ? "is-selected" : ""
			} ${className}`}
		>
			<div className="flex items-start gap-3">
				{selectable && (
					<input
						type="checkbox"
						className="sb-check mt-0.5"
						aria-label="Select row"
						checked={selected}
						onChange={onToggleSelect}
					/>
				)}
				<div className="min-w-0 flex-1" onClick={onClick}>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							{titleCol && titleCol.cell(row, { dense, amounts })}
							{subtitleCol && (
								<div className="mt-0.5 text-xs text-slate-500">
									{subtitleCol.cell(row, { dense, amounts })}
								</div>
							)}
						</div>
						{trailingCol && (
							<div className="shrink-0 text-right">
								{trailingCol.cell(row, { dense, amounts })}
							</div>
						)}
					</div>

					{metaCols.length > 0 && (
						<dl className="mt-2 flex flex-col gap-1">
							{metaCols.map((c) => (
								<div key={c.id} className="flex items-baseline gap-2 text-xs">
									<dt className="w-[5.5rem] shrink-0 text-slate-500">
										{c.label}
									</dt>
									<dd className="min-w-0 flex-1 text-slate-300">
										{c.cell(row, { dense, amounts })}
									</dd>
								</div>
							))}
						</dl>
					)}
				</div>

				{/* Outside the tappable region: on a phone the whole card is the
                    row's own click target, so the handle has to sit beside it
                    rather than inside it. */}
				{rowActions && (
					<span className="-mr-1.5 -mt-0.5 shrink-0">
						<RowMenu
							actions={rowActions(row)}
							label={rowLabel?.(row) ?? "this row"}
						/>
					</span>
				)}
			</div>

			{expanded && renderExpanded && (
				<div className="mt-3 border-t border-slate-800 pt-3">
					{renderExpanded(row)}
				</div>
			)}
		</div>
	);
}

/* --- Loading placeholder ----------------------------------------------------- */

function SkeletonRows({ columns }: { columns: number }) {
	return (
		<div className="flex flex-col">
			{Array.from({ length: 6 }).map((_, r) => (
				<div
					key={r}
					className="flex items-center gap-4 border-t border-slate-800 px-5 py-4 first:border-t-0"
				>
					{Array.from({ length: Math.max(columns, 2) }).map((__, c) => (
						<div
							key={c}
							className="sb-skeleton h-3"
							style={{
								flex: c === 0 ? "2 1 0" : "1 1 0",
								animationDelay: `${(r * columns + c) * 40}ms`,
							}}
						/>
					))}
				</div>
			))}
		</div>
	);
}

export default DataTable;
