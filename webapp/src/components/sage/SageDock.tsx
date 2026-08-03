/* Sage, docked to the right of everything.

   The panel *pushes* the page rather than covering it, which is the whole
   argument for docking it at all: you can read the ledger and ask about the
   ledger at the same time, and the answer arrives beside the thing it is about.
   Below `lg` there is no room for two columns, so it becomes a sheet.

   The drag handle is a real control, not a decorative edge — it takes focus and
   answers the arrow keys, because a resize you can only do with a mouse is a
   resize half the app's users cannot do. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CloseIcon, ExpandIcon, HistoryIcon, PlusIcon, SparkIcon } from "../icons";
import { SageConversationView } from "./SageConversationView";
import { SageHistory } from "./SageHistory";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, useSageSession } from "./SageProvider";

/** Pixels one arrow-key press moves the edge. */
const KEY_STEP = 24;

export function SageDock({
    onCapture,
    viewing,
}: {
    onCapture: (text: string) => void;
    viewing?: string;
}) {
    const { open, setOpen, width, setWidth, conversationId, setConversationId, newConversation } =
        useSageSession();
    const [historyOpen, setHistoryOpen] = useState(false);
    const dragging = useRef(false);

    const onPointerMove = useCallback(
        (e: PointerEvent) => {
            if (!dragging.current) return;
            // The dock is flush to the right, so its width is whatever is left
            // of the viewport from the pointer.
            setWidth(window.innerWidth - e.clientX);
        },
        [setWidth],
    );

    useEffect(() => {
        function stop() {
            dragging.current = false;
            document.body.style.removeProperty("cursor");
            document.body.style.removeProperty("user-select");
        }
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stop);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", stop);
            stop();
        };
    }, [onPointerMove]);

    if (!open) return null;

    return (
        <>
            {/* Sheet backdrop — below lg only, where the dock covers the page. */}
            <button
                aria-label="Close Sage"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[64] bg-black/50 lg:hidden"
            />

            <aside
                aria-label="Sage"
                style={{ "--sb-dock-w": `${width}px` } as React.CSSProperties}
                className="fixed inset-y-0 right-0 z-[65] flex w-full max-w-md flex-col border-l border-slate-800 bg-paper shadow-[0_0_40px_rgba(0,0,0,0.35)] lg:static lg:z-auto lg:w-[var(--sb-dock-w)] lg:max-w-none lg:shrink-0 lg:shadow-none"
            >
                {/* Resize edge */}
                <button
                    aria-label="Resize Sage panel"
                    aria-valuenow={width}
                    aria-valuemin={DOCK_MIN_WIDTH}
                    aria-valuemax={DOCK_MAX_WIDTH}
                    role="slider"
                    tabIndex={0}
                    onPointerDown={(e) => {
                        e.preventDefault();
                        dragging.current = true;
                        document.body.style.cursor = "col-resize";
                        document.body.style.userSelect = "none";
                    }}
                    onKeyDown={(e) => {
                        const step =
                            e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
                        if (!step) return;
                        e.preventDefault();
                        setWidth(width + step);
                    }}
                    className="absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize focus:outline-none focus-visible:bg-coral/40 lg:block"
                />

                <header className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-3 py-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-coral-soft text-coral">
                        <SparkIcon size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">
                        Sage
                    </span>

                    <DockButton
                        label="New conversation"
                        onClick={() => {
                            setHistoryOpen(false);
                            newConversation();
                        }}
                    >
                        <PlusIcon size={16} />
                    </DockButton>

                    <div className="relative">
                        <DockButton
                            label="Conversation history"
                            active={historyOpen}
                            onClick={() => setHistoryOpen(!historyOpen)}
                        >
                            <HistoryIcon size={16} />
                        </DockButton>
                        {historyOpen && (
                            <>
                                <button
                                    aria-hidden
                                    tabIndex={-1}
                                    onClick={() => setHistoryOpen(false)}
                                    className="fixed inset-0 z-40 cursor-default"
                                />
                                <div className="absolute right-0 top-[calc(100%+0.35rem)] z-50 flex max-h-[60vh] w-[19rem] flex-col rounded-xl bg-[#2c313d] p-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.45)]">
                                    <SageHistory
                                        activeId={conversationId}
                                        onPick={(id) => {
                                            setConversationId(id);
                                            setHistoryOpen(false);
                                        }}
                                        onDeleted={() => setConversationId(null)}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <Link
                        to="/console"
                        aria-label="Open in full screen"
                        title="Open in full screen"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                    >
                        <ExpandIcon size={15} />
                    </Link>

                    <DockButton label="Close Sage" onClick={() => setOpen(false)}>
                        <CloseIcon size={17} />
                    </DockButton>
                </header>

                <SageConversationView variant="dock" onCapture={onCapture} viewing={viewing} />
            </aside>
        </>
    );
}

function DockButton({
    label,
    onClick,
    active,
    children,
}: {
    label: string;
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-slate-800 hover:text-slate-100 ${
                active ? "bg-slate-800 text-slate-100" : "text-slate-400"
            }`}
        >
            {children}
        </button>
    );
}
