import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const TABS = [
  { to: "/", label: "Upload / Scan" },
  { to: "/review", label: "Review" },
  { to: "/settings", label: "Settings" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="aurora aurora-a -left-24 -top-28 size-80 bg-brand/25 md:size-[28rem]" />
      <div className="aurora aurora-b -right-24 top-24 size-72 bg-violet/25 md:size-[26rem]" />
      <div className="aurora aurora-c bottom-0 left-10 size-64 bg-sky/20 md:size-[24rem]" />

      <div className="relative z-10 mx-auto w-full max-w-3xl">
        <header className="flex items-center gap-2.5 px-5 pt-5">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-violet font-mono text-sm font-medium text-ink shadow-lg shadow-brand/30">
            P
          </div>
          <div>
            <p className="font-display text-[17px] font-semibold leading-none tracking-tight">
              ProspectScan
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
              Outreach pipeline
            </p>
          </div>
        </header>

        <nav className="mt-4 flex gap-1.5 px-5">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.to === "/" }}
              className="flex-1 rounded-lg bg-panel-soft py-2.5 text-center text-[13px] font-medium text-muted-foreground ring-1 ring-hairline transition-colors hover:text-foreground"
              activeProps={{
                className:
                  "flex-1 rounded-lg bg-brand/10 py-2.5 text-center text-[13px] font-semibold text-brand ring-1 ring-brand/40",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <main className="px-5 pb-16 pt-5">{children}</main>
      </div>
    </div>
  );
}

export function SectionTitle({
  title,
  meta,
}: {
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      {meta ? <span className="font-mono text-[10px] text-faint">{meta}</span> : null}
    </div>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}
    >
      {children}
    </span>
  );
}
