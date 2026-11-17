"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, LayoutDashboard, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Health { email: boolean; provider: "gmail" | "resend" | null }

export function SiteHeader() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((j) => setHealth(j.config)).catch(() => undefined);
  }, []);
  const nav = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, active: path === "/" },
    { href: "/history", label: "History", icon: History, active: path.startsWith("/history") },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm ring-1 ring-brand-900/10">
            <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-slate-900">Sprinto Intelligence</span>
            <span className="hidden text-[11px] text-slate-500 sm:block">Prospect research agent</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {health && (
            <span
              className={cn(
                "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium md:inline-flex",
                health.email ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800",
              )}
              title={health.email ? "Drafts are emailed to your own inbox" : "Email not configured: drafts are shown on screen only"}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", health.email ? "bg-emerald-500" : "bg-amber-500")} />
              Email: {health.email ? (health.provider === "resend" ? "Resend" : "Gmail") : "not connected"}
            </span>
          )}
          <nav className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm shadow-sm">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors",
                  n.active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <n.icon className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{n.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
