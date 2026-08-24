import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

export const GET = createHandler(
  {
    name: "admin.users",
    auth: "required",
    roles: ["admin"],
    rateLimit: { limit: 120, windowMs: 60_000, by: "user" },
  },
  async () => {
    const { data, error } = await db()
      .from("users")
      .select("id,email,phone,role,status,first_name,last_name,display_name,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      throw ApiError.internal("Unable to retrieve users.", error.message);
    }

    return { users: data ?? [] };
  },
);