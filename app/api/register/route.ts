import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const {
      name,
      email,
      phone,
      emergencyContactName,
      emergencyContactPhone,
      password,
    } = await request.json();

    // Required fields
    if (
      !name ||
      !email ||
      !phone ||
      !emergencyContactName ||
      !emergencyContactPhone ||
      !password
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "All fields are required.",
        },
        { status: 400 }
      );
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanEmergencyContactName =
      emergencyContactName.trim();
    const cleanEmergencyContactPhone =
      emergencyContactPhone.trim();

    // Check if email already exists
    const { data: existingEmail, error: emailError } =
      await supabase
        .from("users")
        .select("id")
        .eq("email", cleanEmail)
        .is("deleted_at", null)
        .maybeSingle();

    if (emailError) {
      console.error("EMAIL CHECK ERROR:", emailError);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to check existing account.",
        },
        { status: 500 }
      );
    }

    if (existingEmail) {
      return NextResponse.json(
        {
          ok: false,
          message: "An account with this email already exists.",
        },
        { status: 409 }
      );
    }

    // Check if phone already exists
    const { data: existingPhone, error: phoneError } =
      await supabase
        .from("users")
        .select("id")
        .eq("phone", cleanPhone)
        .is("deleted_at", null)
        .maybeSingle();

    if (phoneError) {
      console.error("PHONE CHECK ERROR:", phoneError);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to check phone number.",
        },
        { status: 500 }
      );
    }

    if (existingPhone) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "An account with this phone number already exists.",
        },
        { status: 409 }
      );
    }

    // Hash password before storing it
    const passwordHash = await bcrypt.hash(password, 12);

    // Split full name
    const names = cleanName.split(/\s+/);

    const firstName = names[0] || "";
    const lastName = names.slice(1).join(" ") || "";

    // Create user
    const { data: user, error: insertError } =
      await supabase
        .from("users")
        .insert({
          first_name: firstName,
          last_name: lastName,
          display_name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          password_hash: passwordHash,
          role: "requester",
          status: "active",
        })
        .select(
          "id, email, phone, role, status, first_name, last_name, display_name"
        )
        .single();

    if (insertError) {
      console.error("REGISTRATION DATABASE ERROR:");
      console.error("Code:", insertError.code);
      console.error("Message:", insertError.message);
      console.error("Details:", insertError.details);
      console.error("Hint:", insertError.hint);

      return NextResponse.json(
        {
          ok: false,
          message: "Unable to create account.",
        },
        { status: 500 }
      );
    }

    console.log(
      "REGISTRATION SUCCESSFUL:",
      user.id
    );

    return NextResponse.json(
      {
        ok: true,
        message: "Registration successful.",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);

    return NextResponse.json(
      {
        ok: false,
        message: "Unable to register right now.",
      },
      { status: 500 }
    );
  }
}