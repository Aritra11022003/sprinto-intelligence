import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sprinto Intelligence",
  description: "Adaptive, evidence-backed prospect research and cold email drafting for Sprinto.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden /> Sprinto Intelligence
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">Dashboard</Link>
              <Link href="/history" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">History</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-400">
          Max 5 unique page fetches per company · respects robots.txt · never bypasses CAPTCHA or logins · no paid APIs · emails go only to your own inbox.
        </footer>
      </body>
    </html>
  );
}
