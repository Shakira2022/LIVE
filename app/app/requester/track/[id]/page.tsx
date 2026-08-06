"use client";

import {
  ChevronRight,
  Clock3,
  MapPin,
  PhoneCall,
  Siren,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Sheet } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import {
  isActiveStatus,
  requestStatusTone,
} from "@/lib/utils";

export default function TrackRequest() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const {
    db,
    loading,
    cancelRequest,
  } = useMockStore();

  const router = useRouter();

  const [detailsOpen, setDetailsOpen] =
    useState(false);
  const [statusOpen, setStatusOpen] =
    useState(false);

  if (loading || !db || !user) {
    return <PageSkeleton map />;
  }

  const request = db.requests.find(
    (item) =>
      item.id === decodeURIComponent(id) &&
      item.requesterId === user.id
  );

  if (!request) {
    return (
      <div className="app-page">
        <Panel
          mobileCard={false}
          className="-mx-5 border-x-0 p-8 text-center md:mx-0 md:rounded-[22px] md:border-x"
        >
          <h1 className="text-xl font-semibold">
            Request not found
          </h1>

          <Button
            className="mt-5"
            onClick={() =>
              router.replace(
                "/app/requester/history"
              )
            }
          >
            Back to history
          </Button>
        </Panel>
      </div>
    );
  }

  const responder = db.responders.find(
    (item) =>
      item.id === request.assignedResponderId
  );

  const hasActiveRequest = isActiveStatus(
    request.status
  );

  function requestCancellation() {
    if (!request) return;
    if (!user) return;
    cancelRequest(request.id, user);
  }

  return (
    <div className="md:grid md:gap-5">
      {/* Desktop heading only */}
      <div className="hidden md:block">
        <PageHeading
          eyebrow="Live tracking"
          title={request.id}
          description={`${request.category} · ${request.severity} priority`}
          action={
            <Badge
              tone={requestStatusTone(
                request.status
              )}
              className="min-h-9 px-4"
            >
              {request.status}
            </Badge>
          }
        />
      </div>

      {/*
       * Mobile:
       * This area is fixed between the top header
       * and bottom navigation.
       *
       * Desktop:
       * It returns to the normal two-column layout.
       */}
      <div
        className="
          fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))]
          top-20 z-10 flex min-h-0 flex-col overflow-hidden
          bg-[#f5f7f9]

          md:static md:z-auto md:grid md:h-auto
          md:grid-cols-[1.35fr_.65fr] md:gap-4
          md:overflow-visible md:bg-transparent
        "
      >
        {/* Mobile status control */}
        <button
          type="button"
          onClick={() => setStatusOpen(true)}
          className="
            flex h-14 shrink-0 items-center gap-3
            border-b border-[#dce5ea]
            bg-white px-4 text-left
            md:hidden
          "
          aria-label="Open response status"
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0f6872]/35" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#0f6872]" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[#102b3f]">
              {request.status}
              {request.etaMinutes
                ? ` · ETA ${request.etaMinutes} min`
                : " · ETA pending"}
            </span>
          </span>

          <span className="text-xs font-semibold text-[#0f6872]">
            Updates
          </span>

          <ChevronRight className="h-4 w-4 shrink-0 text-[#0f6872]" />
        </button>

        {/*
         * The parent now has an actual height.
         * flex-1 gives the map all remaining room
         * below the status row.
         */}
        <div className="min-h-0 flex-1 overflow-hidden md:h-auto md:overflow-visible">
          <LiveResponseMap
            request={request}
            responder={responder}
            immersive
            className="
              h-full min-h-0 w-full rounded-none

              md:h-[72dvh]
              md:min-h-[500px]
              md:rounded-[22px]
            "
            mobileAction={
              <div
                className={
                  hasActiveRequest
                    ? "grid grid-cols-2 gap-2"
                    : "grid grid-cols-1 gap-2"
                }
              >
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setDetailsOpen(true)
                  }
                >
                  Request details
                </Button>

                {hasActiveRequest ? (
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={
                      requestCancellation
                    }
                  >
                    Cancel request
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>

        {/* Desktop response information */}
        <div className="hidden content-start gap-4 md:grid">
          <Panel>
            <PanelHeader
              title="Response status"
              description={
                request.etaMinutes
                  ? `Estimated arrival in ${request.etaMinutes} minutes`
                  : "No trusted ETA is currently available"
              }
            />

            <StatusTimeline
              entries={request.statusHistory}
            />
          </Panel>

          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              setDetailsOpen(true)
            }
          >
            View request details
          </Button>

          {hasActiveRequest ? (
            <Button
              variant="danger"
              className="w-full"
              onClick={requestCancellation}
            >
              Request cancellation
            </Button>
          ) : null}
        </div>
      </div>

      {/* Mobile status sheet */}
      <Sheet
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Response status"
        description={request.id}
        className="max-h-[82dvh]"
      >
        <div className="border-b border-[#e2e8ed] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#758792]">
                Current update
              </p>

              <p className="mt-1 text-lg font-semibold text-[#102b3f]">
                {request.status}
              </p>
            </div>

            <Badge
              tone={requestStatusTone(
                request.status
              )}
            >
              {request.etaMinutes
                ? `ETA ${request.etaMinutes} min`
                : "ETA pending"}
            </Badge>
          </div>
        </div>

        <div className="max-h-[calc(82dvh-9rem)] overflow-y-auto">
          <StatusTimeline
            entries={request.statusHistory}
          />
        </div>
      </Sheet>

      {/* Request details sheet */}
      <Sheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Request details"
        description={request.id}
      >
        <div className="p-5">
          <dl className="divide-y divide-[#e2e8ed] border-y border-[#e2e8ed]">
            <div className="flex gap-3 py-4">
              <MapPin className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Location
                </dt>

                <dd className="mt-1 font-semibold">
                  {request.location.address}
                </dd>

                <dd className="mt-1 text-xs text-[#71828d]">
                  {request.location.method}
                </dd>
              </div>
            </div>

            <div className="flex gap-3 py-4">
              <PhoneCall className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Callback
                </dt>

                <dd className="mt-1 font-semibold">
                  {request.callbackNumber}
                </dd>
              </div>
            </div>

            <div className="flex gap-3 py-4">
              <Siren className="h-5 w-5 shrink-0 text-[#d53f3d]" />

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  Incident note
                </dt>

                <dd className="mt-1 leading-6">
                  {request.note}
                </dd>
              </div>
            </div>

            {responder ? (
              <div className="flex gap-3 py-4">
                <Clock3 className="h-5 w-5 shrink-0 text-[#0f5b67]" />

                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                    Assigned response
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {responder.team} ·{" "}
                    {responder.vehicle}
                  </dd>
                </div>
              </div>
            ) : null}
          </dl>

          <div className="mt-5 border-l-4 border-[#d9a85d] bg-[#fff6e6] p-4 text-sm leading-6 text-[#78521e]">
            LIVE is a prototype. It must not be
            interpreted as confirmation that real
            emergency services have been contacted.
          </div>
        </div>
      </Sheet>
    </div>
  );
}