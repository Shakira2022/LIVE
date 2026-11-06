"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleHelp, Search, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";

export type RoleHelpActor = "dispatcher" | "admin" | "auditor" | "manager";
type HelpSection = { id: string; label: string };
type HelpQuestion = { section: string; title: string; answer: string };
type RoleHelpContent = { title: string; description: string; sections: HelpSection[]; questions: HelpQuestion[] };

const roleContent: Record<RoleHelpActor, RoleHelpContent> = {
  dispatcher: {
    title: "Dispatcher help",
    description: "Guidance for reviewing requests, assigning responders, and tracking operations.",
    sections: [
      { id: "live", label: "Live operations" },
      { id: "requests", label: "Requests" },
      { id: "resources", label: "Resources & activity" },
    ],
    questions: [
      { section: "live", title: "What is Live operations for?", answer: "Live operations is the dispatch overview. It brings together the organisation's requests, responder availability, map, and active routes. Use it to scan current activity, open a request for its details, and see whether a responder is available or already assigned. Data refreshes from the service; if a value looks stale, refresh or open the request directly before acting." },
      { section: "live", title: "How do I open and review a request?", answer: "Choose Request queue from navigation, then open the request row. Review the requester's description, confirmed location, severity, callback details, status history, current assignment, and operational notes. Confirm the correct incident and resource before changing an assignment or status." },
      { section: "live", title: "What do request statuses mean?", answer: "Submitted means the request was stored but dispatch has not confirmed review. Received means dispatch has confirmed it and is reviewing it. Assigned means a responder is assigned. En route means the responder started travelling. Arrived means the responder marked arrival at the location. Closed means the response was completed. Cancelled or Rejected means the request ended without an active response through that request. For exact operational context, open the record and review its history and notes." },
      { section: "live", title: "What should I verify before assigning a responder?", answer: "Check the incident location and access instructions, current request status, urgency/severity, whether a responder is already assigned, and the responder's organisation and availability. Select a resource that can respond under your organisation's procedures. If details are missing or conflicting, use the requester's callback information or operational workflow to clarify and add a note." },
      { section: "requests", title: "What does Assign response resource do?", answer: "On a request without an assignment, choose Assign response resource to open the assignment flow and select an eligible responder/resource. Review the selected person and request before confirming. The request status and assignment status are related but distinct; an assignment does not mean the responder has started travelling." },
      { section: "requests", title: "What do Acknowledge and Start route mean?", answer: "Acknowledge assignment records that the assigned responder accepted the assignment. Start route records that travel has begun and moves the assignment/request to En route. These controls are available only at the matching stage. Do not advance a status unless the operational step has occurred or the responder has confirmed it." },
      { section: "requests", title: "When should I use Complete assignment?", answer: "Use Complete assignment after the responder has marked arrival and the response work is finished according to your procedures. Completion closes the request and ends the active assignment. Confirm the outcome and record relevant operational notes first; do not close a request that still needs action." },
      { section: "requests", title: "What is Add note for?", answer: "Add note records useful operational context on the request, such as an access update or a dispatch follow-up. Keep notes factual, relevant, and respectful. Do not include passwords, verification codes, or unrelated personal details." },
      { section: "requests", title: "How do I read the status history?", answer: "Status history shows the recorded lifecycle changes and available notes/timestamps for the request. Use it to understand what happened and when. It is a record of saved events, not a substitute for contacting a responder or requester when a live decision needs confirmation." },
      { section: "resources", title: "Where do I check responder availability?", answer: "Choose Resources to view responders in your organisation, their current availability, last reported position, and any active assignment information shown. Location can be unavailable or old; check its freshness and do not assume a missing position means the responder is at a particular place." },
      { section: "resources", title: "How do I contact a responder or requester?", answer: "Use the call control on the relevant request or resource when it is available and the call state permits it. Calls depend on device permissions and network connection. If a call cannot connect, follow your organisation's approved contact and escalation process." },
      { section: "resources", title: "What is Operational activity?", answer: "Activity lists available recent dispatch, responder, and system events such as status changes, assignments, and routing actions. Use the actor, target, result, time, and correlation ID to understand an entry. It is an activity record and may not show every detail of a request; open the request for its history." },
      { section: "resources", title: "Where do I change my profile or settings?", answer: "Use the account menu to open Profile or Settings. Profile contains your account details; Settings contains your display and system preferences. System-wide administration settings are managed by administrators, not from dispatcher preferences." },
      { section: "resources", title: "What if the queue, map, or assignment looks wrong?", answer: "Refresh the relevant view and open the request or responder record to confirm the latest saved values. Check request status history, assignment status, and location freshness. If the mismatch remains, contact your system administrator and follow dispatch continuity procedures; do not assume a failed screen update changed the underlying assignment." },
    ],
  },
  admin: {
    title: "Administrator help",
    description: "Guidance for managing accounts, response organisations, configuration, and audit activity.",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "access", label: "Users & organisations" },
      { id: "system", label: "Settings & audit" },
    ],
    questions: [
      { section: "overview", title: "What does System overview show?", answer: "The overview summarises platform-wide users, organisations, active requests, denied security events, recent audit activity, and connected-system checks. These are operational indicators for administration; open the corresponding Users, Organisations, Audit, or Settings page to investigate or make an authorised change." },
      { section: "overview", title: "What does a denied event mean?", answer: "A denied event records an action that the system did not allow. Review the event and related audit details to understand the actor and target. A count alone does not prove malicious activity; use the audit record and your security process to investigate." },
      { section: "access", title: "How do I find or update a user?", answer: "Choose Users, search or filter the list, and open the relevant user controls. The page supports managing a user's role and suspending or restoring account access. Verify the identity and the operational request before saving changes; role changes affect what the user can access." },
      { section: "access", title: "What happens when I suspend an account?", answer: "Suspension blocks that account from normal access according to the platform's account controls. Confirm the correct account and follow your organisation's approval process before suspending. Restore access only when authorised; if a user is simply unable to sign in, review the account status and support process first." },
      { section: "access", title: "How do I manage response organisations?", answer: "Choose Organisations to review service coverage, integration state, and operational availability. The page provides controls to create an organisation and manage its status. Check the organisation identity, contact details, service area, and integration information before saving changes, because routing and dispatch depend on accurate configuration." },
      { section: "access", title: "Why does an organisation's status matter?", answer: "Organisation status and service-area configuration describe whether and where an organisation can operate in LIVE. Changing them can affect response routing and the way dispatch resources are presented. Coordinate changes with the organisation and dispatch operations, then verify the saved status and coverage." },
      { section: "system", title: "Where do I change system configuration?", answer: "Choose Settings, then review System configuration and the current configuration panels. Change only the setting you intend to change, check its description and current value, then use Save settings. Some settings are system-wide and can affect authentication, routing, integrations, or user experience. Follow change-control procedures and verify the result afterward." },
      { section: "system", title: "How do I check whether a setting saved?", answer: "Wait for the save result shown in the page, then review the current configuration values and reload if needed. If a save reports an error, do not assume the value changed. Confirm the persisted value before relying on it operationally." },
      { section: "system", title: "What are accessibility and notification settings?", answer: "These let you adjust how the admin interface appears and alerts on your device, including brightness, text size, text spacing, reduced motion, and notification sound/volume. These preferences improve your own interface; they do not change system-wide user settings." },
      { section: "system", title: "How do I review an audit event?", answer: "Open Audit from navigation or use View all in the overview's Latest audit activity panel. Review the action, actor, target, result, timestamp, and available correlation or context information. Preserve the record and follow your security process; do not treat a summary count as a complete investigation." },
      { section: "system", title: "What is the difference between Settings and Audit?", answer: "Settings is where authorised administrators review or update system configuration and personal display preferences. Audit is the record of security and administrative actions. Use Settings to manage a permitted value; use Audit to understand recorded activity and verify what the system logged." },
      { section: "system", title: "Where do I update my own profile?", answer: "Open the account menu and choose Profile to review your admin identity details. Use Settings for your display and accessibility preferences. Avoid sharing passwords or verification codes when requesting support." },
    ],
  },
  auditor: {
    title: "Auditor help",
    description: "Guidance for reviewing incident and audit records. Auditor pages are read-only.",
    sections: [
      { id: "records", label: "Incident records" },
      { id: "logs", label: "Audit & logs" },
      { id: "access", label: "Access & limits" },
    ],
    questions: [
      { section: "records", title: "Where do I review incident records?", answer: "Choose Incidents to view the approved incident records available to your auditor account. Open a record to review its location, request details, status, and lifecycle history. The incident sheet is read-only; use the status history to understand recorded changes and timestamps." },
      { section: "records", title: "What do incident statuses tell me?", answer: "Statuses describe the recorded request lifecycle: Submitted (stored, awaiting dispatch confirmation), Received (dispatch confirmed review), Assigned (a responder assigned), En route (travel started), Arrived (arrival recorded), Closed (response completed), Cancelled, or Rejected (no active response through that request). They show what LIVE recorded and do not independently verify events outside the system." },
      { section: "records", title: "What should I do if a record is missing or incomplete?", answer: "Use Refresh on Incident records and confirm the available filters or organisation scope. Review the incident history and related audit events. If information is still missing, report the record reference and what is absent through the approved administrator or support channel; auditor access does not provide controls to repair the record." },
      { section: "logs", title: "What can I review in Audit logs?", answer: "Audit logs show approved security and operational events, including the actor role, target, result, timestamp, and correlation information where available. Use these fields to follow an event through the record. Logs are read-only and may contain only the details permitted for your auditor role." },
      { section: "logs", title: "What are Security logs?", answer: "Security logs contain authentication and security-related events. Review the event, actor or account, result, timestamp, and available context. A failed or denied event is evidence of a recorded attempt, not by itself proof of intent; follow the approved investigation process." },
      { section: "logs", title: "What are Application logs?", answer: "Application logs show application events, service activity, and system errors. Use event time and context to identify what was recorded. These logs are read-only and may not include every detail needed to diagnose or change the underlying service." },
      { section: "logs", title: "What are Integration logs?", answer: "Integration logs record communications and external integration events. Review the event outcome and available context to see what LIVE recorded about a connection. If an event requires remediation, report it to an authorised administrator; the auditor view has no modification controls." },
      { section: "access", title: "Can I change an incident or system setting?", answer: "No. Auditor pages are read-only and do not provide operational modification controls. If a record needs correction or a system setting needs attention, document the reference and request an authorised dispatcher or administrator to review it." },
      { section: "access", title: "How should I handle sensitive information in records?", answer: "Access only records needed for your approved review. Treat requester contact, location, emergency-contact, and optional medical details as sensitive. Do not copy, disclose, or use them outside the authorised audit purpose, and follow your organisation's information-handling rules." },
      { section: "access", title: "Where do I find my profile and Help?", answer: "Open the account menu and choose Profile to review your read-only support/audit identity. Choose Help to return to this role-specific guide. If your access appears wrong, contact an administrator rather than attempting to change another user's account." },
    ],
  },
  manager: {
    title: "Manager help",
    description: "Guidance for reading incident, response, and security summaries and applying filters.",
    sections: [
      { id: "overview", label: "Overview" },
      { id: "incidents", label: "Incidents & filters" },
      { id: "security", label: "Security" },
    ],
    questions: [
      { section: "overview", title: "What does Management overview show?", answer: "Overview presents summary metrics and charts for incidents in the selected period and visible scope. It can include incident volume, severity, categories, current status mix, affected areas, and response timing. Use it to identify patterns, then open Incidents for the underlying records. A chart is a summary, not a decision about an individual incident." },
      { section: "overview", title: "What does Average response mean?", answer: "Average response is an aggregate response-time measure for the records that match the selected period and filters. It is not an ETA for an active request and does not guarantee the response time for a new incident. If no usable response data exists, the page shows that no response data is available." },
      { section: "incidents", title: "What is Incident intelligence?", answer: "Incident intelligence shows filtered incident records and charts for the selected scope. The table includes reference, submission time, category, severity, status, organisation, area, and response time when available. Use the record reference to discuss a specific case with dispatch; the manager view is for analysis, not operational assignment." },
      { section: "incidents", title: "How do I use the date filters?", answer: "Set From and To to define the reporting period, then review the charts and records that update for that range. Make sure both dates cover the period you intend to compare. These filters change the report view; they do not change incident dates or statuses." },
      { section: "incidents", title: "What does Group by do?", answer: "Group by selects the time interval used for trends: day, month, or year. Choose a level that suits the period being reviewed. A daily view is useful for short windows; month or year groups are easier to interpret over longer periods." },
      { section: "incidents", title: "How do Province, Area, and Organisation filters work?", answer: "Choose a province to limit the available areas, then choose an area and/or organisation to narrow the results. Changing a broader location filter clears dependent selections so the report does not keep an incompatible area. Use All options to restore the wider view and compare scopes consistently." },
      { section: "incidents", title: "What do severity and status charts mean?", answer: "Severity charts group records by recorded priority; status charts group records by their current lifecycle status. They describe the selected dataset and period. Check the filter settings and incident records before drawing conclusions, especially when the selected scope is small or a status is still changing." },
      { section: "incidents", title: "Why might a chart or metric show no data?", answer: "The selected period or location may have no matching records, or a metric may require a timestamp that is not available for those records. Broaden the date or location filters and review the table. A missing value should not be interpreted as zero response time or as proof that no work occurred." },
      { section: "security", title: "What does Security overview show?", answer: "Security overview combines filtered security events with incident and organisation context for the same reporting scope. Use the event table's timestamp, event, actor, result, IP address, and context where available to understand what was recorded. It is a management summary; detailed investigation belongs in the authorised audit/security workflow." },
      { section: "security", title: "Does the manager page let me change incidents or security events?", answer: "The manager pages are for analytics and review. Use the appropriate dispatch or administrator workflow for operational changes. If a security event needs investigation, report its details through your organisation's approved security process." },
      { section: "security", title: "Where do I find incidents or my profile?", answer: "Choose Incidents in navigation to view incident intelligence. Open the account menu and choose Profile for your account details. Use Help from that menu to return to this role-specific guide." },
    ],
  },
};

export function RoleHelpSheet({ actor, open, onOpenChange }: {
  actor: RoleHelpActor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const content = roleContent[actor];
  const [section, setSection] = useState(content.sections[0].id);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleQuestions = useMemo(() => content.questions.filter((item) => {
    const matches = !normalizedQuery || `${item.title} ${item.answer}`.toLocaleLowerCase().includes(normalizedQuery);
    return matches && (normalizedQuery.length > 0 || item.section === section);
  }), [content, normalizedQuery, section]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={content.title}
      description={content.description}
      side="right"
      className="!h-dvh !max-h-dvh !w-full !max-w-none md:!w-1/2 rounded-none bg-[#f6f8fb]"
      scrollAreaClassName="bg-[#f6f8fb]"
    >
      <div className="sticky top-0 z-30 shrink-0 border-b border-[#e2e8ed] bg-white">
        <nav className="grid px-2" style={{ gridTemplateColumns: `repeat(${content.sections.length}, minmax(0, 1fr))` }} aria-label={`${content.title} topics`}>
          {content.sections.map((item) => (
            <button key={item.id} type="button" onClick={() => { setSection(item.id); setQuery(""); }} aria-current={section === item.id && !normalizedQuery ? "page" : undefined} className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === item.id && !normalizedQuery ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492] hover:text-[#102b3f]"}`}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 sm:px-6">
          <label htmlFor={`${actor}-help-search`} className="sr-only">Search {content.title}</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71838f]" />
            <input id={`${actor}-help-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions and answers" className="h-11 w-full rounded-full border border-[#d6e1e6] bg-[#f8fafb] pl-10 pr-10 text-sm text-[#102b3f] outline-none placeholder:text-[#81909a] focus:border-[#0f6872] focus:bg-white" />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#667b89] hover:bg-[#eaf0f3]"><X className="h-4 w-4" /></button> : null}
          </div>
          {normalizedQuery ? <p className="mt-2 px-2 text-[11px] text-[#71838f]">Search results across all {actor} help topics</p> : null}
        </div>
      </div>
      {visibleQuestions.length ? (
        <div className="divide-y divide-[#dce5ea] px-5 md:px-6">
          {visibleQuestions.map((item, index) => <RoleQuestion key={item.title} item={item} id={`${actor}-help-answer-${index}`} searchActive={Boolean(normalizedQuery)} />)}
        </div>
      ) : (
        <div className="px-5 py-10 text-center md:px-6"><CircleHelp aria-hidden="true" className="mx-auto h-7 w-7 text-[#81909a]" /><p className="mt-3 font-semibold text-[#102b3f]">No matching help topics</p><p className="mt-1 text-sm text-[#667b89]">Try another word or clear your search.</p></div>
      )}
    </Sheet>
  );
}

function RoleQuestion({ item, id, searchActive }: { item: HelpQuestion; id: string; searchActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (searchActive) setExpanded(true); }, [searchActive]);
  return (
    <article className="border-b border-[#dce5ea] last:border-b-0">
      <h3><button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)} className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left font-semibold text-[#102b3f]"><span>{item.title}</span><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dce5ea] text-sm text-[#0f6872]">{expanded ? "-" : "+"}</span></button></h3>
      <div id={id} hidden={!expanded}><p className="pb-5 pr-10 text-sm leading-6 text-[#526a78]">{item.answer}</p></div>
    </article>
  );
}
