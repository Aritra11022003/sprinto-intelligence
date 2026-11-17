// Small shadcn/ui-style primitives.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "bg-white text-zinc-900 shadow-sm hover:bg-violet-100 active:translate-y-px",
        dark: "bg-zinc-800 text-white shadow-sm hover:bg-zinc-700",
        outline: "border border-white/15 bg-white/[0.03] text-zinc-100 hover:bg-white/10 hover:border-white/25",
        ghost: "text-zinc-400 hover:bg-white/10 hover:text-white",
        danger: "bg-rose-600 text-white hover:bg-rose-700",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", lg: "h-11 px-5 text-[15px]" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-white/[0.08] bg-[#1c1c22] shadow-[var(--shadow-card)]", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-white/[0.06] px-5 py-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[15px] font-medium tracking-tight text-white", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", {
  variants: {
    tone: {
      green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
      red: "border-rose-400/25 bg-rose-400/10 text-rose-300",
      amber: "border-amber-400/25 bg-amber-400/10 text-amber-300",
      slate: "border-white/15 bg-white/5 text-zinc-300",
      blue: "border-violet-400/25 bg-violet-400/10 text-violet-200",
    },
  },
  defaultVariants: { tone: "slate" },
});
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm leading-6 text-zinc-100 transition-colors placeholder:text-zinc-600 focus:border-violet-300/60 focus:bg-white/[0.06] focus:outline-none focus:ring-4 focus:ring-violet-400/15", className)} {...props} />;
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-300/60 focus:outline-none focus:ring-4 focus:ring-violet-400/15", className)} {...props} />;
});

export function Alert({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "green"; title?: string; children: React.ReactNode }) {
  const tones = {
    amber: "border-amber-400/25 bg-amber-400/[0.08] text-amber-200",
    red: "border-rose-400/25 bg-rose-400/[0.08] text-rose-200",
    blue: "border-violet-400/25 bg-violet-400/[0.08] text-violet-200",
    green: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone])} role="status">
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** Deterministic letter avatar for a company (no third-party favicon requests). */
export function CompanyAvatar({ name, domain, size = "md" }: { name: string; domain: string; size?: "sm" | "md" }) {
  let h = 0;
  for (const ch of domain) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letter = (name || domain).replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-xl font-semibold text-white shadow-sm ring-1 ring-black/5", size === "md" ? "h-10 w-10 text-base" : "h-7 w-7 text-xs")}
      style={{ background: `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 65% 42%))` }}
    >
      {letter}
    </span>
  );
}
