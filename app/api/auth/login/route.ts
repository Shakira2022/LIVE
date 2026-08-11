import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { createAccessToken } from "@/lib/auth/jwt";

console.log(
  "Supabase URL:",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

console.log(
  "Service role key exists:",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { identifier, password } = await request.json();

    if (!identifier || !password) {
      return NextResponse.json(
        {
          ok: false,
          message: "Email/phone and password are required.",
        },
        { status: 400 }
      );
    }

    const value = identifier.trim();

    console.log("Login identifier:", value);
    console.log(
      "Identifier type:",
      value.includes("@") ? "email" : "phone"
    );

    let user = null;
    let error = null;

    if (value.includes("@")) {
      const result = await supabase
        .from("users")
        .select(
          "id, email, phone, password_hash, role, status, first_name, last_name, display_name"
        )
        .eq("email", value)
        .is("deleted_at", null)
        .maybeSingle();

      user = result.data;
      error = result.error;
    } else {
      const result = await supabase
        .from("users")
        .select(
          "id, email, phone, password_hash, role, status, first_name, last_name, display_name"
        )
        .eq("phone", value)
        .is("deleted_at", null)
        .maybeSingle();

      user = result.data;
      error = result.error;
    }

    if (error) {
      console.error("LOGIN DATABASE ERROR");
      console.error("Code:", error.code);
      console.error("Message:", error.message);
      console.error("Details:", error.details);
      console.error("Hint:", error.hint);
      console.error("Full error:", error);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to sign in right now.",
        },
        { status: 500 }
      );
    }

    console.log("User found:", !!user);

    if (user) {
      console.log("User ID:", user.id);
      console.log("User email:", user.email);
      console.log("User status:", user.status);
      console.log("Password hash exists:", !!user.password_hash);
    }

    if (!user) {
      console.log("LOGIN FAILED: USER NOT FOUND");

      return NextResponse.json(
        {
          ok: false,
          message: "The email/phone or password is incorrect.",
        },
        { status: 401 }
      );
    }

    if (user.status !== "active") {
      console.log("LOGIN FAILED: ACCOUNT NOT ACTIVE");

      return NextResponse.json(
        {
          ok: false,
          message: "This account is not active.",
        },
        { status: 403 }
      );
    }

    const passwordCorrect = await bcrypt.compare(
      password,
      user.password_hash
    );

    console.log("Password correct:", passwordCorrect);

    if (!passwordCorrect) {
      console.log("LOGIN FAILED: PASSWORD DOES NOT MATCH");

      return NextResponse.json(
        {
          ok: false,
          message: "The email/phone or password is incorrect.",
        },
        { status: 401 }
      );
    }

    await supabase
      .from("users")
      .update({
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
      })
      .eq("id", user.id);

    // Create JWT after successful authentication
    const accessToken = await createAccessToken(
      user.id,
      user.role
    );

    const safeUser = {
      id: user.id,
      name:
        user.display_name ||
        `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      first_name: user.first_name,
      last_name: user.last_name,
      display_name: user.display_name,
    };

    console.log("LOGIN SUCCESSFUL");
    console.log("JWT CREATED FOR USER:", user.id);

    return NextResponse.json({
      ok: true,
      message: "Login successful.",
      accessToken,
      user: safeUser,
    });
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to sign in right now.",
      },
      { status: 500 }
    );
  }
}