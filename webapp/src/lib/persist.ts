import { useState, type Dispatch, type SetStateAction } from "react";

/** True for plain objects — the merge below only makes sense for them. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * State that survives reloads, stored under `key` as JSON in localStorage.
 * Reads once on mount; every set writes through immediately. Falls back to
 * `initial` (and silently forgets) when storage is unusable.
 *
 * A stored primitive (string, boolean, …) replaces `initial` outright —
 * spreading it would turn `"failed"` into a char-indexed object. Object
 * shapes merge, so keys added since the value was stored keep their defaults.
 *
 * The setter accepts functional updates exactly like `useState`'s, so this is
 * a drop-in for plain `useState` wherever persistence is wanted.
 */
export function usePersisted<S>(
	key: string | undefined,
	initial: S,
): [S, Dispatch<SetStateAction<S>>] {
	const [value, setValue] = useState<S>(() => {
		if (!key) return initial;
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return initial;
			const stored = JSON.parse(raw) as S;
			return isPlainObject(initial) && isPlainObject(stored)
				? ({ ...(initial as object), ...(stored as object) } as S)
				: stored;
		} catch {
			return initial;
		}
	});
	function set(next: SetStateAction<S>) {
		setValue((prev) => {
			const resolved =
				typeof next === "function" ? (next as (p: S) => S)(prev) : next;
			if (!key) return resolved;
			try {
				localStorage.setItem(key, JSON.stringify(resolved));
			} catch {
				/* private mode / quota — it just won't remember */
			}
			return resolved;
		});
	}
	return [value, set];
}
