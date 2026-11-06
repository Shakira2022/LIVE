"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  MapPin,
  Navigation,
  Search,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";

type ResponderHelpSection = "mission" | "request" | "buttons";
type GuideItem = {
  section: ResponderHelpSection;
  title: string;
  body: string;
  icon: typeof CircleHelp;
};

const sections: { id: ResponderHelpSection; label: string }[] = [
  { id: "mission", label: "Mission status" },
  { id: "request", label: "Request status" },
  { id: "buttons", label: "Buttons" },
];

const items: GuideItem[] = [
  {
    section: "mission",
    title: "What does Assigned mean for my mission?",
    body: "Dispatch has assigned this mission to you. Review the incident details, location, access notes, and available requester information. When you are taking the assignment, use Acknowledge assignment. Acknowledging confirms acceptance; follow the app's next action and operational procedure.",
    icon: CircleHelp,
  },
  {
    section: "mission",
    title: "What does Acknowledged mean for my mission?",
    body: "Your acceptance of the assignment has been recorded. In LIVE, acknowledging advances the mission into En route, so this may be a brief transition rather than a long-lasting status. Acknowledged alone does not mean the requester has been reached.",
    icon: CheckCircle2,
  },
  {
    section: "mission",
    title: "What does En route mean for my mission?",
    body: "The mission route has started and the request is shown as En route. Check the destination and route information, travel according to your organisation's procedures, and keep status and location information accurate. The map can be delayed or unavailable; use operational judgement and dispatch communication when needed.",
    icon: Navigation,
  },
  {
    section: "mission",
    title: "What does Arrived mean for my mission?",
    body: "Use Arrived only once you have reached the incident location. LIVE checks your reported location against the request location and enables arrival within 100 metres; it may also record arrival automatically. If arrival is unavailable, check that your current location is updated and accurate before retrying.",
    icon: MapPin,
  },
  {
    section: "mission",
    title: "What does Completed mean for my mission?",
    body: "Complete the response only after your work on this mission is finished and according to your organisation's procedure. LIVE records the assignment as completed, closes the associated request, removes the mission from your active screen, and retains it in History. If work is still required, do not mark it completed.",
    icon: CheckCircle2,
  },
  {
    section: "mission",
    title: "What does a Cancelled or Rejected assignment mean?",
    body: "These are terminal assignment outcomes, not steps in the normal route. They mean this assignment is no longer active for you. They are different from the request status: dispatch may still need to manage the request or assign another responder. Check the mission history or contact dispatch for the operational reason and next action.",
    icon: X,
  },
  {
    section: "request",
    title: "What does Submitted mean for the request?",
    body: "The requester submitted the information and LIVE stored it. Dispatch has not yet confirmed review. This is not an assignment and does not mean a responder is travelling.",
    icon: CircleHelp,
  },
  {
    section: "request",
    title: "What does Received mean for the request?",
    body: "Dispatch confirmed the request and is reviewing it. A responder may not yet be assigned. Follow the queue and assignment process used by your dispatch team.",
    icon: CircleHelp,
  },
  {
    section: "request",
    title: "What does Assigned mean for the request?",
    body: "A responder has been assigned to the request. The assignment may still need to be acknowledged; Assigned alone does not mean the responder has started travelling.",
    icon: CircleHelp,
  },
  {
    section: "request",
    title: "What does En route mean for the request?",
    body: "The assigned responder has started the route. The requester may see this update and any tracking information available. ETA and map data can be absent or delayed, so do not treat them as guaranteed arrival times.",
    icon: Navigation,
  },
  {
    section: "request",
    title: "What does Arrived mean for the request?",
    body: "The responder has recorded arrival at the request location. This is a location/status update; follow your organisation's on-scene and communication procedures.",
    icon: MapPin,
  },
  {
    section: "request",
    title: "What does Closed mean for the request?",
    body: "The response has been completed and the request is no longer active. LIVE closes the request when the responder completes the mission. If the situation is still active, follow dispatch procedure to address it rather than assuming the closed request remains active.",
    icon: CheckCircle2,
  },
  {
    section: "request",
    title: "What does a Cancelled or Rejected request mean?",
    body: "The request has ended without an active response through that request. Do not assume the requester received help. Follow dispatch procedure to confirm whether further action or a new assignment is needed.",
    icon: AlertTriangle,
  },
  {
    section: "request",
    title: "How are mission status and request status different?",
    body: "Mission status describes your assignment (for example, Acknowledged or Completed). Request status describes the requester's incident record (for example, Received or Closed). LIVE updates both as the mission progresses, but cancelled or rejected assignment outcomes do not by themselves mean the request was completed.",
    icon: CircleHelp,
  },
  {
    section: "buttons",
    title: "What does Acknowledge assignment do?",
    body: "Use this button after reviewing a new assignment and confirming that you are taking it. LIVE records your acknowledgement and advances the route workflow. If you cannot take the mission, follow your organisation's dispatch procedure rather than treating acknowledgement as optional paperwork.",
    icon: CheckCircle2,
  },
  {
    section: "buttons",
    title: "What do Start route and En route do?",
    body: "Start route records that travel to the request location has begun and changes the status to En route. The acknowledgement action may advance directly into this step. Check the address and map before travelling; use your organisation's operational and road-safety procedures.",
    icon: Navigation,
  },
  {
    section: "buttons",
    title: "When should I use Arrived?",
    body: "Use Arrived only after reaching the scene. LIVE enables the action when your reported location is within 100 metres of the request location and may record arrival automatically. If the button is unavailable, update your location and confirm it is accurate; do not mark arrival before you are there.",
    icon: MapPin,
  },
  {
    section: "buttons",
    title: "When should I use Complete response?",
    body: "Choose Complete response only when your work on the mission is finished and your organisation's procedure allows you to close it. This marks the assignment complete, closes the request, removes it from the active mission screen, and keeps it in History. If further help is needed, do not close it prematurely; coordinate with dispatch.",
    icon: CheckCircle2,
  },
  {
    section: "buttons",
    title: "What does Open tracking show?",
    body: "Choose Open tracking from the mission map controls to open the tracking view for this request. Use it to review the incident location and available route or status details. Tracking data may be delayed or unavailable, so follow dispatch information and operational procedures too.",
    icon: MapPin,
  },
  {
    section: "buttons",
    title: "When should I use Call requester?",
    body: "Use Call requester on the active mission when you need to contact the requester through LIVE. The call depends on device microphone permissions and the other person's connection. If the call does not connect, use the contact path set by your organisation or coordinate through dispatch.",
    icon: CircleHelp,
  },
  {
    section: "buttons",
    title: "Where do I find History and availability?",
    body: "Choose History in the main navigation to review current and previous assignments. Choose Profile or Availability from the account menu/navigation to review your responder profile and availability controls. Change availability according to your organisation's dispatch procedure so assignment routing reflects whether you can respond.",
    icon: CircleHelp,
  },
  {
    section: "buttons",
    title: "How do I use Help and search?",
    body: "Open the account menu and choose Help to return to this guide. Use the search field below the topic tabs to find a status or button; search checks every responder help topic. Clear the search to return to the selected section.",
    icon: CircleHelp,
  },
];

export function ResponderHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<ResponderHelpSection>("mission");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () => items.filter((item) => {
      const matchesSearch = !normalizedQuery
        || `${item.title} ${item.body}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesSearch && (normalizedQuery.length > 0 || item.section === section);
    }),
    [normalizedQuery, section],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Responder help"
      description="Understand mission and request statuses and what each step means."
      side="right"
      className="!h-dvh !max-h-dvh !w-full !max-w-none md:!w-1/2 rounded-none bg-[#f6f8fb]"
      scrollAreaClassName="bg-[#f6f8fb]"
    >
      <div className="sticky top-0 z-30 shrink-0 border-b border-[#e2e8ed] bg-white">
        <nav className="grid grid-cols-3 px-2" aria-label="Responder help topics">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { setSection(item.id); setQuery(""); }}
              aria-current={section === item.id && !normalizedQuery ? "page" : undefined}
              className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${section === item.id && !normalizedQuery ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492] hover:text-[#102b3f]"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 sm:px-6">
          <label htmlFor="responder-help-search" className="sr-only">Search responder help</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71838f]" />
            <input
              id="responder-help-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search statuses and guidance"
              className="h-11 w-full rounded-full border border-[#d6e1e6] bg-[#f8fafb] pl-10 pr-10 text-sm text-[#102b3f] outline-none placeholder:text-[#81909a] focus:border-[#0f6872] focus:bg-white"
            />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#667b89] hover:bg-[#eaf0f3]"><X className="h-4 w-4" /></button> : null}
          </div>
          {normalizedQuery ? <p className="mt-2 px-2 text-[11px] text-[#71838f]">Search results across mission and request statuses</p> : null}
        </div>
      </div>
      {visibleItems.length ? (
        <div className="divide-y divide-[#dce5ea] px-5 md:px-6">
          {visibleItems.map((item, index) => (
            <HelpQuestion key={item.title} item={item} id={`responder-help-answer-${index}`} searchActive={Boolean(normalizedQuery)} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-10 text-center md:px-6"><CircleHelp aria-hidden="true" className="mx-auto h-7 w-7 text-[#81909a]" /><p className="mt-3 font-semibold text-[#102b3f]">No matching help topics</p><p className="mt-1 text-sm text-[#667b89]">Try another search.</p></div>
      )}
    </Sheet>
  );
}

function HelpQuestion({
  item,
  id,
  searchActive,
}: {
  item: GuideItem;
  id: string;
  searchActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (searchActive) setExpanded(true);
  }, [searchActive]);

  return (
    <article className="border-b border-[#dce5ea] last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left font-semibold text-[#102b3f]"
        >
          <span>{item.title}</span>
          <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dce5ea] text-sm text-[#0f6872]">{expanded ? "-" : "+"}</span>
        </button>
      </h3>
      <div id={id} hidden={!expanded}>
        <p className="pb-5 pr-10 text-sm leading-6 text-[#526a78]">{item.body}</p>
      </div>
    </article>
  );
}
