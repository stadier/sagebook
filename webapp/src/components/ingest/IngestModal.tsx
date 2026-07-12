import { useEffect, useState } from "react";
import ImportFlow from "./ImportFlow";
import UnifiedEntry from "./UnifiedEntry";

/**
 * Full-screen ingestion modal that expands from the "+" FAB. Hosts every way
 * of getting data into Sagebook — typed notes, receipts, voice, and statement
 * files — in one place. A structured file (CSV/Excel/OFX) swaps the body to the
 * import mapper; everything else stays in the AI capture surface.
 */
export default function IngestModal({
    open,
    onClose,
    initialText = "",
}: {
    open: boolean;
    onClose: () => void;
    initialText?: string;
}) {
    // `render` keeps the panel mounted through the close animation; `visible`
    // drives the transition (flipped a frame after mount so it animates in).
    const [render, setRender] = useState(false);
    const [visible, setVisible] = useState(false);
    const [structuredFile, setStructuredFile] = useState<File | null>(null);

    useEffect(() => {
        if (open) {
            setStructuredFile(null);
            setRender(true);
            const id = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(id);
        }
        setVisible(false);
        const id = setTimeout(() => setRender(false), 300);
        return () => clearTimeout(id);
    }, [open]);

    // Close on Escape while open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!render) return null;

    return (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Add to Sagebook">
            <div
                onClick={onClose}
                className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
                    visible ? "opacity-100" : "opacity-0"
                }`}
            />
            <div className="absolute inset-0 flex items-stretch justify-center sm:items-center sm:p-6">
                <div
                    className={`relative flex w-full origin-bottom-right flex-col overflow-hidden bg-paper shadow-pop transition-all duration-300 ease-out sm:max-h-[88vh] sm:max-w-2xl sm:rounded-3xl ${
                        visible ? "scale-100 opacity-100" : "scale-[0.2] opacity-0"
                    }`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                        <div className="flex items-center gap-2.5">
                            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-600 text-white">
                                <PlusIcon />
                            </span>
                            <div>
                                <h2 className="text-base font-semibold text-slate-100">Add to Sagebook</h2>
                                <p className="text-xs text-slate-500">
                                    {structuredFile ? "Map your statement columns" : "Type, drop a file, or record a voice note"}
                                </p>
                            </div>
                        </div>
                        <button
                            aria-label="Close"
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                        {structuredFile ? (
                            <ImportFlow
                                file={structuredFile}
                                onBack={() => setStructuredFile(null)}
                                onClose={onClose}
                            />
                        ) : (
                            <UnifiedEntry
                                initialText={initialText}
                                onStructuredFile={setStructuredFile}
                                onClose={onClose}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function PlusIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}
