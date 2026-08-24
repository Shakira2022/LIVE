import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.organisations",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const { data, error } = await db()
      .from("organisations")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw ApiError.internal("Unable to retrieve organisations.", error.message);
    }

    return { organisations: data ?? [] };
  },
);