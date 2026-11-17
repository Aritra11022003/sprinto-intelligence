// Minimal shadcn/ui-style primitives (Button, Card, Badge, Textarea, Input).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white hover:bg-brand-700",
        outline: "border border-slate-300 bg-white hover:bg-slate-50 text-slate-800",
        ghost: "hover:bg-slate-100 text-slate-700",
        danger: "bg-rose-600 text-white hover:bg-rose-700",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", lg: "h-10 px-5" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-slate-100 px-5 py-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-slate-900", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide", {
  variants: {
    tone: {
      green: "border-emerald-200 bg-emerald-50 text-emerald-700",
      red: "border-rose-200 bg-rose-50 text-rose-700",
      amber: "border-amber-200 bg-amber-50 text-amber-800",
      slate: "border-slate-200 bg-slate-50 text-slate-700",
      blue: "border-brand-100 bg-brand-50 text-brand-700",
    },
  },
  defaultVariants: { tone: "slate" },
});
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100", className)} {...props} />;
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100", className)} {...props} />;
});

export function Alert({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "green"; title?: string; children: React.ReactNode }) {
  const tones = { amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-rose-200 bg-rose-50 text-rose-900", blue: "border-brand-100 bg-brand-50 text-brand-700", green: "border-emerald-200 bg-emerald-50 text-emerald-900" };
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone])} role="status">
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}
