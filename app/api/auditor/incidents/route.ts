import { createHandler } from "@/lib/middleware/api/handler";
import { ApiError } from "@/lib/middleware/errors";
import { db } from "@/lib/middleware/server/db";

export const runtime = "nodejs";

/* -------------------------------------------------------------------------- */
/* Database row types                                                         */
/* -------------------------------------------------------------------------- */

type EmergencyRequestRow = {
  id: string;
  reference_code: string;
  requester_id: string;
  category: string;
  severity: string;
  note: string | null;
  callback_number: string;
  current_status: string;
  eta_minutes: number | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

type UserRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
};

type LocationRow = {
  request_id: string;
  latitude: number | string;
  longitude: number | string;
  accuracy_meters:
    | number
    | string
    | null;
  address_text: string | null;
  landmark: string | null;
  location_method: string;
  captured_at: string;
};

type HistoryRow = {
  id: string;
  request_id: string;
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  note: string | null;
  created_at: string;
};

function toIsoTimestamp(
  value: string | null | undefined,
): string {
  if (!value) {
    return new Date(0).toISOString();
  }

  const direct = new Date(value);

  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  /*
   * PostgreSQL can return values such as:
   * 2026-08-19 21:05:11.193614+00
   *
   * Normalise that into an ISO-8601 form understood consistently by
   * browsers and shared UI date helpers.
   */
  const match = value
    .trim()
    .match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}(?::?\d{2})?|Z)?$/,
    );

  if (!match) {
    return value;
  }

  const [, datePart, timePart, fractionRaw, zoneRaw] =
    match;

  const fraction = fractionRaw
    ? `.${fractionRaw.slice(0, 3).padEnd(3, "0")}`
    : "";

  let zone = zoneRaw || "Z";

  if (/^[+-]\d{2}$/.test(zone)) {
    zone = `${zone}:00`;
  } else if (/^[+-]\d{4}$/.test(zone)) {
    zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  }

  const normalized =
    `${datePart}T${timePart}${fraction}${zone}`;

  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString();
}

/* -------------------------------------------------------------------------- */
/* GET /api/auditor/incidents                                                 */
/* -------------------------------------------------------------------------- */

export const GET = createHandler(
  {
    name: "auditor.incidents",

    auth: "required",

    roles: [
      "auditor",
      "admin",
    ],

    rateLimit: {
      limit: 120,
      windowMs: 60_000,
      by: "user",
    },
  },

  async () => {
    /*
     * IMPORTANT:
     *
     * Auditor incidents must come from the real database.
     *
     * The previous auditor pages used useMockStore(), which is why
     * they displayed the old seeded/demo incidents instead of the
     * actual emergency_requests rows.
     */

    /* ---------------------------------------------------------------------- */
    /* Load real emergency requests                                          */
    /* ---------------------------------------------------------------------- */

    const {
      data: requestData,
      error: requestError,
    } = await db()
      .from(
        "emergency_requests",
      )
      .select(`
        id,
        reference_code,
        requester_id,
        category,
        severity,
        note,
        callback_number,
        current_status,
        eta_minutes,
        submitted_at,
        created_at,
        updated_at
      `)
      .order(
        "created_at",
        {
          ascending: false,
        },
      );

    if (requestError) {
      throw ApiError.internal(
        "Unable to retrieve incident records.",
        requestError.message,
      );
    }

    /*
     * The select string above is deliberately a literal.
     *
     * Do NOT change it back to:
     *
     * [
     *   "id",
     *   "reference_code",
     *   ...
     * ].join(",")
     *
     * because Supabase's TypeScript select parser cannot statically
     * understand the generated string and returns GenericStringError[].
     */

    const requests: EmergencyRequestRow[] =
      requestData ?? [];

    /* ---------------------------------------------------------------------- */
    /* No incidents                                                          */
    /* ---------------------------------------------------------------------- */

    if (
      requests.length === 0
    ) {
      const {
        count:
          organisationCount,

        error:
          organisationError,
      } = await db()
        .from(
          "organisations",
        )
        .select(
          "id",
          {
            count: "exact",
            head: true,
          },
        );

      if (
        organisationError
      ) {
        throw ApiError.internal(
          "Unable to retrieve organisation count.",
          organisationError.message,
        );
      }

      return {
        count: 0,

        organisationCount:
          organisationCount ??
          0,

        incidents: [],
      };
    }

    /* ---------------------------------------------------------------------- */
    /* IDs needed for related data                                           */
    /* ---------------------------------------------------------------------- */

    const requestIds =
      requests.map(
        (request) =>
          request.id,
      );

    const requesterIds = [
      ...new Set(
        requests.map(
          (request) =>
            request.requester_id,
        ),
      ),
    ];

    /* ---------------------------------------------------------------------- */
    /* Load related data                                                     */
    /* ---------------------------------------------------------------------- */

    const [
      usersResult,
      locationsResult,
      historyResult,
      organisationsResult,
    ] = await Promise.all([
      /*
       * Requester information
       */
      db()
        .from(
          "users",
        )
        .select(`
          id,
          first_name,
          last_name,
          display_name
        `)
        .in(
          "id",
          requesterIds,
        ),

      /*
       * Request locations
       */
      db()
        .from(
          "request_locations",
        )
        .select(`
          request_id,
          latitude,
          longitude,
          accuracy_meters,
          address_text,
          landmark,
          location_method,
          captured_at
        `)
        .in(
          "request_id",
          requestIds,
        ),

      /*
       * Complete lifecycle history
       */
      db()
        .from(
          "request_status_history",
        )
        .select(`
          id,
          request_id,
          previous_status,
          new_status,
          reason,
          note,
          created_at
        `)
        .in(
          "request_id",
          requestIds,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        ),

      /*
       * Dashboard organisation count
       */
      db()
        .from(
          "organisations",
        )
        .select(
          "id",
          {
            count: "exact",
            head: true,
          },
        ),
    ]);

    /* ---------------------------------------------------------------------- */
    /* Related-data errors                                                   */
    /* ---------------------------------------------------------------------- */

    if (
      usersResult.error
    ) {
      throw ApiError.internal(
        "Unable to retrieve incident requester details.",
        usersResult.error.message,
      );
    }

    if (
      locationsResult.error
    ) {
      throw ApiError.internal(
        "Unable to retrieve incident locations.",
        locationsResult.error.message,
      );
    }

    if (
      historyResult.error
    ) {
      throw ApiError.internal(
        "Unable to retrieve incident lifecycle history.",
        historyResult.error.message,
      );
    }

    if (
      organisationsResult.error
    ) {
      throw ApiError.internal(
        "Unable to retrieve organisation count.",
        organisationsResult.error.message,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Typed related data                                                    */
    /* ---------------------------------------------------------------------- */

    const users: UserRow[] =
      usersResult.data ??
      [];

    const locations: LocationRow[] =
      locationsResult.data ??
      [];

    const history: HistoryRow[] =
      historyResult.data ??
      [];

    /* ---------------------------------------------------------------------- */
    /* Convert database rows into the existing frontend request shape        */
    /* ---------------------------------------------------------------------- */

    const incidents =
      requests.map(
        (request) => {
          /* ---------------------------------------------------------------- */
          /* Requester                                                       */
          /* ---------------------------------------------------------------- */

          const requester =
            users.find(
              (user) =>
                user.id ===
                request.requester_id,
            );

          /* ---------------------------------------------------------------- */
          /* Location                                                        */
          /* ---------------------------------------------------------------- */

          const location =
            locations.find(
              (item) =>
                item.request_id ===
                request.id,
            );

          /* ---------------------------------------------------------------- */
          /* History                                                         */
          /* ---------------------------------------------------------------- */

          const requestHistory =
            history.filter(
              (item) =>
                item.request_id ===
                request.id,
            );

          /* ---------------------------------------------------------------- */
          /* Requester display name                                          */
          /* ---------------------------------------------------------------- */

          const requesterName =
            requester
              ?.display_name
              ?.trim() ||
            [
              requester
                ?.first_name,

              requester
                ?.last_name,
            ]
              .filter(
                Boolean,
              )
              .join(" ")
              .trim() ||
            "Requester";

          /* ---------------------------------------------------------------- */
          /* Numeric location values                                         */
          /* ---------------------------------------------------------------- */

          const latitude =
            location
              ? Number(
                  location.latitude,
                )
              : undefined;

          const longitude =
            location
              ? Number(
                  location.longitude,
                )
              : undefined;

          const accuracy =
            location
              ?.accuracy_meters ==
            null
              ? undefined
              : Number(
                  location
                    .accuracy_meters,
                );

          /* ---------------------------------------------------------------- */
          /* Return existing UI-compatible shape                             */
          /* ---------------------------------------------------------------- */

          return {
            id:
              request.id,

            referenceCode:
              request.reference_code,

            requesterId:
              request.requester_id,

            requesterName,

            category:
              request.category,

            severity:
              request.severity,

            note:
              request.note
                ?.trim() ||
              "No additional note provided.",

            callbackNumber:
              request.callback_number,

            status:
              request.current_status,

            etaMinutes:
              request
                .eta_minutes ??
              undefined,

            createdAt:
              request.created_at,

            updatedAt:
              request.updated_at,

            location: {
              address:
                location
                  ?.address_text
                  ?.trim() ||
                location
                  ?.landmark
                  ?.trim() ||
                "Location confirmed",

              method:
                location
                  ?.location_method ??
                "gps",

              lat:
                Number.isFinite(
                  latitude,
                )
                  ? latitude
                  : undefined,

              lng:
                Number.isFinite(
                  longitude,
                )
                  ? longitude
                  : undefined,

              accuracy:
                Number.isFinite(
                  accuracy,
                )
                  ? accuracy
                  : undefined,
            },

            statusHistory:
              requestHistory.map(
                (entry) => ({
                  id:
                    entry.id,

                  status:
                    entry
                      .new_status,

                  note:
                    entry.note ??
                    entry.reason ??
                    "",

                  createdAt:
                    toIsoTimestamp(
                      entry.created_at,
                    ),
                }),
              ),
          };
        },
      );

    /* ---------------------------------------------------------------------- */
    /* Response                                                              */
    /* ---------------------------------------------------------------------- */

    return {
      count:
        incidents.length,

      organisationCount:
        organisationsResult
          .count ??
        0,

      incidents,
    };
  },
);