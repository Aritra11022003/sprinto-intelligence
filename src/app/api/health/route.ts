import { NextResponse } from "next/server";
import { configStatus } from "@/lib/research";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ ok: true, config: configStatus() });
}
