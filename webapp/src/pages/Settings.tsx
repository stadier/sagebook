/* Settings — the shell, not a page.

   Everything under here configures the machine rather than recording money:
   how captures get in, and what happens to them on the way. Sections are real
   routes (`/settings/rules`), so a link into one survives a reload and the
   inbox's "+ Rule" jump still lands on the form with its prefill intact.

   Sections render inside the tab row via <Outlet>; each opens with
   <SettingsSection>, which is the page-header of this sub-app. */

import { NavLink, Outlet } from "react-router-dom";
import { Icon, SETTINGS_NAV } from "../components/nav";
import { PageHeader } from "../components/ui";
import type { ReactNode } from "react";

export default function Settings() {
    return (
        <>
            <PageHeader
                title="Settings"
                subtitle="How Sagebook takes money in and files it."
            />

            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                {SETTINGS_NAV.map((section) => (
                    <NavLink
                        key={section.to}
                        to={section.to}
                        title={section.description}
                        className={({ isActive }) =>
                            `flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[0.8125rem] transition-colors ${
                                isActive
                                    ? "bg-coral font-bold text-coral-fg"
                                    : "font-semibold text-slate-400 hover:bg-chip hover:text-slate-200"
                            }`
                        }
                    >
                        <Icon name={section.icon} size={16} />
                        {section.label}
                    </NavLink>
                ))}
            </nav>

            <Outlet />
        </>
    );
}

/** A section's own heading, with room for one action on the right. */
export function SettingsSection({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
                <h2 className="text-[1.0625rem] font-extrabold tracking-tight text-slate-100">
                    {title}
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-slate-400">{description}</p>
            </div>
            {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
        </div>
    );
}
