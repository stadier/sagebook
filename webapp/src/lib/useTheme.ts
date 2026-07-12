import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const KEY = "sb-theme";

function getSnapshot(): Theme {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(cb: () => void) {
    const observer = new MutationObserver(cb);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
}

export function useTheme() {
    const theme = useSyncExternalStore(subscribe, getSnapshot);

    const toggle = useCallback(() => {
        const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
        document.documentElement.classList.toggle("dark", next === "dark");
        localStorage.setItem(KEY, next);
    }, []);

    return { theme, toggle } as const;
}

// Run once at import time so the class is set before first paint.
(function init() {
    const stored = localStorage.getItem(KEY) as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (stored === "dark" || (!stored && prefersDark)) {
        document.documentElement.classList.add("dark");
    }
})();
