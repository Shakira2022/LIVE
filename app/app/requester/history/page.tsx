"use client";

import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { RequestListItem } from "@/components/requests/request-list-item";
import {
  EmptyState,
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useMockStore } from "@/lib/mock-store";

export default function RequestHistory() {
  const { user } = useAuth();
  const { db, loading } = useMockStore();

  if (loading || !db || !user) {
    return <PageSkeleton />;
  }

  const items = db.requests.filter(
    (request) => request.requesterId === user.id,
  );

  return (
    <div className="app-page grid gap-5">
      <Link
        href="/app/requester"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
        aria-label="Back to requester dashboard"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      <PageHeading
        eyebrow="Requester"
        title="Request history"
        description="Review active, completed, cancelled and rejected requests."
      />

      <Panel
        mobileCard={false}
        className="-mx-5 border-x-0 md:mx-0 md:rounded-[22px] md:border-x"
      >
        <PanelHeader
          title={`${items.length} requests`}
          description="Newest activity appears first."
          className="px-5"
        />

        {items.length ? (
          items.map((request) => (
            <RequestListItem
              key={request.id}
              request={request}
              href={`/app/requester/track/${request.id}`}
            />
          ))
        ) : (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="No request history"
            description="Submitted emergency requests will appear here."
          />
        )}
      </Panel>
    </div>
  );
}
