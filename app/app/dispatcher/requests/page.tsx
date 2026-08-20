"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RequestListItem } from "@/components/requests/request-list-item";
import { Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

import { supabase } from "@/lib/supabase";

interface EmergencyRequestRow {
  id: string;
  reference_code: string | null;
  requester_id: string | null;
  category: string | null;
  severity: string | null;
  note: string | null;
  callback_number: string | null;
  current_status: string | null;
  created_at: string;
  updated_at?: string | null;
  is_active?: boolean | null;
}

export default function DispatchRequests() {
  const [requests, setRequests] = useState<EmergencyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [severity, setSeverity] = useState("All");

  useEffect(() => {
    async function loadRequests() {
      try {
        setLoading(true);

        const { data, error } = await supabase
          .from("emergency_requests")
          .select(`
            id,
            reference_code,
            requester_id,
            category,
            severity,
            note,
            callback_number,
            current_status,
            created_at,
            updated_at,
            is_active
          `)
          .order("created_at", { ascending: false });

        if (error) {
          console.error(
            "Failed to load emergency requests:",
            error
          );

          setRequests([]);
          return;
        }

        console.log(
          "SUPABASE EMERGENCY REQUESTS:",
          data
        );

        setRequests(
          (data || []) as EmergencyRequestRow[]
        );
      } catch (error) {
        console.error(
          "Unexpected emergency request loading error:",
          error
        );

        setRequests([]);
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  const items = useMemo(() => {
    return requests.filter((r) => {
      const matchesStatus =
        status === "All" ||
        r.current_status === status;

      const matchesSeverity =
        severity === "All" ||
        r.severity === severity;

      const searchText = `
        ${r.id || ""}
        ${r.reference_code || ""}
        ${r.requester_id || ""}
        ${r.category || ""}
        ${r.note || ""}
        ${r.callback_number || ""}
      `.toLowerCase();

      const matchesSearch =
        searchText.includes(search.toLowerCase());

      return (
        matchesStatus &&
        matchesSeverity &&
        matchesSearch
      );
    });
  }, [requests, search, status, severity]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Dispatch"
        title="Request queue"
        description="Search and filter emergency requests."
      />

      <Panel>
        <div className="grid gap-3 border-b border-[#e2e8ed] p-4 sm:grid-cols-[1fr_190px_170px] sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-[#8b9aa4]" />

            <Input
              className="pl-11"
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              placeholder="Reference, requester or location"
            />
          </div>

          <Select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value)
            }
          >
            <option>All</option>
            <option>Submitted</option>
            <option>Received</option>
            <option>Assigned</option>
            <option>En route</option>
            <option>Arrived</option>
            <option>Closed</option>
            <option>Cancelled</option>
            <option>Rejected</option>
          </Select>

          <Select
            value={severity}
            onChange={(e) =>
              setSeverity(e.target.value)
            }
          >
            <option>All</option>
            <option>Critical</option>
            <option>High</option>
            <option>Moderate</option>
          </Select>
        </div>

        <PanelHeader
          title={`${items.length} matching requests`}
          description="Select a request to open operational controls."
        />

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#71828d]">
            No emergency requests found.
          </div>
        ) : (
          items.map((request) => (
            <RequestListItem
              key={request.id}
              request={request}
              href={`/app/dispatcher/requests/${request.id}`}
            />
          ))
        )}
      </Panel>
    </div>
  );
}