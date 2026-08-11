import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const allowedCategories = [
    "Medical emergency",
    "Road incident",
    "Fire/smoke",
    "Personal safety",
    "Other",
];

const allowedSeverities = [
    "Critical",
    "High",
    "Moderate",
];

export async function POST(request: Request) {
    try {
        // Get the information sent from page.tsx
        const body = await request.json();

        const {
            requesterId,
            category,
            severity,
            note,
            callbackNumber,
        } = body;

        // Validate requester
        if (!requesterId) {
            return NextResponse.json(
                { message: "Requester ID is required" },
                { status: 400 }
            );
        }

        // Validate category
        if (!category || !allowedCategories.includes(category)) {
            return NextResponse.json(
                { message: "A valid emergency category is required" },
                { status: 400 }
            );
        }

        // Validate severity
        if (!severity || !allowedSeverities.includes(severity)) {
            return NextResponse.json(
                { message: "A valid severity is required" },
                { status: 400 }
            );
        }

        // Validate callback number
        if (!callbackNumber) {
            return NextResponse.json(
                { message: "Callback number is required" },
                { status: 400 }
            );
        }

        // Create reference number
        const referenceCode = `LIVE-${new Date()
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, "")}-${Math.floor(
            1000 + Math.random() * 9000
        )}`;

        // Save request to Supabase
        const { data, error } = await supabase
            .from("emergency_requests")
            .insert({
                reference_code: referenceCode,
                requester_id: requesterId,
                category: category,
                severity: severity,
                note: note || null,
                callback_number: callbackNumber,
                current_status: "Submitted",
                is_active: true,
                is_cancelled: false,
                source: "Responsive web",
            })
            .select()
            .single();

        // Check for database error
        if (error) {
            console.error("Supabase error:", error);

            return NextResponse.json(
                {
                    message: "Failed to create emergency request",
                    error: error.message,
                },
                { status: 500 }
            );
        }

        // Send successful response
        return NextResponse.json(
            {
                message: "Emergency request created successfully",
                data: data,
            },
            { status: 201 }
        );

    } catch (error) {
        console.error("API error:", error);

        return NextResponse.json(
            { message: "Invalid request" },
            { status: 400 }
        );
    }
}