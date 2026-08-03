/* Capture with no button at all.

   The fastest way to file a receipt is to drop it on the window or paste it out
   of the clipboard — no aiming at a control first. That is the real answer to
   "I always want to know how to upload": everywhere works.

   Only file drops are intercepted. A dragged link, selected text, or a plain
   ⌘V into a text box behaves exactly as it always did, because this never fires
   unless the payload actually carries files. */

import { useEffect, useState } from "react";

export function useGlobalCapture(onFiles: (files: File[]) => void) {
    // `depth` counts enter/leave pairs: dragging over a child element fires a
    // leave on the parent, and without the count the overlay strobes.
    const [depth, setDepth] = useState(0);

    useEffect(() => {
        function carriesFiles(transfer: DataTransfer | null): boolean {
            return !!transfer && Array.from(transfer.types).includes("Files");
        }

        function onDragEnter(e: DragEvent) {
            if (!carriesFiles(e.dataTransfer)) return;
            e.preventDefault();
            setDepth((d) => d + 1);
        }

        function onDragOver(e: DragEvent) {
            if (!carriesFiles(e.dataTransfer)) return;
            // Without this the browser opens the file instead of handing it over.
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        }

        function onDragLeave(e: DragEvent) {
            if (!carriesFiles(e.dataTransfer)) return;
            setDepth((d) => Math.max(0, d - 1));
        }

        function onDrop(e: DragEvent) {
            if (!carriesFiles(e.dataTransfer)) return;
            e.preventDefault();
            setDepth(0);
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) onFiles(files);
        }

        function onPaste(e: ClipboardEvent) {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (!files.length) return;
            e.preventDefault();
            onFiles(files);
        }

        window.addEventListener("dragenter", onDragEnter);
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        window.addEventListener("paste", onPaste);
        return () => {
            window.removeEventListener("dragenter", onDragEnter);
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
            window.removeEventListener("paste", onPaste);
        };
    }, [onFiles]);

    return { dragging: depth > 0 };
}
