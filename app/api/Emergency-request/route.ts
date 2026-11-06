import { NextResponse } from "next/server";

/** Deprecated: emergency requests must use the authenticated /api/requests API. */
export function POST() {
  return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}
