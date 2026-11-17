"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-400">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">Try again</button>
    </div>
  );
}
