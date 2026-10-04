import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

const PAGES = [
  { to: "/", label: "Studio" },
  { to: "/work-maps", label: "Work Maps" },
  { to: "/settings", label: "Settings" },
] as const;

/** The app window's top bar: the Tacit wordmark, the pages, and page actions on the right. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b bg-card/80 px-6 backdrop-blur">
      <Link to="/" className="font-display text-[26px] leading-none tracking-tight">
        Tacit
      </Link>
      <nav className="flex items-center gap-1 text-[13px]">
        {PAGES.map((page) => (
          <Link
            key={page.to}
            to={page.to}
            activeOptions={{ exact: page.to === "/" }}
            className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: "bg-muted !text-foreground font-medium" }}
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
