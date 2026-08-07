"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Bell,
  Clock3,
  History,
  MapPin,
  Siren,
  Ambulance,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";
import {
  isActiveStatus,
  requestStatusTone,
} from "@/lib/utils";

export default function RequesterHome() {
  const { user } = useAuth();
  const { db, loading } = useMockStore();
  const [selectedCategory, setSelectedCategory] = useState<"Medical" | "Police">("Medical");

  if (loading || !db || !user) {
    return <PageSkeleton map />;
  }

  const requests = db.requests.filter(
    (request) =>
      request.requesterId === user.id
  );

  const active = requests.find((request) =>
    isActiveStatus(request.status)
  );

  const responder = active
    ? db.responders.find(
        (item) =>
          item.id === active.assignedResponderId
      )
    : undefined;

  const unread = db.notifications.filter(
    (notification) =>
      notification.userId === user.id &&
      !notification.read
  ).length;

  /*
   * Active request:
   * Mobile uses an app-style, edge-to-edge map.
   * Desktop keeps the two-column workspace.
   */
  if (active) {
    return (
      <div className="md:grid md:gap-5">
        {/* Desktop heading only */}
        <div className="hidden md:block">
          <PageHeading
            eyebrow="Requester"
            title={`Hello, ${
              user.name.split(" ")[0]
            }`}
            description="Your active request is shown below."
            action={
              <Link href="/app/requester/notifications">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Notifications"
                  className="relative"
                >
                  <Bell className="h-5 w-5" />

                  {unread ? (
                    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#d53f3d] px-1 text-[10px] text-white">
                      {unread}
                    </span>
                  ) : null}
                </Button>
              </Link>
            }
          />
        </div>

        {/*
         * Mobile:
         * Fix the map between the top header and
         * bottom navigation. This gives h-full a
         * real height and removes the empty screen.
         *
         * Desktop:
         * Return to normal document positioning.
         */}
        <div
          className="
            fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))]
            top-20 z-10 min-h-0

            md:static md:z-auto md:grid md:h-auto
            md:grid-cols-[1.35fr_.65fr] md:gap-4
          "
        >
          <div className="h-full min-h-0 overflow-hidden md:h-auto md:overflow-visible">
            <LiveResponseMap
              request={active}
              responder={responder}
              immersive
              className="
                h-full min-h-0 w-full rounded-none

                md:h-[72dvh] md:min-h-[500px]
                md:rounded-[22px]
              "
              mobileAction={
                <Link
                  href={`/app/requester/track/${active.id}`}
                  className="block"
                >
                  <Button className="w-full">
                    Open tracking
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              }
            />
          </div>

          {/* Desktop request information */}
          <div className="hidden content-start gap-4 md:grid">
            <Panel>
              <PanelHeader
                title="Active request"
                action={
                  <Badge
                    tone={requestStatusTone(
                      active.status
                    )}
                  >
                    {active.status}
                  </Badge>
                }
              />

              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">
                  {active.id}
                </p>

                <h2 className="mt-2 text-xl font-semibold">
                  {active.category}
                </h2>

                <p className="mt-2 text-sm leading-6 text-[#5f7482]">
                  {active.note}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#f2f6f8] p-3">
                    <Clock3 className="h-4 w-4 text-[#0f5b67]" />

                    <p className="mt-2 text-xs font-semibold text-[#748693]">
                      Estimated arrival
                    </p>

                    <p className="mt-1 font-semibold">
                      {active.etaMinutes
                        ? `${active.etaMinutes} min`
                        : "Pending"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#f2f6f8] p-3">
                    <MapPin className="h-4 w-4 text-[#0f5b67]" />

                    <p className="mt-2 text-xs font-semibold text-[#748693]">
                      Location
                    </p>

                    <p className="mt-1 truncate font-semibold">
                      {active.location.method}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/app/requester/track/${active.id}`}
                >
                  <Button className="mt-4 w-full">
                    Open tracking
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </Panel>

            <Link href="/app/requester/new">
              <Button
                variant="danger"
                size="lg"
                className="w-full"
              >
                <Siren className="h-5 w-5" />
                Request additional help
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Requester"
        title={`Hello, ${
          user.name.split(" ")[0]
        }`}
        description="Request help quickly or review your previous activity."
        action={
          <Link href="/app/requester/notifications">
            <Button
              variant="outline"
              size="icon"
              aria-label="Notifications"
              className="relative"
            >
              <Bell className="h-5 w-5" />

              {unread ? (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#d53f3d] px-1 text-[10px] text-white">
                  {unread}
                </span>
              ) : null}
            </Button>
          </Link>
        }
      />

      {/* Emergency Action Card */}
      <Panel
        mobileCard={false}
        className="-mx-5 border-x-0 p-6 md:mx-0 md:rounded-[22px] md:border-x bg-white text-slate-900 shadow-sm"
      >
        <div className="flex flex-col items-center text-center space-y-5">
          <header className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">Immediate Emergency Assistance</h2>
            <p className="text-xs text-slate-500 max-w-sm">
              Select your emergency type to request priority dispatch.
            </p>
          </header>

          {/* Category Selector Toggles */}
          <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={() => setSelectedCategory("Medical")}
              className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs border transition-all ${
                selectedCategory === "Medical"
                  ? "bg-red-50 border-red-500 text-red-600 shadow-sm ring-1 ring-red-500"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Ambulance className="h-4 w-4" />
              Medical
            </button>

            <button
              type="button"
              onClick={() => setSelectedCategory("Police")}
              className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs border transition-all ${
                selectedCategory === "Police"
                  ? "bg-blue-50 border-blue-500 text-blue-600 shadow-sm ring-1 ring-blue-500"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              Police
            </button>
          </div>

          {/* Prolonged Rectangular Emergency Button */}
          <div className="w-full max-w-xs">
            <Link
              href={{
                pathname: "/app/requester/new",
                query: { category: selectedCategory },
              }}
              className="block w-full"
            >
              <button
                type="button"
                className="w-full py-4 px-6 rounded-2xl bg-[#d53f3d] hover:bg-[#c23533] active:scale-[0.98] text-white font-black text-base shadow-lg shadow-red-500/25 flex items-center justify-center gap-3 transition-all border border-red-400"
              >
                <Siren className="h-6 w-6 animate-pulse" />
                <span>REQUEST {selectedCategory.toUpperCase()} HELP</span>
              </button>
            </Link>
          </div>

          {/* GPS Location Status Indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500 bg-slate-50 py-2 px-4 rounded-full border border-slate-200">
            <MapPin className="h-3.5 w-3.5 text-[#0f5b67]" />
            <span>GPS location will be automatically attached</span>
          </div>
        </div>
      </Panel>

      <div className="-mx-5 divide-y divide-[#dfe7ec] border-y border-[#dfe7ec] bg-white md:mx-0 md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 md:border-0 md:bg-transparent">
        <Link
          href="/app/requester/history"
          className="
            flex items-center gap-4 px-5 py-4
            transition active:bg-[#eef4f6]

            md:rounded-2xl md:border
            md:border-[#dfe7ec] md:bg-white md:p-4
            md:hover:border-[#aabcc7]
          "
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f5b67]">
            <History className="h-5 w-5" />
          </span>

          <span>
            <span className="block font-semibold">
              Request history
            </span>

            <span className="mt-1 block text-xs text-[#71828d]">
              {requests.length} stored requests
            </span>
          </span>
        </Link>

        <Link
          href="/app/requester/profile"
          className="
            flex items-center gap-4 px-5 py-4
            transition active:bg-[#eef4f6]

            md:rounded-2xl md:border
            md:border-[#dfe7ec] md:bg-white md:p-4
            md:hover:border-[#aabcc7]
          "
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf2f5] text-[#536879]">
            <MapPin className="h-5 w-5" />
          </span>

          <span>
            <span className="block font-semibold">
              Emergency details
            </span>

            <span className="mt-1 block text-xs text-[#71828d]">
              Check callback and contact
              information
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}