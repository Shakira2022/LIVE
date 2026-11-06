/**
 * LIVE ASSISTANT KNOWLEDGE BASE   (Backend - AI chatbot logic)
 *
 * The chatbot answers "how do I use LIVE?" questions from this curated,
 * role-aware knowledge base FIRST. An AI model is only consulted when no topic
 * matches, and even then it is given these topics as its only source of truth.
 *
 * Why knowledge-base first:
 *   - Answers about the app are always correct and instant, with or without an
 *     AI provider configured.
 *   - Emergency guidance never depends on a small language model behaving.
 *
 * Shared by app/api/assistant/chat/route.ts (server). Contains no secrets and
 * no personal data, so it is also safe to unit-test in isolation.
 */

export type AssistantRole =
  | "guest"
  | "requester"
  | "dispatcher"
  | "responder"
  | "admin"
  | "auditor"
  | "manager"
  | "support";

export interface AssistantAction {
  label: string;
  href: string;
}

/** Shape returned by POST /api/assistant/chat (inside the { ok, data } envelope). */
export interface AssistantReply {
  reply: string;
  quickReplies: string[];
  actions: AssistantAction[];
  source: "safety-rules" | "knowledge-base" | "ai" | "fallback";
  urgent: boolean;
}

/** Shape returned by GET /api/assistant/chat. */
export interface AssistantWelcome {
  role: AssistantRole;
  greeting: string;
  suggestions: string[];
  aiConfigured: boolean;
}

export interface KnowledgeTopic {
  id: string;
  /** Roles that may receive this topic. "all" = every role, guests included. */
  roles: AssistantRole[] | "all";
  /** Words or short phrases that signal the topic. Phrases score higher. */
  keywords: string[];
  title: string;
  answer: string;
  followUps?: string[];
  actions?: AssistantAction[];
}

/* -------------------------------------------------------------------------- */
/* Emergency detection - deterministic, never sent to an AI model             */
/* -------------------------------------------------------------------------- */

const URGENT_PATTERNS: RegExp[] = [
  /\b(not breathing|stopped breathing|can'?t breathe|cannot breathe|choking)\b/i,
  /\b(unconscious|unresponsive|collapsed|passed out|fainted)\b/i,
  /\b(heart attack|cardiac|chest pain|stroke|seizure|fitting)\b/i,
  /\b(heavy|severe|lots of) bleeding\b|\bbleeding (badly|heavily|a lot)\b/i,
  /\b(fire|burning|smoke|explosion|gas leak)\b.*\b(now|house|building|car|trapped|inside)\b/i,
  /\b(trapped|drowning|overdose|poisoned|suicid|kill myself|want to die)\b/i,
  /\b(being attacked|attacking me|break[- ]?in|intruder|hijack|gun|knife|stabbed|shot|rape|assault(ed)?)\b/i,
  /\b(help me now|need help now|urgent help|send help|this is an emergency|it'?s an emergency|there'?s an emergency)\b/i,
];

const GENERIC_KEYWORD_WORDS = new Set([
  "what", "when", "where", "which", "who", "why", "how", "does", "do", "did",
  "can", "could", "will", "would", "should", "the", "and", "for", "from", "with",
  "about", "this", "that", "these", "those", "your", "you", "my", "our", "their",
  "are", "is", "was", "were", "been", "being", "have", "has", "had", "please",
  "tell", "give", "get", "need", "want", "mean", "means", "into", "onto", "there",
]);

export function isUrgentMessage(message: string): boolean {
  return URGENT_PATTERNS.some((pattern) => pattern.test(message));
}

export const SA_EMERGENCY_NUMBERS = [
  { label: "Ambulance & fire", number: "10177" },
  { label: "Police (SAPS)", number: "10111" },
  { label: "Any emergency from a mobile", number: "112" },
] as const;

export function urgentReply(role: AssistantRole): {
  reply: string;
  actions: AssistantAction[];
  quickReplies: string[];
} {
  const lines = [
    "**This sounds like an emergency. Get help now.**",
    "",
    "1. If anyone is in immediate danger, call **10177** (ambulance and fire) or **10111** (police). From a mobile phone you can also dial **112**.",
    "2. Move away from danger if it is safe to do so. Do not put yourself at risk.",
  ];

  if (role === "requester") {
    lines.push("3. Send a LIVE request so a responder can see your exact location: tap **Request help**, choose the service, and allow location access.");
  } else if (role === "guest") {
    lines.push("3. If you have a LIVE account, sign in and tap **Request help** so a responder can see your exact location.");
  } else {
    lines.push("3. Your account is a staff account. Use the phone numbers above, or ask the person to raise a LIVE request from their own phone.");
  }

  lines.push("", "I can guide you while you wait, but I cannot replace emergency responders.");

  const actions: AssistantAction[] =
    role === "requester"
      ? [{ label: "Request help now", href: "/app/requester/new" }]
      : role === "guest"
        ? [{ label: "Sign in", href: "/login" }]
        : [];

  return {
    reply: lines.join("\n"),
    actions,
    quickReplies: ["How do I do CPR?", "How do I stop bleeding?", "What should I do while I wait?"],
  };
}

/* -------------------------------------------------------------------------- */
/* Topics                                                                      */
/* -------------------------------------------------------------------------- */

export const KNOWLEDGE_BASE: KnowledgeTopic[] = [
  /* ---------------------------- Everyone --------------------------------- */
  {
    id: "assistant.about",
    roles: "all",
    keywords: ["what can you do", "who are you", "what are you", "help me use", "assistant", "chatbot", "how does this work"],
    title: "What the LIVE assistant can do",
    answer:
      "I'm the LIVE assistant. I can:\n- explain how to use each screen for your role\n- tell you what a request status means\n- help with sign-in, location and voice input problems\n- give basic safety guidance while you wait for help\n\nTap a suggestion below, type a question, or press the microphone and speak.",
    followUps: ["How do I request help?", "What do the statuses mean?", "How do I use voice input?"],
  },
  {
    id: "safety.numbers",
    roles: "all",
    keywords: ["emergency number", "emergency phone", "ambulance number", "police number", "call ambulance", "call police", "10177", "10111", "112", "who do i call", "hotline"],
    title: "Emergency phone numbers (South Africa)",
    answer:
      "Emergency numbers in South Africa:\n- **10177** ambulance and fire\n- **10111** police (SAPS)\n- **112** any emergency from a mobile phone\n\nIf someone's life is in danger, call first, then use LIVE so responders can see your location.",
    followUps: ["How do I request help?", "What should I do while I wait?"],
  },
  {
    id: "voice.input",
    roles: "all",
    keywords: ["voice", "speak", "talk instead", "dictate", "speech", "voice to text", "can't type", "use the microphone", "using the microphone", "how do i use the microphone"],
    title: "Using voice input",
    answer:
      "Look for the **microphone button** next to text boxes (request description, notes and this chat).\n1. Tap the microphone. Your browser will ask for microphone permission the first time; choose **Allow**.\n2. Speak clearly. Your words appear in the box as you talk.\n3. Tap the microphone again (or stop talking) to finish.\n4. **Check and edit the text** before you send it.\n\nVoice input works in Chrome, Edge and Safari. If the button is greyed out, your browser does not support it; you can still type or use the quick phrase buttons.",
    followUps: ["The microphone isn't working", "How do I request help?"],
  },
  {
    id: "voice.trouble",
    roles: "all",
    keywords: ["microphone isn't working", "mic not working", "microphone not working", "voice not working", "mic doesn't work", "microphone doesn't work", "voice doesn't work", "mic broken", "mic problem", "permission denied", "mic blocked", "microphone blocked", "mic is blocked", "microphone is blocked", "microphone permission blocked", "voice blocked"],
    title: "Voice input is not working",
    answer:
      "Try these steps:\n1. Check that your browser allowed the microphone: click the lock icon next to the web address and set **Microphone** to **Allow**, then reload the page.\n2. Make sure no other app (for example a call) is using the microphone.\n3. Use Chrome or Edge on a computer, or Chrome/Safari on a phone.\n4. Voice recognition needs an internet connection.\n\nYou can always type, or use the quick phrase buttons to add common details with one tap.",
    followUps: ["How do I use voice input?"],
  },
  {
    id: "account.register",
    roles: ["guest", "requester"],
    keywords: ["register", "sign up", "create account", "new account", "make an account", "verification email", "verify email", "verify my email", "email service"],
    title: "Creating an account",
    answer:
      "1. Open **Register** and fill in your name, email, phone number and a password (at least 10 characters with upper case, lower case and a number).\n2. LIVE emails you a **verification link**. Open it to activate the account. Check your spam folder if it doesn't arrive.\n3. Return to **Sign in** and log in.\n\nIf registration says the **email service is not configured**, the server's email settings are missing. An administrator needs to set them; it is not a problem with your email address.",
    followUps: ["I forgot my password", "How do I request help?"],
    actions: [{ label: "Go to registration", href: "/register" }],
  },
  {
    id: "account.signin",
    roles: "all",
    keywords: ["sign in", "log in", "login", "can't log in", "cannot log in", "locked", "not active", "password incorrect", "forgot password", "reset password", "forgot my password"],
    title: "Signing in and passwords",
    answer:
      "- Sign in with your **email or phone number** and password.\n- Forgot it? Use **Forgot password** on the sign-in page to get a reset link by email.\n- \"This account is not active\" usually means the email has not been verified yet. Open the verification link first.\n- After several wrong passwords the account is locked for safety. Wait 15 minutes, and if it is still locked, ask an administrator to reactivate it.",
    followUps: ["How do I create an account?"],
    actions: [{ label: "Forgot password", href: "/forgot-password" }],
  },
  {
    id: "privacy",
    roles: "all",
    keywords: ["privacy", "my data", "who can see", "location shared", "personal information", "popia", "data protection"],
    title: "Privacy and your information",
    answer:
      "- Your location is shared only with the dispatchers and responders handling your request.\n- Requesters can only ever see their own requests.\n- Every action is recorded in an audit trail so it can be reviewed. Passwords are stored encrypted (hashed), never in plain text.\n- Personal details such as phone numbers are masked in system logs.",
    followUps: ["How do I request help?"],
  },
  {
    id: "status.meanings",
    roles: "all",
    keywords: ["status meaning", "status meanings", "what do the statuses mean", "what does the status mean", "meaning of status", "what does submitted mean", "what does received mean", "what does assigned mean", "what does en route mean", "what does arrived mean", "what does closed mean", "what does cancelled mean", "what does rejected mean", "what does it mean", "status of my request", "my request status"],
    title: "What request statuses mean",
    answer:
      "- **Submitted**: the request is stored; dispatch has not confirmed it yet.\n- **Received**: dispatch confirmed the request and is reviewing it.\n- **Assigned**: a responder has been assigned.\n- **En route**: the responder is travelling to the location.\n- **Arrived**: the responder reached the location.\n- **Closed**: the request is complete and closed.\n- **Cancelled**: the request was cancelled; no responder is coming.\n- **Rejected**: the request was not accepted. Contact the relevant emergency service directly if help is still needed.\n\nA status update does not guarantee an arrival time. If anyone is in immediate danger, call **10177**, **10111**, or **112**.",
    followUps: ["How do I track my request?", "Can I cancel a request?"],
  },
  {
    id: "safety.waiting",
    roles: "all",
    keywords: ["while i wait", "what should i do", "waiting", "how long", "stay safe", "until help arrives"],
    title: "While you wait for help",
    answer:
      "Keep your phone nearby and reachable, share important changes with dispatch, and follow instructions from dispatchers or responders. Stay somewhere safe if possible. If the situation worsens or anyone is in immediate danger, call **10177** / **10111** / **112** directly. LIVE cannot promise an arrival time; check the request status and tracking page for updates.",
    followUps: ["How do I do CPR?", "How do I stop bleeding?"],
  },
  {
    id: "safety.cpr",
    roles: "all",
    keywords: ["cpr", "chest compressions", "resuscitate", "not breathing"],
    title: "Hands-only CPR",
    answer:
      "**Call 10177 or 112 first and put the phone on speaker.**\n1. Check if the person responds and is breathing normally.\n2. If not, lay them on their back on a firm, flat surface.\n3. Put the heel of your hand in the centre of the chest, other hand on top.\n4. Push hard and fast: about 5 cm deep, **100 to 120 pushes a minute**. Let the chest rise fully between pushes.\n5. Keep going until help takes over or the person starts breathing.\n\nIf you are trained and willing, give 2 rescue breaths after every 30 pushes.",
    followUps: ["What should I do while I wait?"],
  },
  {
    id: "safety.bleeding",
    roles: "all",
    keywords: ["bleeding", "blood", "cut", "wound", "stop bleeding"],
    title: "Controlling bleeding",
    answer:
      "1. If it is safe, press firmly on the wound with a clean cloth or clothing.\n2. Keep steady pressure. Add more cloth on top if blood soaks through; don't lift it to check.\n3. Do not remove anything stuck in the wound; press around it instead.\n4. Keep the person still and warm, and tell the responder about the bleeding.\n\nFor heavy bleeding call **10177** or **112** immediately.",
    followUps: ["What should I do while I wait?"],
  },

  /* ----------------------------- Requester -------------------------------- */
  {
    id: "requester.request",
    roles: ["requester", "guest"],
    keywords: ["request help", "report emergency", "send request", "new request", "ask for help", "how do i request", "make a request", "get help", "raise a request", "ask assistance", "request assistance", "submit emergency request", "create emergency request"],
    title: "Requesting help",
    answer:
      "1. On **Home**, choose **Request help**.\n2. Choose **Medical**, **Police**, or **Fire**, then select the emergency type and priority (**Critical**, **High**, or **Moderate**).\n3. Describe what happened using a quick phrase, the microphone, or text.\n4. Confirm your device location or enter an address, and answer any optional emergency questions.\n5. Review the details and tap **Submit**.\n\nAfter submitting, open the request from **Home** to check its status and any available tracking. If you already have an active request, open that request instead of submitting a duplicate. If anyone is in immediate danger, call **10177**, **10111**, or **112** now.",
    followUps: ["What do the statuses mean?", "My location isn't working", "How do I use voice input?"],
    actions: [{ label: "Request help", href: "/app/requester/new" }],
  },
  {
    id: "requester.share-details",
    roles: ["requester", "guest"],
    keywords: ["what details should i share", "what information should i provide", "details for responders", "information for dispatch", "what should i tell dispatch", "what to tell the response team", "information response team", "information for responders", "details to give dispatch", "share with responders", "details response team", "what should responders know", "anything responders need to know"],
    title: "What information to share with responders",
    answer:
      "Share the exact location and access instructions, what happened, how many people need help, any immediate hazards, and a callback number. For a medical emergency, include relevant symptoms or known medical details if you can. Keep it concise and do not share unrelated sensitive information.",
    followUps: ["What should I do while I wait?", "How do I track my request?"],
  },
  {
    id: "requester.location",
    roles: ["requester", "guest"],
    keywords: ["location", "gps", "can't find me", "wrong location", "location not working", "allow location", "where am i", "accuracy"],
    title: "Location problems",
    answer:
      "1. When asked, choose **Allow** for location access.\n2. If you blocked it before: click the lock icon next to the web address, set **Location** to **Allow**, and reload.\n3. On a phone, turn on **Location / GPS** in your phone settings.\n4. Step outside or near a window for a more accurate fix; the accuracy circle on the map shows how precise it is.\n\nIf location still fails, call **10177** / **10111** / **112** and tell them your address.",
    followUps: ["How do I request help?"],
  },
  {
    id: "requester.track",
    roles: ["requester"],
    keywords: ["track", "where is the responder", "where is the ambulance", "where is help", "follow my request", "how far", "how long until", "eta", "live map", "my request", "ambulance coming"],
    title: "Tracking your request",
    answer:
      "Open your active request at the top of **Home** to see its status and timeline. When live responder data is available, the map can show the responder and route, and an estimated arrival time may appear. The page refreshes automatically. LIVE AI cannot verify a responder's location or promise an arrival time; use the tracking screen for the latest available update.",
    followUps: ["What do the statuses mean?", "Can I cancel a request?"],
    actions: [{ label: "Open home", href: "/app/requester" }],
  },
  {
    id: "requester.cancel",
    roles: ["requester"],
    keywords: ["cancel", "cancel request", "made a mistake", "don't need help", "no longer need", "false alarm"],
    title: "Cancelling a request",
    answer:
      "Open the active request and use its **Cancel** control if you no longer need help. If a responder has already been assigned, LIVE sends a cancellation request for dispatcher approval; wait for the status to update before assuming it is cancelled. Only cancel if you are sure help is no longer needed. If you still need urgent help, call **10177**, **10111**, or **112**.",
    followUps: ["What do the statuses mean?"],
  },
  {
    id: "requester.history",
    roles: ["requester"],
    keywords: ["history", "past requests", "previous requests", "old requests"],
    title: "Request history",
    answer: "Open **History** to see all your past requests, their reference numbers, final status and timeline.",
    actions: [{ label: "Open history", href: "/app/requester/history" }],
  },
  {
    id: "requester.notifications",
    roles: ["requester"],
    keywords: ["notification", "notifications", "alerts", "messages", "updates", "why did i get an update", "why did i get a notification", "new request update"],
    title: "Notifications",
    answer: "**Notifications** (Alerts on mobile) lists every update about your requests, such as when a responder is assigned or arrives. A red badge shows unread messages; tap one to mark it as read.",
    actions: [{ label: "Open notifications", href: "/app/requester/notifications" }],
  },
  {
    id: "requester.profile",
    roles: ["requester"],
    keywords: ["profile", "emergency contact", "change my phone", "change phone number", "update my phone", "update details", "settings"],
    title: "Profile and settings",
    answer: "Open **Profile** or **Settings** to update your contact number and emergency contact, and to set your preferences. Keep your phone number current; it is used as your callback number on every request.",
    actions: [{ label: "Open settings", href: "/app/requester/settings" }],
  },

  /* ----------------------------- Dispatcher ------------------------------- */
  {
    id: "dispatcher.queue",
    roles: ["dispatcher", "admin"],
    keywords: ["queue", "new requests", "request queue", "live operations", "incoming", "triage", "unrouted"],
    title: "Working the request queue",
    answer:
      "- **Live operations** shows open requests on the map.\n- **Request queue** lists requests for your organisation plus any **unrouted** ones (no nearby organisation was found), so nothing is missed.\n- Open a request, mark it **Received** to confirm it, then assign a responder or team.",
    followUps: ["How do I assign a responder?", "How do I reject or reroute a request?"],
    actions: [{ label: "Open request queue", href: "/app/dispatcher/requests" }],
  },
  {
    id: "dispatcher.assign",
    roles: ["dispatcher", "admin"],
    keywords: ["assign", "assign responder", "assign team", "dispatch", "send responder"],
    title: "Assigning a responder",
    answer:
      "1. Open the request and tap **Assign**.\n2. Choose a **responder** or a **team**. Only online responders without an active mission can be assigned.\n3. Confirm. The requester is notified and the status moves to **Assigned**.",
    followUps: ["How do I add a note?"],
  },
  {
    id: "dispatcher.reject",
    roles: ["dispatcher", "admin"],
    keywords: ["reject", "reroute", "wrong organisation", "transfer", "duplicate"],
    title: "Rejecting or rerouting",
    answer:
      "Open the request and choose **Reject** or **Reroute**. Pick a **preset reason** with one tap (for example *Duplicate request* or *Closer organisation available*) or dictate one with the microphone. The reason is saved to the request history and audit log.",
  },
  {
    id: "dispatcher.notes",
    roles: ["dispatcher", "admin", "responder"],
    keywords: ["note", "notes", "operational note", "add note"],
    title: "Operational notes",
    answer: "On the request screen tap **Add note**. Use the **quick phrase** buttons for common updates (for example *Requester contacted by phone*) or the microphone, then save. Notes are visible to staff on the request.",
  },

  /* ----------------------------- Responder -------------------------------- */
  {
    id: "responder.mission",
    roles: ["responder"],
    keywords: ["mission", "my job", "assignment", "acknowledge", "en route", "arrived", "complete", "finish mission", "navigate", "directions"],
    title: "Handling a mission",
    answer:
      "1. Go **online** so dispatch can assign you.\n2. When a mission arrives, tap **Acknowledge**.\n3. Tap **Start route** (en route); use the directions link to open your maps app.\n4. Tap **Arrived** when you reach the scene.\n5. Tap **Complete** when you are done.\n\nYou can call the requester or dispatcher from the mission screen.",
    followUps: ["How do I go online or offline?"],
    actions: [{ label: "Open mission", href: "/app/responder" }],
  },
  {
    id: "responder.availability",
    roles: ["responder"],
    keywords: ["online", "offline", "availability", "available", "start shift", "end shift", "go offline"],
    title: "Going online or offline",
    answer: "Use the availability switch on the **Mission** screen. You must be **online** to receive missions. You cannot go offline while you have an active mission; complete or hand it over first.",
  },

  /* ------------------------------- Admin ---------------------------------- */
  {
    id: "admin.dashboard",
    roles: ["admin"],
    keywords: ["dashboard", "analytics", "charts", "statistics", "stats", "report", "trends", "overview"],
    title: "The admin dashboard",
    answer:
      "**Overview** shows the analytics dashboard:\n- summary cards (total, pending, active, completed requests, average response time)\n- a line graph of requests submitted vs closed over time\n- bar charts by emergency type, priority and status\n- donut charts for request outcomes and responder availability\n- tables of the busiest organisations and the latest requests\n\nUse the **7 / 30 / 90 days** buttons to change the period. Every chart has a **table view** for exact numbers.",
    actions: [{ label: "Open overview", href: "/app/admin" }],
  },
  {
    id: "manager.insights",
    roles: ["manager"],
    keywords: ["manager dashboard", "management insights", "incident analytics", "incident trends", "area performance", "operational insights"],
    title: "Management insights",
    answer: "Open **Overview** for service-wide performance charts, or **Incidents** to filter incident records by date and operating area. **Security** shows security events for review. Management pages are read-only; operational changes belong to dispatch or administration.",
    actions: [{ label: "Open management overview", href: "/app/manager" }],
  },
  {
    id: "admin.users",
    roles: ["admin"],
    keywords: ["user", "users", "suspend", "activate", "unlock", "deactivate", "manage users"],
    title: "Managing users",
    answer: "Open **Users** to search accounts and change their status (activate, suspend, unlock). Every change is written to the audit log.",
    actions: [{ label: "Open users", href: "/app/admin/users" }],
  },
  {
    id: "admin.organisations",
    roles: ["admin"],
    keywords: ["organisation", "organisations", "hospital", "orgs", "service area"],
    title: "Managing organisations",
    answer: "Open **Organisations** to add or update hospitals and response services, including their coordinates. Requests are routed automatically to the nearest **active** organisation that has coordinates.",
    actions: [{ label: "Open organisations", href: "/app/admin/organisations" }],
  },
  {
    id: "admin.audit",
    roles: ["admin", "auditor"],
    keywords: ["audit", "audit log", "security log", "logs", "who did what"],
    title: "Audit and security logs",
    answer: "Every meaningful action is recorded: **audit** logs (business actions), **security** logs (sign-ins, denied access), **application** logs and **integration** logs (outside services such as email and the AI assistant). Admins use **Audit**; auditors have a page for each log type.",
  },

  /* ------------------------------ Auditor --------------------------------- */
  {
    id: "auditor.review",
    roles: ["auditor"],
    keywords: ["incident", "incidents", "review", "read only", "investigate"],
    title: "Reviewing incidents",
    answer: "The auditor workspace is **read-only**. Open **Incidents** to review requests and their full timelines, and the log pages to see who did what and when. Nothing can be changed from this role.",
  },
];

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function topicAllowed(topic: KnowledgeTopic, role: AssistantRole): boolean {
  return topic.roles === "all" || topic.roles.includes(role);
}

export interface TopicMatch {
  topic: KnowledgeTopic;
  score: number;
}

/**
 * Scores each topic by keyword hits. Multi-word phrases count more than
 * single words so "request help" beats a stray "help".
 */
export function matchTopic(message: string, role: AssistantRole): TopicMatch | null {
  const text = normalise(message);
  const words = text.trim().split(" ");
  // Word-prefix test: "number" matches "numbers", "verify" matches "verifying".
  const hasWord = (word: string) => words.some((w) => w.startsWith(word));
  let best: TopicMatch | null = null;

  for (const topic of KNOWLEDGE_BASE) {
    if (!topicAllowed(topic, role)) continue;
    let score = 0;
    for (const keyword of topic.keywords) {
      const key = normalise(keyword).trim();
      const parts = key.split(" ");
      if (text.includes(` ${key}`)) {
        // Exact phrase (or single word) - strongest signal.
        score += parts.length > 1 ? 3 : 2;
      } else {
        // All the meaningful words present, in any order ("create an account").
        // More matched words = more specific = higher score.
        const meaningful = parts.filter((part) => part.length > 2 && !GENERIC_KEYWORD_WORDS.has(part));
        if (meaningful.length >= 2 && meaningful.every(hasWord)) score += meaningful.length;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { topic, score };
    }
  }

  return best && best.score >= 2 ? best : null;
}

/**
 * Follow-up questions for a topic, keeping only the ones this role can
 * actually get an answer to (e.g. staff are not offered "track my request").
 */
export function answerableFollowUps(topic: KnowledgeTopic, role: AssistantRole): string[] {
  const usable = (topic.followUps ?? []).filter((q) => isUrgentMessage(q) || matchTopic(q, role) !== null);
  return usable.length ? usable : suggestionsFor(role).slice(0, 3);
}

/** Suggested opening questions, shown as quick replies when the chat opens. */
export function suggestionsFor(role: AssistantRole): string[] {
  switch (role) {
    case "requester":
      return ["How do I request help?", "How do I track my request?", "What do the statuses mean?", "How do I use voice input?", "Emergency phone numbers"];
    case "dispatcher":
      return ["How do I assign a responder?", "How do I reject or reroute a request?", "What does unrouted mean?", "How do I add a note?"];
    case "responder":
      return ["How do I handle a mission?", "How do I go online or offline?", "How do I add a note?", "How do I do CPR?"];
    case "admin":
      return ["Explain the dashboard", "How do I manage users?", "How do I add an organisation?", "What logs are recorded?"];
    case "manager":
      return ["How do I view incident trends?", "How do I filter incidents by area?", "Can I change incident records?"];
    case "auditor":
      return ["How do I review incidents?", "What logs are recorded?", "What do the statuses mean?"];
    case "guest":
      return ["How do I create an account?", "I can't sign in", "Emergency phone numbers", "What can you do?"];
    default:
      return ["What can you do?", "What do the statuses mean?"];
  }
}

export function greetingFor(role: AssistantRole, firstName?: string | null): string {
  const name = firstName ? `, ${firstName}` : "";
  const lead = `Hi${name}! I'm the LIVE assistant.`;
  const safety = "If someone is in danger right now, call **10177** or **112** first.";
  switch (role) {
    case "requester":
      return `${lead} I can help you request help, track a responder, or understand an update. ${safety}`;
    case "guest":
      return `${lead} I can help you create an account or sign in. ${safety}`;
    case "dispatcher":
      return `${lead} Ask me about the queue, assigning responders or rerouting requests.`;
    case "responder":
      return `${lead} Ask me about missions, availability or first-aid steps.`;
    case "admin":
      return `${lead} Ask me about the dashboard, users, organisations or logs.`;
    case "manager":
      return `${lead} Ask me about management insights, incident trends or operating areas.`;
    case "auditor":
      return `${lead} Ask me about incidents or any of the log types.`;
    default:
      return `${lead} How can I help?`;
  }
}

/**
 * A compact, role-filtered copy of the knowledge base for the AI prompt, so
 * the model answers from LIVE's real behaviour instead of guessing.
 */
export function knowledgeDigest(role: AssistantRole, maxChars = 3500): string {
  const parts: string[] = [];
  let used = 0;
  for (const topic of KNOWLEDGE_BASE) {
    if (!topicAllowed(topic, role)) continue;
    const entry = `## ${topic.title}\n${topic.answer.replace(/\*\*/g, "")}`;
    if (used + entry.length > maxChars) break;
    parts.push(entry);
    used += entry.length;
  }
  return parts.join("\n\n");
}
