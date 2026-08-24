
"use client";

import {
  CheckCircle2,
  Clock3,
  History,
  MapPin,
  Navigation,
  RefreshCw,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requestStatusTone } from "@/lib/utils";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type HistoryItem = {
  assignment: {
    id: string;
    request_id: string;
    status:
      | "assigned"
      | "acknowledged"
      | "en_route"
      | "arrived"
      | "completed"
      | "cancelled"
      | "rejected";
    eta_minutes: number | null;
    assignment_note: string | null;
    assigned_at: string | null;
    acknowledged_at: string | null;
    route_started_at: string | null;
    arrived_at: string | null;
    completed_at: string | null;
    created_at: string;
  };

  request: any;

  location: any;
};

type HistoryResponse = {
  ok?: boolean;
  data?: {
    assignments?: HistoryItem[];
  };
  assignments?: HistoryItem[];
  message?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        details?: Record<string, string[]>;
      };
};

function getApiMessage(
  result: HistoryResponse | null,
  fallback: string,
) {
  if (!result) {
    return fallback;
  }

  if (typeof result.error === "string") {
    return result.error;
  }

  if (
    result.error &&
    typeof result.error === "object"
  ) {
    const firstDetail =
      result.error.details
        ? Object.values(
            result.error.details,
          )
            .flat()
            .find(Boolean)
        : undefined;

    return (
      firstDetail ||
      result.error.message ||
      result.message ||
      fallback
    );
  }

  return (
    result.message ||
    fallback
  );
}

async function readJson<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response = await fetch(
    input,
    requestInit,
  );

  if (response.status !== 401) {
    return response;
  }

  const refreshResponse =
    await fetch(
      "/api/auth/refresh",
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      },
    );

  if (!refreshResponse.ok) {
    return response;
  }

  response = await fetch(
    input,
    requestInit,
  );

  return response;
}

export default function ResponderHistory() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const [items, setItems] =
    useState<HistoryItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  // ==========================================================
  // LOAD HISTORY
  // ==========================================================

  const loadHistory =
    useCallback(async () => {
      if (!user?.id) {
        setItems([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response =
          await authenticatedFetch(
            "/api/responder/history",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          await readJson<HistoryResponse>(
            response,
          );

        if (!response.ok) {
          if (response.status === 401) {
            await refresh();
          }

          setError(
            getApiMessage(
              result,
              "Unable to load assignment history.",
            ),
          );

          setItems([]);
          return;
        }

        /*
         * New middleware route:
         * { ok: true, data: { assignments: [...] } }
         *
         * Old route fallback:
         * { ok: true, assignments: [...] }
         */
        const nextItems =
          result?.data?.assignments ??
          result?.assignments ??
          [];

        setItems(
          Array.isArray(nextItems)
            ? nextItems
            : [],
        );
      } catch (error) {
        console.warn(
          "Responder history error:",
          error instanceof Error
            ? error.message
            : String(error),
        );

        setError(
          "Could not connect to the responder service.",
        );

        setItems([]);
      } finally {
        setLoading(false);
      }
    }, [
      refresh,
      user?.id,
    ]);

  // ==========================================================
  // LOAD WHEN AUTHENTICATION IS READY
  // ==========================================================

  useEffect(() => {
    if (
      !authLoading &&
      user?.id
    ) {
      void loadHistory();
    }

    if (
      !authLoading &&
      !user
    ) {
      setItems([]);
      setLoading(false);
    }
  }, [
    authLoading,
    user?.id,
    user,
    loadHistory,
  ]);

  // ==========================================================
  // LOADING
  // ==========================================================

  if (
    authLoading ||
    loading ||
    !user
  ) {
    return <PageSkeleton />;
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error) {
    return (
      <div className="app-page">
        <Panel className="p-8">
          <div className="text-center">
            <h2 className="text-xl font-bold">
              Unable to load assignment history
            </h2>

            <p className="mt-2 text-sm text-[#627683]">
              {error}
            </p>

            <Button
              className="mt-5"
              onClick={() =>
                void loadHistory()
              }
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Responder"
        title="Assignment history"
        description="Completed and previous emergency assignments assigned to you."
        action={
          <Button
            variant="outline"
            onClick={() =>
              void loadHistory()
            }
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <Panel>
        <PanelHeader
          title={`${items.length} assignment${
            items.length === 1
              ? ""
              : "s"
          }`}
          description="Completed missions remain here for reference and are never treated as active missions."
        />

        {items.length === 0 ? (
          <EmptyState
            icon={
              <History className="h-7 w-7" />
            }
            title="No assignment history"
            description="Assignments completed by you will appear here."
          />
        ) : (
          <div className="divide-y divide-[#e2e8ed]">
            {items.map(
              (item) => {
                const assignment =
                  item.assignment;

                const request =
                  item.request;

                const location =
                  item.location;

                const isCompleted =
                  assignment.status ===
                  "completed";

                const requestStatus =
                  isCompleted
                    ? "completed"
                    : request?.current_status ||
                      assignment.status;

                const locationText =
                  location?.address_text ||
                  location?.landmark ||
                  "Location not available";

                return (
                  <div
                    key={
                      assignment.id
                    }
                    className="p-4 sm:p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        {/* ================================================= */}
                        {/* TITLE + STATUS                                    */}
                        {/* ================================================= */}

                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[#102b3f]">
                            {request?.reference_code ||
                              request?.id ||
                              assignment.request_id}
                          </p>

                          <Badge
                            tone={
                              isCompleted
                                ? "success"
                                : requestStatusTone(
                                    requestStatus,
                                  )
                            }
                          >
                            {isCompleted
                              ? "COMPLETED"
                              : requestStatus}
                          </Badge>
                        </div>

                        <p className="mt-1 text-sm text-[#627683]">
                          {request?.category ||
                            "Emergency response"}
                        </p>

                        {/* ================================================= */}
                        {/* COMPLETED MESSAGE                                 */}
                        {/* ================================================= */}

                        {isCompleted && (
                          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#edf8f2] px-3 py-2 text-sm font-semibold text-[#24724f]">
                            <CheckCircle2 className="h-4 w-4" />

                            Mission completed
                          </div>
                        )}

                        {/* ================================================= */}
                        {/* DETAILS                                           */}
                        {/* ================================================= */}

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {/* LOCATION */}

                          <div className="flex gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0f5b67]" />

                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                                Location
                              </p>

                              <p className="mt-1 text-sm text-[#526978]">
                                {
                                  locationText
                                }
                              </p>
                            </div>
                          </div>

                          {/* COMPLETION TIME */}

                          <div className="flex gap-2">
                            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#0f5b67]" />

                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                                Completed
                              </p>

                              <p className="mt-1 text-sm text-[#526978]">
                                {assignment.completed_at
                                  ? new Date(
                                      assignment.completed_at,
                                    ).toLocaleString()
                                  : isCompleted
                                    ? "Completed"
                                    : "Not completed"}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* ================================================= */}
                        {/* ASSIGNMENT NOTE                                   */}
                        {/* ================================================= */}

                        {assignment.assignment_note ? (
                          <div className="mt-4 rounded-xl bg-[#f5f8fa] p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                              Assignment note
                            </p>

                            <p className="mt-1 text-sm text-[#526978]">
                              {
                                assignment.assignment_note
                              }
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* =================================================== */}
                      {/* STATUS INDICATOR                                   */}
                      {/* =================================================== */}

                      <div className="flex shrink-0 items-center">
                        {isCompleted ? (
                          <div className="flex items-center gap-2 rounded-xl bg-[#edf8f2] px-3 py-2 text-sm font-semibold text-[#24724f]">
                            <CheckCircle2 className="h-4 w-4" />

                            Completed
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 rounded-xl bg-[#eef5f7] px-3 py-2 text-sm font-semibold text-[#0f6872]">
                            <Navigation className="h-4 w-4" />

                            {assignment.status}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}