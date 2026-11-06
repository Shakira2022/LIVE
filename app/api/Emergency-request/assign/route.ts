import { NextResponse } from "next/server";

/** Deprecated: request assignment is handled by the authenticated assignment API. */
export function POST() {
  return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}
