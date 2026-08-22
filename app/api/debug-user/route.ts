import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, email, phone, status, deleted_at, first_name, last_name, display_name, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("DEBUG ALL USERS:", data);
  console.log("DEBUG USERS ERROR:", error);

  return NextResponse.json({
    data,
    error,
  });
}