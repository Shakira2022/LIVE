import { NextResponse } from "next/server";

/** Deprecated: mail is sent only by authenticated, purpose-specific flows. */
export function POST() {
  return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}
