/* The app's one "are you sure?".

   `window.confirm` was doing this job, which meant a destructive answer was one
   keystroke away, the dialog couldn't say what the action actually costs, and it
   couldn't offer the safer thing instead. This can: a request carries the
   consequence in prose, an optional reversible alternative shown as the *primary*
   button, and — for the truly permanent — a phrase the user has to type out.

   Mounted once at the app root and portalled, like <PaletteProvider>. Screens
   call `useConfirm()(request)` rather than rendering a dialog of their own. */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { WarningIcon } from "./icons";
import { Modal } from "./ui";

export interface ConfirmRequest {
    title: string;
    /** What is about to happen, and what it costs. Prose, not a label. */
    body: ReactNode;
    /** Verb on the confirming button — "Delete permanently", not "OK". */
    confirmLabel?: string;
    onConfirm: () => void;
    /** Paints the confirming button as destructive and adds the warning mark. */
    danger?: boolean;
    /**
     * The reversible thing the user probably meant. Rendered as the primary
     * button, ahead of the destructive one — archiving is nearly always the
     * better answer to "get this off my list".
     */
    alternative?: { label: string; hint?: string; onSelect: () => void };
    /**
     * Demand this exact text before the confirming button unlocks. For deletes
     * with no undo behind them; a plain click is enough for everything else.
     */
    requirePhrase?: string;
    cancelLabel?: string;
}

type ConfirmFn = (request: ConfirmRequest) => void;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Opens the shared confirmation dialog. */
export function useConfirm(): ConfirmFn {
    const fn = useContext(ConfirmContext);
    if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
    return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [request, setRequest] = useState<ConfirmRequest | null>(null);
    const confirm = useCallback<ConfirmFn>((next) => setRequest(next), []);
    const api = useMemo(() => confirm, [confirm]);

    return (
        <ConfirmContext.Provider value={api}>
            {children}
            <ConfirmDialog request={request} onClose={() => setRequest(null)} />
        </ConfirmContext.Provider>
    );
}

function ConfirmDialog({
    request,
    onClose,
}: {
    request: ConfirmRequest | null;
    onClose: () => void;
}) {
    const [typed, setTyped] = useState("");

    // Remounted per request so the typed phrase never carries over between two
    // different deletions.
    return (
        <Modal
            key={request?.title ?? "closed"}
            open={request !== null}
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    {request?.danger && (
                        <span className="text-rose-400">
                            <WarningIcon size={16} />
                        </span>
                    )}
                    {request?.title}
                </span>
            }
            width="28rem"
        >
            {request && (
                <Body
                    request={request}
                    typed={typed}
                    setTyped={setTyped}
                    onClose={() => {
                        setTyped("");
                        onClose();
                    }}
                />
            )}
        </Modal>
    );
}

function Body({
    request,
    typed,
    setTyped,
    onClose,
}: {
    request: ConfirmRequest;
    typed: string;
    setTyped: (v: string) => void;
    onClose: () => void;
}) {
    const {
        body,
        confirmLabel = "Confirm",
        onConfirm,
        danger,
        alternative,
        requirePhrase,
        cancelLabel = "Cancel",
    } = request;

    const locked = !!requirePhrase && typed.trim() !== requirePhrase;

    function run(action: () => void) {
        action();
        onClose();
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="text-[0.84375rem] leading-relaxed text-slate-400">{body}</div>

            {requirePhrase && (
                <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-500">
                        Type <span className="font-semibold text-slate-300">{requirePhrase}</span> to
                        confirm
                    </span>
                    <input
                        autoFocus
                        className="sb-input"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={requirePhrase}
                        aria-label={`Type ${requirePhrase} to confirm`}
                    />
                </label>
            )}

            {/* Reversed on desktop so the safe answer sits under the thumb on a
                phone and at the right — where the eye lands last — on a laptop. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row-reverse sm:items-center">
                {alternative ? (
                    <>
                        <button
                            className="sb-btn sb-btn-primary"
                            onClick={() => run(alternative.onSelect)}
                        >
                            {alternative.label}
                        </button>
                        <button
                            className={`sb-btn ${danger ? "sb-btn-danger" : "sb-btn-ghost"}`}
                            disabled={locked}
                            onClick={() => run(onConfirm)}
                        >
                            {confirmLabel}
                        </button>
                    </>
                ) : (
                    <button
                        className={`sb-btn ${danger ? "sb-btn-danger" : "sb-btn-primary"}`}
                        disabled={locked}
                        onClick={() => run(onConfirm)}
                    >
                        {confirmLabel}
                    </button>
                )}
                <button className="sb-btn sb-btn-ghost" onClick={onClose}>
                    {cancelLabel}
                </button>
                {alternative?.hint && (
                    <p className="min-w-0 flex-1 text-xs text-slate-500 sm:text-left">
                        {alternative.hint}
                    </p>
                )}
            </div>
        </div>
    );
}
