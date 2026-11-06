import { NextResponse } from "next/server";

/** Deprecated: use the authenticated /api/requests/[id]/notes endpoint. */
export function POST() {
  return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}
