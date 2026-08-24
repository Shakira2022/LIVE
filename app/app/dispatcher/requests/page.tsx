"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequestListItem } from "@/components/requests/request-list-item";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

import { supabase } from "@/lib/supabase";

export default function DispatcherRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadRequests() {
      console.log("========== REQUEST QUEUE ==========");
      console.log("Loading emergency requests...");

      try {
        setLoading(true);

        // ==================================================
        // LOAD EMERGENCY REQUESTS
        // ==================================================

        const {
          data: requestData,
          error: requestError,
        } = await supabase
          .from("emergency_requests")
          .select("*")
          .order("created_at", {
            ascending: false,
          });

        console.log(
          "EMERGENCY REQUESTS:",
          requestData
        );

        console.log(
          "EMERGENCY REQUEST ERROR:",
          requestError
        );

        if (requestError) {
          console.error(
            "Failed to load emergency requests:",
            requestError
          );

          setRequests([]);
          return;
        }

        if (!requestData || requestData.length === 0) {
          setRequests([]);
          return;
        }

        // ==================================================
        // LOAD LATEST ASSIGNMENT FOR EACH REQUEST
        // ==================================================

        const requestIds = requestData.map(
          (request) => request.id
        );

        const {
          data: assignmentData,
          error: assignmentError,
        } = await supabase
          .from("request_assignments")
          .select("*")
          .in("request_id", requestIds)
          .order("created_at", {
            ascending: false,
          });

        console.log(
          "REQUEST ASSIGNMENTS:",
          assignmentData
        );

        console.log(
          "REQUEST ASSIGNMENT ERROR:",
          assignmentError
        );

        if (assignmentError) {
          console.error(
            "Failed to load request assignments:",
            assignmentError
          );

          // We can still display the emergency requests
          setRequests(requestData);
          return;
        }

        // ==================================================
        // COMBINE REQUEST + LATEST ASSIGNMENT
        // ==================================================

        const latestAssignmentByRequest =
          new Map<string, any>();

        (assignmentData ?? []).forEach(
          (assignment) => {
            if (
              !latestAssignmentByRequest.has(
                assignment.request_id
              )
            ) {
              latestAssignmentByRequest.set(
                assignment.request_id,
                assignment
              );
            }
          }
        );

        const enrichedRequests = requestData.map(
          (request) => {
            const assignment =
              latestAssignmentByRequest.get(
                request.id
              );

            return {
              ...request,

              // Keep the original emergency request status
              emergency_request_status:
                request.current_status,

              // Assignment information
              assignment_status:
                assignment?.status ?? null,

              assignment_id:
                assignment?.id ?? null,

              responder_user_id:
                assignment?.responder_user_id ?? null,

              assigned_at:
                assignment?.assigned_at ?? null,

              assigned_by_user_id:
                assignment?.assigned_by_user_id ?? null,

              // The status shown by the dispatcher queue.
              //
              // If there is an assignment, use its status.
              // Otherwise use the emergency request status.
              current_status:
                assignment?.status ??
                request.current_status,
            };
          }
        );

        console.log(
          "ENRICHED REQUEST QUEUE:",
          enrichedRequests
        );

        setRequests(enrichedRequests);
      } catch (error) {
        console.error(
          "Unexpected request queue error:",
          error
        );

        setRequests([]);
      } finally {
        console.log(
          "Request queue loading finished."
        );

        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  // ==================================================
  // LOADING
  // ==================================================

  if (loading) {
    return <PageSkeleton map />;
  }

  // ==================================================
  // PAGE
  // ==================================================

  return (
    <div className="app-page grid gap-5">

      <PageHeading
        eyebrow="Dispatch operations"
        title="Request queue"
        description="View and manage incoming emergency requests."
      />

      <div className="grid gap-3">

        {requests.length === 0 ? (
          <div className="rounded-xl border p-8 text-center">

            <p className="font-semibold">
              No emergency requests found.
            </p>

            <p className="mt-1 text-sm text-gray-500">
              There are currently no requests in the system.
            </p>

          </div>
        ) : (

          requests.map((request) => (
            <Link
              key={request.id}
              href={`/app/dispatcher/requests/${request.id}`}
            >
              <RequestListItem
                request={request}
              />
            </Link>
          ))

        )}

      </div>
    </div>
  );
}