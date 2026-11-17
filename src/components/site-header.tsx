"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Health { email: boolean; provider: "gmail" | "resend" | null; selfEmailMasked: string | null }

export function SiteHeader() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((j) => setHealth(j.config)).catch(() => undefined);
  }, []);
  const nav = [
    { href: "/", label: "Overview", active: path === "/" },
    { href: "/history", label: "History", active: path.startsWith("/history") },
  ];
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-900"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
        <span className="text-xl font-semibold tracking-tight text-white">sprinto<span className="text-violet-300">.</span>intel</span>
      </Link>
      <nav className="order-3 flex w-full justify-center sm:order-none sm:w-auto">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-full px-5 py-2 transition-colors", n.active ? "bg-white font-medium text-zinc-900" : "text-zinc-400 hover:text-white")}>{n.label}</Link>
          ))}
        </div>
      </nav>
      {health && (
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3" title={health.email ? "Drafts are emailed to your own inbox" : "Email not configured: drafts are shown on screen only"}>
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", health.email ? "bg-emerald-300 text-emerald-950" : "bg-amber-300 text-amber-950")}><Mail className="h-4 w-4" /></span>
          <span className="leading-tight">
            <span className="block text-xs font-medium text-zinc-100">{health.email ? (health.provider === "resend" ? "Email via Resend" : "Email via Gmail") : "Email off"}</span>
            <span className="hidden text-[11px] text-zinc-500 sm:block">{health.selfEmailMasked ?? "drafts shown on screen"}</span>
          </span>
        </div>
      )}
    </header>
  );
}
