"use client";

import { CircleDot, Mail, Phone, Power } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { readCached, writeFreshCache } from "@/lib/client-cache";

type ResponderState = {
  availability: string;
  go_offline_after_mission?: boolean;
  active_assignment_status?: string | null;
  organisation_id: string | null;
  shift_started_at: string | null;
  last_location_at: string | null;
};

function extractResponder(payload: {
  data?: ({ responder?: ResponderState; active_assignment_status?: string | null } & Partial<ResponderState>) | null;
  responder?: ResponderState | null;
}): ResponderState | null {
  if (payload.responder) return payload.responder;
  if (!payload.data) return null;
  const data = payload.data;
  const responder = data.responder ?? (data.availability ? data as ResponderState : null);
  return responder
    ? {
        ...responder,
        active_assignment_status: data.active_assignment_status ?? responder.active_assignment_status ?? null,
        go_offline_after_mission: data.go_offline_after_mission ?? responder.go_offline_after_mission ?? false,
      }
    : null;
}

function availabilityTone(availability: string) {
  return availability === "available" ? "success" : availability === "assigned" ? "warning" : "slate";
}

export default function ResponderProfile() {
  const { user } = useAuth();
  const initialAvailability = user?.id
    ? readCached<ResponderState>(`responder-availability:${user.id}`)
    : null;
  const [responder, setResponder] = useState<ResponderState | null>(initialAvailability);
  const [loading, setLoading] = useState(!initialAvailability);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch("/api/responder/availability", { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Unable to load availability.");
      const nextResponder = extractResponder(payload);
      setResponder(nextResponder);
      if (user?.id && nextResponder) {
        writeFreshCache(`responder-availability:${user.id}`, nextResponder, 5 * 60_000);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load availability.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const cached = user?.id
      ? readCached<ResponderState>(`responder-availability:${user.id}`)
      : null;

    if (cached) {
      setResponder(cached);
      setLoading(false);
    }

    void load(!cached);
    const refreshTimer = window.setInterval(() => {
      void load(false);
    }, 5_000);

    return () => window.clearInterval(refreshTimer);
  }, [load]);

  async function setAvailability(availability: "available" | "offline") {
    try {
      setUpdating(true);
      setError("");
      const response = await fetch("/api/responder/availability", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Unable to update availability.");
      const nextResponder = extractResponder(payload);
      if (nextResponder) {
        setResponder(nextResponder);
      }

      // Read the persisted row back after the mutation. This keeps the UI
      // aligned with the database and catches a trigger or assignment change
      // that may have altered the final availability.
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update availability.");
    } finally {
      setUpdating(false);
    }
  }

  async function setOfflineAfterMission(goOffline: boolean) {
    try {
      setUpdating(true);
      setError("");
      const response = await fetch("/api/responder/availability", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go_offline_after_mission: goOffline }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Unable to schedule availability after this mission.");
      const nextResponder = extractResponder(payload);
      if (nextResponder) setResponder(nextResponder);
      await load(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to schedule availability after this mission.");
    } finally {
      setUpdating(false);
    }
  }

  if (!user || (loading && !initialAvailability)) return <PageSkeleton />;
  const availability = responder?.availability ?? "offline";
  const isAssigned = Boolean(responder?.active_assignment_status) || availability === "assigned" || availability === "en_route" || availability === "on_scene";
  const isOfflineAfterMission = Boolean(responder?.go_offline_after_mission);

  return (
    <div className="app-page grid gap-5">
      <PageHeading title="Availability" description="Schedule going offline after your current mission; you stay visible and reachable until it ends." />

      <section className="border-y border-[#dce5ea] bg-white">
        <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e7f3f4] text-[#0f5b67]"><CircleDot className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold text-[#102b3f]">{user.name}</p>
              <p className="mt-1 text-sm text-[#667b89]">{isAssigned ? "You are assigned to an active mission." : "Your availability controls automatic dispatch."}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={availabilityTone(availability)}>{availability.replace(/_/g, " ")}</Badge>
            {isAssigned && isOfflineAfterMission ? <Badge tone="slate">Offline after mission</Badge> : null}
          </div>
        </div>

        <div className="grid border-t border-[#dce5ea] sm:grid-cols-2">
          <div className="flex gap-3 border-b border-[#dce5ea] px-5 py-4 sm:border-b-0 sm:border-r sm:px-6"><Mail className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">Email</p><p className="mt-1 text-sm font-medium">{user.email}</p></div></div>
          <div className="flex gap-3 px-5 py-4 sm:px-6"><Phone className="h-5 w-5 shrink-0 text-[#0f5b67]" /><div><p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">Callback number</p><p className="mt-1 text-sm font-medium">{user.phone}</p></div></div>
        </div>

        {error ? <p className="border-t border-[#f0c8c7] bg-[#fff7f6] px-5 py-3 text-sm font-medium text-[#a93331]">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dce5ea] px-5 py-4 sm:px-6">
          <p className="text-sm text-[#667b89]">{isAssigned
            ? isOfflineAfterMission
              ? "You remain visible, location-tracked and reachable during this mission. You will go offline when it ends."
              : "You remain visible, location-tracked and reachable. Choose offline after this mission to skip future automatic assignments."
            : availability === "available"
              ? "You can now be selected for nearby emergency requests."
              : "Go online when you are ready to receive work."}</p>
          <Button
            variant={isOfflineAfterMission || availability === "available" ? "outline" : "primary"}
            disabled={updating}
            onClick={() => void (isAssigned
              ? setOfflineAfterMission(!isOfflineAfterMission)
              : setAvailability(availability === "available" ? "offline" : "available"))}
          >
            <Power className="h-4 w-4" />
            {updating
              ? "Updating..."
              : isAssigned
                ? isOfflineAfterMission ? "Cancel offline after mission" : "Go offline after mission"
                : availability === "available" ? "Go offline" : "Go online"}
          </Button>
        </div>
      </section>
    </div>
  );
}
