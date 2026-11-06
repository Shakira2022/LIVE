import { NextResponse } from "next/server";

/** Deprecated: user enumeration is not exposed by the public API. */
export function GET() {
  return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}
