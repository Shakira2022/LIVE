"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ArrowRight,
  FileSearch,
  ShieldCheck,
  Siren,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Metric } from "@/components/dashboard/metric";
import { RequestListItem } from "@/components/requests/request-list-item";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

type Incident = {
  id: string;
  referenceCode: string;
  requesterId: string;
  requesterName: string;
  category: string;
  severity: string;
  note: string;
  callbackNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;

  location: {
    address: string;
    method: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
  };

  statusHistory: Array<{
    id: string;
    status: string;
    note: string;
    createdAt: string;
  }>;
};

type IncidentResponse = {
  ok?: boolean;

  data?: {
    count?: number;
    organisationCount?: number;
    incidents?: Incident[];
  };

  count?: number;
  organisationCount?: number;
  incidents?: Incident[];

  message?: string;
};

type AuditResponse = {
  ok?: boolean;

  data?: {
    count?: number;
    logs?: unknown[];
  };

  count?: number;
  logs?: unknown[];
};

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
) {
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
  };

  let response =
    await fetch(
      input,
      requestInit,
    );

  if (
    response.status !== 401
  ) {
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

  if (
    !refreshResponse.ok
  ) {
    return response;
  }

  return fetch(
    input,
    requestInit,
  );
}

export default function AuditorHome() {
  const {
    user,
    loading: authLoading,
    refresh,
  } = useAuth();

  const [
    incidents,
    setIncidents,
  ] =
    useState<Incident[]>([]);

  const [
    auditCount,
    setAuditCount,
  ] =
    useState(0);

  const [
    organisationCount,
    setOrganisationCount,
  ] =
    useState(0);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const loadDashboard =
    useCallback(async () => {
      if (!user?.id) {
        setIncidents([]);
        setAuditCount(0);
        setOrganisationCount(0);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const [
          incidentsResponse,
          auditResponse,
        ] =
          await Promise.all([
            authenticatedFetch(
              "/api/auditor/incidents",
              {
                method:
                  "GET",
                cache:
                  "no-store",
              },
            ),

            authenticatedFetch(
              "/api/auditor/logs?type=audit",
              {
                method:
                  "GET",
                cache:
                  "no-store",
              },
            ),
          ]);

        if (
          incidentsResponse.status ===
            401 ||
          auditResponse.status ===
            401
        ) {
          await refresh();
        }

        const incidentResult =
          await readJson<IncidentResponse>(
            incidentsResponse,
          );

        const auditResult =
          await readJson<AuditResponse>(
            auditResponse,
          );

        if (
          incidentsResponse.ok
        ) {
          const nextIncidents =
            incidentResult?.data
              ?.incidents ??
            incidentResult?.incidents ??
            [];

          setIncidents(
            Array.isArray(
              nextIncidents,
            )
              ? nextIncidents
              : [],
          );

          setOrganisationCount(
            incidentResult?.data
              ?.organisationCount ??
              incidentResult?.organisationCount ??
              0,
          );
        } else {
          setIncidents([]);
          setOrganisationCount(0);
        }

        if (
          auditResponse.ok
        ) {
          setAuditCount(
            auditResult?.data
              ?.count ??
              auditResult?.count ??
              auditResult?.data
                ?.logs?.length ??
              auditResult?.logs
                ?.length ??
              0,
          );
        } else {
          setAuditCount(0);
        }
      } catch (error) {
        console.warn(
          "Unable to load auditor dashboard:",
          error instanceof
          Error
            ? error.message
            : String(
                error,
              ),
        );

        setIncidents([]);
        setAuditCount(0);
        setOrganisationCount(0);
      } finally {
        setLoading(false);
      }
    }, [
      refresh,
      user?.id,
    ]);

  useEffect(() => {
    if (
      authLoading
    ) {
      return;
    }

    if (
      !user?.id
    ) {
      setIncidents([]);
      setAuditCount(0);
      setOrganisationCount(0);
      setLoading(false);
      return;
    }

    void loadDashboard();
  }, [
    authLoading,
    loadDashboard,
    user?.id,
  ]);

  if (
    authLoading ||
    loading ||
    !user
  ) {
    return (
      <PageSkeleton />
    );
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Read-only review"
        title="Audit and incident overview"
        description="Review approved incident and audit records without operational modification controls."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Incident records"
          value={
            incidents.length
          }
          icon={
            <Siren className="h-5 w-5" />
          }
        />

        <Metric
          label="Audit events"
          value={
            auditCount
          }
          icon={
            <ShieldCheck className="h-5 w-5" />
          }
        />

        <Metric
          label="Organisations"
          value={
            organisationCount
          }
          icon={
            <FileSearch className="h-5 w-5" />
          }
        />
      </div>

      <Panel>
        <PanelHeader
          title="Recent incidents"
          action={
            <Link href="/app/auditor/incidents">
              <Button
                variant="ghost"
                size="sm"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          }
        />

        {incidents
          .slice(
            0,
            6,
          )
          .map(
            (incident) => (
              <RequestListItem
                key={
                  incident.id
                }
                request={
                  incident as any
                }
                href={`/app/auditor/incidents?request=${encodeURIComponent(
                  incident.id,
                )}`}
                compact
              />
            ),
          )}

        {incidents.length ===
        0 ? (
          <div className="p-5 text-sm text-[#617582]">
            No incident records were found.
          </div>
        ) : null}
      </Panel>
    </div>
  );
}