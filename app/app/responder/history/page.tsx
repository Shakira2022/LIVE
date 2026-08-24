
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

export default function ResponderHistory() {
  const {
    user,
    loading: authLoading,
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

        console.log(
          "==========================================",
        );

        console.log(
          "LOADING RESPONDER HISTORY",
        );

        console.log(
          "USER:",
          user.id,
        );

        console.log(
          "==========================================",
        );

        const response =
          await fetch(
            "/api/responder/history",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        let result: any = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        console.log(
          "RESPONDER HISTORY RESPONSE:",
          result,
        );

        if (!response.ok) {
          setError(
            result?.message ||
              "Unable to load assignment history.",
          );

          setItems([]);

          return;
        }

        setItems(
          Array.isArray(
            result?.assignments,
          )
            ? result.assignments
            : [],
        );
      } catch (error) {
        console.error(
          "Responder history error:",
          error,
        );

        setError(
          "Could not connect to the responder service.",
        );

        setItems([]);
      } finally {
        setLoading(false);
      }
    }, [user?.id]);

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