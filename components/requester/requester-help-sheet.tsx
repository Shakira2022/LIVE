"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleHelp,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";

type HelpCategory = "requests" | "using-live" | "account-safety";

type HelpArticle = {
  category: HelpCategory;
  title: string;
  body: string;
  icon: typeof CircleHelp;
};

const categories: { id: HelpCategory; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "using-live", label: "Using LIVE" },
  { id: "account-safety", label: "Account & safety" },
];

const articles: HelpArticle[] = [
  {
    category: "requests",
    title: "When should I use LIVE?",
    body: "LIVE lets you send incident details and a location to authorised response teams. Use it when you need to report an emergency through this service. If someone is in immediate danger, you cannot submit the form, or you are unsure that the request has reached dispatch, call your local emergency service directly. LIVE does not replace official emergency numbers and cannot guarantee that help has been contacted or dispatched.",
    icon: AlertTriangle,
  },
  {
    category: "requests",
    title: "How do I request help?",
    body: "1. Open Request help. 2. Choose the category that best matches the incident. 3. Check the map pin and address; allow location access if you want LIVE to use your device location, or enter the address/map location yourself. 4. Describe what happened and what help is needed. 5. Review the location and details, then submit. If the form cannot be submitted or the situation is immediately dangerous, contact local emergency services instead of waiting on the app.",
    icon: MapPin,
  },
  {
    category: "requests",
    title: "What should I include?",
    body: "Tell the team the exact place to go and how to enter, what happened, how many people need assistance, what danger is still present, and how they can call you back. Include relevant conditions, allergies, or medicines only when they matter to this incident. Use short, factual sentences; put the most urgent information first. Do not guess at facts or delay submitting to write a long explanation. You can answer follow-up questions from dispatch when they contact you.",
    icon: MessageCircle,
  },
  {
    category: "requests",
    title: "How do I check my request?",
    body: "Open Home to view your current request, or History to find a previous request. Select the request to see its latest status, updates, and any responder information available. Tracking is based on the latest information the system receives; a map, route, or estimated arrival may be missing or delayed. If the situation is urgent and you cannot confirm that dispatch has received the request, call your local emergency service.",
    icon: MapPin,
  },
  {
    category: "requests",
    title: "What does Submitted mean?",
    body: "LIVE has stored your request. Dispatch has not yet confirmed that it has been reviewed, so do not read Submitted as confirmation that a responder is on the way. If there is immediate danger or you need confirmation urgently, contact your local emergency service.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Received mean?",
    body: "Dispatch has confirmed the request and is reviewing it. This does not yet mean a responder has been assigned or has started travelling. Keep your phone available in case the team needs more information.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Assigned mean?",
    body: "A responder has been assigned to the request. Assignment alone does not mean the responder has started travelling. Check for the next status and any available responder details, and keep your phone available.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does En route mean?",
    body: "The responder has started travelling to the reported location. A route or estimated arrival may appear if current location and route data are available, but it can change or be unavailable. Keep your phone on and answer calls from the team.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Arrived mean?",
    body: "The responder has marked that they reached the location. If you cannot find them, use the available call or contact options and describe your exact position. If the danger is immediate and you cannot reach the responder, contact local emergency services.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Closed mean?",
    body: "The request has been marked complete and is no longer an active response. If the emergency is still happening or has started again, create a new request if possible and contact your local emergency service for urgent help.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Cancelled mean?",
    body: "The request was cancelled, so a responder should not be expected through this request. If you still need assistance, contact dispatch or submit a new request as appropriate; call local emergency services if the need is urgent.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "What does Rejected mean?",
    body: "The request was not accepted, so no responder is coming through it. Read any message shown with the status. If assistance is still needed, contact local emergency services directly and follow the instructions shown by LIVE or dispatch.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "Can I cancel a request?",
    body: "If no responder is assigned, the request is cancelled immediately. If a responder is assigned, your cancellation request needs dispatcher approval; wait until the status changes before assuming it has stopped. If assistance is still needed or the situation is urgent, contact local emergency services. Do not treat a cancellation request as complete until the request status says Cancelled.",
    icon: X,
  },
  {
    category: "requests",
    title: "What should I do while waiting?",
    body: "Keep the phone number on your profile available and answer calls or messages from the response team. If it is safe, make the location easier to find, explain entrances or landmarks, and mention hazards that responders should know before arrival. Tell dispatch if the number, location, number of people needing help, or danger changes. Do not put yourself at risk to meet a responder. Call local emergency services if the emergency escalates or you are not receiving the urgent help you need.",
    icon: MessageCircle,
  },
  {
    category: "requests",
    title: "Where is the Request help button?",
    body: "Choose Request help in the main navigation to open the emergency request form. On a phone, it is the prominent red help action in the bottom navigation. Use this when you need to submit a new incident; review the location and details before sending.",
    icon: MapPin,
  },
  {
    category: "requests",
    title: "How do I set or correct the location?",
    body: "On the Request help form, use the location control to try device location, then confirm the map pin and address before submitting. If permission is denied or the device location is inaccurate, enter or select the correct place manually. Add an entrance, landmark, or access note in the description when it will help responders find you.",
    icon: MapPin,
  },
  {
    category: "using-live",
    title: "What does the Home button do?",
    body: "Choose Home in the main navigation to return to your requester dashboard. It shows your current request and available progress information. Select a request or its tracking action to see more details.",
    icon: CircleHelp,
  },
  {
    category: "using-live",
    title: "Where do I find past requests?",
    body: "Choose History in the main navigation to find requests you previously submitted. Open a row to review its details and final status. Use this for past requests; for a current emergency, use Home or Request help.",
    icon: CircleHelp,
  },
  {
    category: "using-live",
    title: "Where do I find notifications?",
    body: "Choose Notifications in the main navigation to read updates about your requests. Open an item to review its message or related request. Notifications are useful for updates, but check the request itself for its latest status.",
    icon: CircleHelp,
  },
  {
    category: "account-safety",
    title: "Where do I update my profile?",
    body: "Open the account menu in the top corner and choose Profile to update your name, callback number, emergency contact, and optional medical details. Choose this when your contact details have changed so the response team can reach you.",
    icon: Settings2,
  },
  {
    category: "account-safety",
    title: "Where are my settings?",
    body: "Open the account menu and choose Settings to change appearance, language, voice guidance, and accessibility options. If text is difficult to read, adjust text size or spacing there; if audio is disruptive, adjust notification sound or volume.",
    icon: Settings2,
  },
  {
    category: "using-live",
    title: "How do I use Help and search?",
    body: "Open the account menu and choose Help to return to this guide. Use the search field below the topic tabs to find a word or question; while searching, results include every requester help topic. Clear the search to return to the selected topic.",
    icon: CircleHelp,
  },
  {
    category: "requests",
    title: "How do I call dispatch?",
    body: "When the call control is available for an active request, use it to contact dispatch through LIVE. If you cannot connect, need immediate emergency assistance, or are unsure that your request was received, call your local emergency service directly.",
    icon: MessageCircle,
  },
  {
    category: "requests",
    title: "Where is the cancel action and when can I use it?",
    body: "The cancel action is available from the current request. If no responder is assigned, it cancels immediately. If a responder is assigned, dispatch must approve the cancellation; the request is not cancelled until its status changes to Cancelled. If you still need help, contact local emergency services when the need is urgent.",
    icon: X,
  },
  {
    category: "account-safety",
    title: "How do I update my details?",
    body: "Open the account menu and choose Profile. Review your name and callback phone, then update your emergency contact and optional conditions, allergies, or medications if they are useful to responders. Save the changes and check that the displayed details are correct. Email cannot be changed in this profile editor. Keep details accurate; responders may use them to contact you or support your request.",
    icon: Settings2,
  },
  {
    category: "account-safety",
    title: "How do I change or reset my password?",
    body: "If you can sign in, open Profile, choose Change password, request the one-time code sent to your account email, and enter that code before setting a new password. If you cannot sign in, choose Forgot password on the sign-in page and follow the reset link sent to your email. Use a password that you do not reuse elsewhere. LIVE staff should not ask you to tell them your password or verification code; never share either in a request or chat.",
    icon: LockKeyhole,
  },
  {
    category: "account-safety",
    title: "What can I change in Settings?",
    body: "Open Settings from the account menu. System settings let you choose light or dark appearance and your interface language. Request settings include voice navigation and guidance preferences. Accessibility controls include brightness, text size, expanded text spacing, reduced motion, and notification sound and volume. Change one option at a time and check that the display and guidance work for you. Voice and speech features depend on browser permissions and device support.",
    icon: Settings2,
  },
  {
    category: "account-safety",
    title: "What are LIVE's limits?",
    body: "LIVE is a way to share request information with authorised response teams. A Submitted status only confirms the request was stored; it does not confirm dispatch reviewed it. Even later statuses cannot guarantee a particular arrival time or outcome. LIVE is not an emergency number, a guarantee that emergency services were contacted, or medical care. For immediate danger or urgent medical assistance, call your local emergency service.",
    icon: ShieldCheck,
  },
  {
    category: "account-safety",
    title: "What should I avoid sharing?",
    body: "Do not enter guessed or false information, and do not put passwords or verification codes in a request. Share only accurate details relevant to getting help; avoid adding unrelated private information. Request, contact, location, emergency-contact, and optional medical details may be used to support the request and shared with authorised response teams. Read Terms and Conditions for the full wording on how LIVE handles this information.",
    icon: LockKeyhole,
  },
  {
    category: "account-safety",
    title: "Can LIVE AI give medical advice?",
    body: "LIVE AI can explain LIVE features and help you think through what request information to provide. It can make mistakes, does not contact emergency services for you, and is not a medical professional or substitute for care. Do not follow AI advice if it conflicts with instructions from emergency responders or health professionals. For urgent help, contact local emergency or health services directly.",
    icon: AlertTriangle,
  },
];

export function RequesterHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState<HelpCategory>("requests");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleArticles = useMemo(
    () => articles.filter((article) => {
      const matchesSearch = !normalizedQuery
        || `${article.title} ${article.body}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesSearch && (normalizedQuery.length > 0 || article.category === category);
    }),
    [category, normalizedQuery],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Requester help"
      description="Guidance for requests, your account, and staying safe."
      side="right"
      className="!h-dvh !max-h-dvh !w-full !max-w-none md:!w-1/2 rounded-none bg-[#f6f8fb]"
      scrollAreaClassName="bg-[#f6f8fb]"
    >
      <div className="sticky top-0 z-30 shrink-0 border-b border-[#e2e8ed] bg-white">
        <nav className="grid grid-cols-3 px-2" aria-label="Requester help topics">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { setCategory(item.id); setQuery(""); }}
              aria-current={category === item.id && !normalizedQuery ? "page" : undefined}
              className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition ${category === item.id && !normalizedQuery ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492] hover:text-[#102b3f]"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 sm:px-6">
          <label htmlFor="requester-help-search" className="sr-only">Search requester help</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71838f]" />
            <input
              id="requester-help-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help topics"
              className="h-11 w-full rounded-full border border-[#d6e1e6] bg-[#f8fafb] pl-10 pr-10 text-sm text-[#102b3f] outline-none placeholder:text-[#81909a] focus:border-[#0f6872] focus:bg-white"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear help search"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#667b89] hover:bg-[#eaf0f3]"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {normalizedQuery ? <p className="mt-2 px-2 text-[11px] text-[#71838f]">Search results across all requester topics</p> : null}
        </div>
      </div>

      {visibleArticles.length ? (
        <div className="divide-y divide-[#dce5ea] px-5 md:px-6">
          {visibleArticles.map((article, index) => (
            <HelpQuestion key={article.title} article={article} id={`requester-help-answer-${index}`} searchActive={Boolean(normalizedQuery)} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-10 text-center md:px-6">
          <CircleHelp aria-hidden="true" className="mx-auto h-7 w-7 text-[#81909a]" />
          <p className="mt-3 font-semibold text-[#102b3f]">No matching help topics</p>
          <p className="mt-1 text-sm text-[#667b89]">Try another word or clear your search.</p>
        </div>
      )}
    </Sheet>
  );
}

function HelpQuestion({
  article,
  id,
  searchActive,
}: {
  article: HelpArticle;
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
          <span>{article.title}</span>
          <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dce5ea] text-sm text-[#0f6872]">
            {expanded ? "-" : "+"}
          </span>
        </button>
      </h3>
      <div id={id} hidden={!expanded}>
        <p className="pb-5 pr-10 text-sm leading-6 text-[#526a78]">{article.body}</p>
      </div>
    </article>
  );
}
