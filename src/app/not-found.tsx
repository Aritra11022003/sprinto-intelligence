import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-brand-600 hover:underline">Back to the dashboard</Link>
    </div>
  );
}
