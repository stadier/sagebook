/* Where Sage's session state lives.

   The dock and the full-screen console are two windows onto one conversation,
   so which conversation that is cannot belong to either of them — closing the
   dock or walking to `/console` would lose it. It sits here instead, above both,
   alongside the dock's open state and width.

   Nothing about *asking* is in this file. This is only the answer to "which
   conversation, and is the panel open" — the conversation itself is server
   state, and lives in `lib/sage.ts` with the rest of the app's queries. */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { STORAGE_KEYS } from "../../lib/constants";

/** Dock widths, in pixels. Narrow enough to leave the page readable beside it. */
export const DOCK_MIN_WIDTH = 340;
export const DOCK_MAX_WIDTH = 720;
export const DOCK_DEFAULT_WIDTH = 420;

interface SageState {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    width: number;
    setWidth: (width: number) => void;
    /** The conversation both surfaces are showing; null is a fresh one. */
    conversationId: string | null;
    setConversationId: (id: string | null) => void;
    /** Start over: opens the dock on an empty thread. */
    newConversation: () => void;
    /**
     * Text handed to the composer from outside — a suggestion chip, a page's
     * "ask Sage about this" link. Read once and cleared.
     */
    draft: string;
    setDraft: (text: string) => void;
    /** Open the dock with something already typed in. */
    openWith: (text: string) => void;
}

const SageContext = createContext<SageState | null>(null);

export function useSageSession(): SageState {
    const state = useContext(SageContext);
    if (!state) throw new Error("useSageSession must be used inside <SageProvider>");
    return state;
}

function storedWidth(): number {
    const raw = Number(localStorage.getItem(STORAGE_KEYS.sageDockWidth));
    if (!Number.isFinite(raw) || raw <= 0) return DOCK_DEFAULT_WIDTH;
    return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, raw));
}

export function SageProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(
        () => localStorage.getItem(STORAGE_KEYS.sageDockOpen) === "1",
    );
    const [width, setWidthState] = useState(storedWidth);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.sageDockOpen, open ? "1" : "0");
    }, [open]);

    const setWidth = useCallback((next: number) => {
        const clamped = Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(next)));
        setWidthState(clamped);
        localStorage.setItem(STORAGE_KEYS.sageDockWidth, String(clamped));
    }, []);

    const newConversation = useCallback(() => {
        setConversationId(null);
        setDraft("");
        setOpen(true);
    }, []);

    const openWith = useCallback((text: string) => {
        setDraft(text);
        setOpen(true);
    }, []);

    // ⌘J / Ctrl+J anywhere — the same key whether the dock is showing or not,
    // so reaching Sage never depends on finding a control first.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key.toLowerCase() !== "j" || !(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            setOpen((prev) => !prev);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const value = useMemo<SageState>(
        () => ({
            open,
            setOpen,
            toggle: () => setOpen((prev) => !prev),
            width,
            setWidth,
            conversationId,
            setConversationId,
            newConversation,
            draft,
            setDraft,
            openWith,
        }),
        [open, width, setWidth, conversationId, newConversation, draft, openWith],
    );

    return <SageContext.Provider value={value}>{children}</SageContext.Provider>;
}
