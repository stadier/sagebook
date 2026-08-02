export function fmtMoney(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

export function fmtMoneyCompact(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            notation: "compact",
            maximumFractionDigits: 1,
        }).format(amount);
    } catch {
        return `${amount.toFixed(0)} ${currency}`;
    }
}

export function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

/**
 * "Jul 25" — the compact form for dense lists, where the year is noise until
 * it isn't the current one. Parsed as local midnight rather than through
 * `Date(iso)`, which reads a bare date as UTC and can render the day before.
 */
export function fmtDateShort(iso: string): string {
    const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    });
}

export function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** "1.4 MB" — human file size for the documents view. Null → "—". */
export function fmtBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || bytes < 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes;
    let unit = "B";
    for (const u of units) {
        value /= 1024;
        unit = u;
        if (value < 1024) break;
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

/** ISO date of the first day of the current month, e.g. "2026-07-01". */
export function currentMonthStart(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}
