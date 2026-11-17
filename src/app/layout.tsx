import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Sprinto Intelligence · Prospect research",
  description: "Adaptive, evidence-backed prospect research and cold email drafting for Sprinto.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <div className="mx-auto max-w-[1280px] px-2 py-3 sm:px-6 sm:py-8">
          <div className="rounded-[26px] bg-[#0b0b0e] p-3 shadow-[0_30px_80px_-20px_rgba(30,27,75,0.55)] ring-1 ring-black/40 sm:rounded-[34px] sm:p-6">
            <SiteHeader />
            <main className="mt-5 sm:mt-6">{children}</main>
          </div>
          <footer className="mt-5 flex flex-col gap-1 px-2 text-xs text-indigo-950/70 sm:flex-row sm:items-center sm:justify-between">
            <span>Sprinto Intelligence · built for the MESA Cold Outreach case</span>
            <span>Max 5 pages per company · respects robots.txt · never bypasses CAPTCHA or logins · emails only you</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
