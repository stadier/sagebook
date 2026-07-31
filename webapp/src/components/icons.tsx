/* The app's icon set. One line language throughout, per the design: a 24px box,
   1.9 stroke, round caps and joins, drawn from as few strokes as possible.

   `Stroke` carries those defaults so an icon is just its path data, and every
   icon takes the same `size` prop. Route icons live in nav.tsx alongside the
   navigation model they belong to; everything else is here. */

import type { ReactNode } from "react";

export interface IconProps {
    size?: number;
    /** Extra classes for the svg itself — usually a colour or `shrink-0`. */
    className?: string;
}

/** Shared svg wrapper. Colour comes from `currentColor`, so set it on a parent. */
export function Stroke({
    children,
    size = 18,
    width = 1.9,
    className = "",
}: IconProps & { children: ReactNode; width?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`shrink-0 ${className}`}
        >
            {children}
        </svg>
    );
}

/* --- Actions ---------------------------------------------------------------- */

export function PlusIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2.2} className={className}>
            <path d="M12 5v14M5 12h14" />
        </Stroke>
    );
}

export function SearchIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4.3-4.3" />
        </Stroke>
    );
}

export function CloseIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M6 6l12 12M18 6 6 18" />
        </Stroke>
    );
}

export function MenuIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M4 7h16M4 12h16M4 17h16" />
        </Stroke>
    );
}

export function ChevronRightIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="m9 6 6 6-6 6" />
        </Stroke>
    );
}

export function ChevronLeftIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="m15 6-6 6 6 6" />
        </Stroke>
    );
}

export function LogoutIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
            <path d="M10 12h9m0 0-3-3m3 3-3 3" />
            <path d="M10 12H3" />
        </Stroke>
    );
}

/* --- Theme ------------------------------------------------------------------- */

export function SunIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Stroke>
    );
}

export function MoonIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </Stroke>
    );
}

/** The current theme's toggle affordance — sun while dark, moon while light. */
export function ThemeIcon({ theme, size, className }: IconProps & { theme: string }) {
    return theme === "dark" ? (
        <SunIcon size={size} className={className} />
    ) : (
        <MoonIcon size={size} className={className} />
    );
}

/* --- Sage --------------------------------------------------------------------- */

export function SparkIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={1.6} className={className}>
            <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z" />
            <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
        </Stroke>
    );
}

export function MicIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </Stroke>
    );
}

export function GridIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <rect x="4" y="4" width="6" height="6" rx="1.4" />
            <rect x="14" y="4" width="6" height="6" rx="1.4" />
            <rect x="4" y="14" width="6" height="6" rx="1.4" />
            <rect x="14" y="14" width="6" height="6" rx="1.4" />
        </Stroke>
    );
}
