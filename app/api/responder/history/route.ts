import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

const HISTORY_ASSIGNMENT_STATUSES = [
  "completed",
  "cancelled",
  "rejected",
] as const;

export const GET = createHandler(
  {
    name: "responder.history",
    auth: "required",
    roles: ["responder"],
    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },
  async (ctx) => {
    /*
     * Authentication comes from createHandler().
     * This uses the same configured JWT cookie as the rest of the application.
     */
    const responderUserId =
      ctx.user.userId;

    const {
      data: assignments,
      error: assignmentError,
    } = await db()
      .from("request_assignments")
      .select("*")
      .eq(
        "responder_user_id",
        responderUserId,
      )
      .in(
        "status",
        HISTORY_ASSIGNMENT_STATUSES,
      )
      .order(
        "completed_at",
        {
          ascending: false,
          nullsFirst: false,
        },
      )
      .order("created_at", {
        ascending: false,
      });

    if (assignmentError) {
      throw ApiError.internal(
        "Unable to load assignment history.",
        assignmentError.message,
      );
    }

    if (
      !assignments ||
      assignments.length === 0
    ) {
      return {
        assignments: [],
      };
    }

    const requestIds = [
      ...new Set(
        assignments.map(
          (assignment) =>
            assignment.request_id,
        ),
      ),
    ];

    const [
      requestsResult,
      locationsResult,
    ] = await Promise.all([
      db()
        .from(
          "emergency_requests",
        )
        .select("*")
        .in(
          "id",
          requestIds,
        ),

      db()
        .from(
          "request_locations",
        )
        .select("*")
        .in(
          "request_id",
          requestIds,
        ),
    ]);

    if (
      requestsResult.error
    ) {
      throw ApiError.internal(
        "Unable to load emergency request history.",
        requestsResult.error.message,
      );
    }

    if (
      locationsResult.error
    ) {
      ctx.log.warn(
        "responder_history_location_lookup_failed",
        {
          dbError:
            locationsResult.error.message,
        },
      );
    }

    const requests =
      requestsResult.data ??
      [];

    const locations =
      locationsResult.data ??
      [];

    const history =
      assignments.map(
        (assignment) => ({
          assignment,

          request:
            requests.find(
              (item) =>
                item.id ===
                assignment.request_id,
            ) ??
            null,

          location:
            locations.find(
              (item) =>
                item.request_id ===
                assignment.request_id,
            ) ??
            null,
        }),
      );

    return {
      assignments:
        history,
    };
  },
);