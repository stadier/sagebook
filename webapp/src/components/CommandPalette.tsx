/* The one surface every list of choices in Sagebook opens into.

   There is a single instance, mounted at the app root and portalled to
   `document.body`, so a picker inside a scrolling table cell or an overflowing
   card is never clipped and never has to reason about anchoring. Screens don't
   render it; they call `usePalette().open(request)` — or, far more often, use
   the `<Picker>` control in `ui.tsx`, which does that for them.

   It scales down as well as up: under nine options the search box is dropped
   and the panel shrinks to its content, so "Income / Expense" stays a two-row
   menu rather than a full-height overlay. Above that the search box appears and
   the list is capped, so a taxonomy of several hundred categories costs the
   same to open as a list of ten. */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { filterOptions, type Option } from "../lib/options";
import { CheckIcon, SearchIcon } from "./icons";

/** Below this many options, searching costs more than it saves. */
const SEARCH_THRESHOLD = 9;
/** Rows rendered at once. Beyond it the answer is to type, not to scroll. */
const MAX_ROWS = 300;

export interface PaletteRequest<T extends string = string> {
    /** Heading — what is being chosen ("Category", "Account"). */
    title: string;
    /** Optional line under the title, for context the title can't carry. */
    subtitle?: string;
    options: Option<T>[];
    /** Currently-held value, ticked and focused when the palette opens. */
    value?: T | "" | null;
    onSelect: (value: T) => void;
    searchPlaceholder?: string;
    emptyText?: string;
}

interface PaletteApi {
    open: <T extends string>(request: PaletteRequest<T>) => void;
}

const PaletteContext = createContext<PaletteApi | null>(null);

/** Imperative handle on the palette. Prefer `<Picker>` unless you need this. */
export function usePalette(): PaletteApi {
    const api = useContext(PaletteContext);
    if (!api) throw new Error("usePalette must be used inside <PaletteProvider>");
    return api;
}

export function PaletteProvider({ children }: { children: React.ReactNode }) {
    const [request, setRequest] = useState<PaletteRequest | null>(null);
    // The element that opened the palette, so focus goes back where it was.
    const opener = useRef<HTMLElement | null>(null);

    // The stored request is erased to `PaletteRequest<string>`: the panel only
    // ever passes an option's own value back to `onSelect`, so the narrower
    // type the caller supplied still holds — TypeScript just can't see it.
    const open = useCallback(<T extends string>(next: PaletteRequest<T>) => {
        opener.current = document.activeElement as HTMLElement | null;
        setRequest(next as unknown as PaletteRequest);
    }, []);

    const close = useCallback(() => {
        setRequest(null);
        opener.current?.focus?.();
        opener.current = null;
    }, []);

    const api = useMemo(() => ({ open }), [open]);

    return (
        <PaletteContext.Provider value={api}>
            {children}
            {request && <Palette request={request} onClose={close} />}
        </PaletteContext.Provider>
    );
}

/* -------------------------------------------------------------------------- */
/*  The panel                                                                  */
/* -------------------------------------------------------------------------- */

function Palette({ request, onClose }: { request: PaletteRequest; onClose: () => void }) {
    const { title, subtitle, options, value, onSelect, searchPlaceholder, emptyText } = request;

    const [query, setQuery] = useState("");
    // Mounted a frame before `visible` flips, so the panel animates in.
    const [visible, setVisible] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const baseId = useId();

    const searchable = options.length >= SEARCH_THRESHOLD;
    const matches = useMemo(() => filterOptions(options, query), [options, query]);
    const rows = matches.slice(0, MAX_ROWS);
    const hidden = matches.length - rows.length;

    // Open on the current value so Enter re-confirms rather than jumping to the
    // top of the list; every later keystroke resets to the best match.
    const [active, setActive] = useState(() => {
        const at = options.findIndex((o) => o.value === value);
        return at >= 0 ? at : 0;
    });
    // Effects run after the first render too, so this would otherwise discard
    // the starting position above before anyone had typed anything.
    const searched = useRef(false);
    useEffect(() => {
        if (searched.current) setActive(0);
        else searched.current = true;
    }, [query]);

    useEffect(() => {
        const id = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(id);
    }, []);

    // With no search box there is no autofocusing input, and `autoFocus` on a
    // non-form element does nothing — so the list takes focus itself, putting a
    // screen reader inside the dialog rather than back on the page behind it.
    useEffect(() => {
        if (!searchable) listRef.current?.focus();
    }, [searchable]);

    // The page behind must not scroll while the palette is up.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    // Keep the highlighted row on screen as the arrows walk the list.
    useEffect(() => {
        listRef.current
            ?.querySelector('[data-active="true"]')
            ?.scrollIntoView({ block: "nearest" });
    }, [active, rows.length]);

    function choose(option: Option | undefined) {
        if (!option || option.disabled) return;
        onSelect(option.value);
        onClose();
    }

    // Bound to the window rather than to the panel: the panel is portalled to
    // `document.body`, which sits outside React's root container, so a JSX
    // `onKeyDown` never sees these. A window listener is also what the palette
    // wants regardless — it owns the keyboard for as long as it is open.
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                choose(rows[active]);
                return;
            }
            const step =
                e.key === "ArrowDown"
                    ? 1
                    : e.key === "ArrowUp"
                      ? -1
                      : e.key === "Tab"
                        ? e.shiftKey
                            ? -1
                            : 1
                        : 0;
            if (step) {
                e.preventDefault();
                if (!rows.length) return;
                // Wrapping matters most at the ends of a long taxonomy.
                setActive((i) => (i + step + rows.length) % rows.length);
                return;
            }
            // Home/End belong to the caret while the search box has focus.
            const typing = (e.target as HTMLElement)?.tagName === "INPUT";
            if (!typing && e.key === "Home") {
                e.preventDefault();
                setActive(0);
            } else if (!typing && e.key === "End") {
                e.preventDefault();
                setActive(Math.max(0, rows.length - 1));
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // No dependency list on purpose: the handler closes over `rows` and
        // `active`, so it is rebound each render to stay current.
    });

    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]">
            <button
                aria-hidden
                tabIndex={-1}
                onClick={onClose}
                className={`absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px] transition-opacity duration-150 ${
                    visible ? "opacity-100" : "opacity-0"
                }`}
            />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`sb-cmd relative flex w-full max-w-lg flex-col transition-all duration-150 ease-out ${
                    visible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.98] opacity-0"
                }`}
            >
                <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3.5">
                    <h2 className="text-[0.8125rem] font-bold text-slate-200">{title}</h2>
                    {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
                </div>

                {searchable && (
                    <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 pb-3">
                        <span className="shrink-0 text-slate-600">
                            <SearchIcon size={15} />
                        </span>
                        <input
                            autoFocus
                            role="combobox"
                            aria-expanded
                            aria-controls={`${baseId}-list`}
                            aria-activedescendant={rows[active] ? `${baseId}-${active}` : undefined}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}…`}
                            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
                        />
                        {matches.length > 0 && (
                            <span className="shrink-0 text-xs text-slate-500 tnum">
                                {matches.length}
                            </span>
                        )}
                    </div>
                )}

                <div
                    ref={listRef}
                    id={`${baseId}-list`}
                    role="listbox"
                    aria-label={title}
                    tabIndex={searchable ? -1 : 0}
                    className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain p-1.5 outline-none"
                >
                    {rows.length === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-slate-500">
                            {emptyText ?? "Nothing matches that."}
                        </p>
                    )}

                    {rows.map((option, i) => {
                        // Headings only survive an unfiltered list; once results
                        // are ranked the groups interleave, so the group name
                        // moves onto the row itself.
                        const heading =
                            !query && option.group && option.group !== rows[i - 1]?.group
                                ? option.group
                                : null;
                        return (
                            <div key={`${option.value}-${i}`}>
                                {heading && <div className="sb-cmd-heading">{heading}</div>}
                                <div
                                    id={`${baseId}-${i}`}
                                    role="option"
                                    aria-selected={option.value === value}
                                    aria-disabled={option.disabled || undefined}
                                    data-active={i === active}
                                    onMouseMove={() => setActive(i)}
                                    onClick={() => choose(option)}
                                    className="sb-cmd-item"
                                    style={option.depth ? { paddingLeft: `${0.625 + option.depth * 0.875}rem` } : undefined}
                                >
                                    {option.color && (
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: option.color }}
                                        />
                                    )}
                                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                    {query && option.group && (
                                        <span className="shrink-0 text-xs text-slate-500">
                                            {option.group}
                                        </span>
                                    )}
                                    {option.hint && (
                                        <span className="shrink-0 text-xs text-slate-500">
                                            {option.hint}
                                        </span>
                                    )}
                                    <span
                                        className={`shrink-0 text-coral ${
                                            option.value === value ? "" : "invisible"
                                        }`}
                                    >
                                        <CheckIcon size={15} />
                                    </span>
                                </div>
                            </div>
                        );
                    })}

                    {hidden > 0 && (
                        <p className="px-3 py-2 text-center text-xs text-slate-500">
                            {hidden} more — keep typing to narrow it down
                        </p>
                    )}
                </div>

                <div className="hidden items-center gap-3 border-t border-slate-800 px-4 py-2 text-[0.6875rem] text-slate-500 sm:flex">
                    <Key>↑</Key>
                    <Key>↓</Key>
                    <span>navigate</span>
                    <Key>↵</Key>
                    <span>select</span>
                    <Key>esc</Key>
                    <span>close</span>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function Key({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-sans text-[0.6875rem] text-slate-400">
            {children}
        </kbd>
    );
}
