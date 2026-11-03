
import { z } from "zod";
import { createHandler } from "@/lib/middleware/api/handler";
import { listRequests } from "@/lib/middleware/server/requests-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(600),
  pathname: z.string().max(300).optional(),
});

const ROLE_SUGGESTIONS: Record<string, string[]> = {
  requester: [
    "How do I submit a request?",
    "Check my request status",
    "Help me navigate the website",
    "How do I reset my password?",
  ],
  dispatcher: [
    "Show latest requests",
    "How do I assign a responder?",
    "Help me navigate the website",
    "How do I reset my password?",
  ],
  responder: [
    "Show my assigned requests",
    "Help me navigate the website",
    "How do I reset my password?",
  ],
  admin: [
    "How do I manage users?",
    "Where is the audit log?",
    "Show latest requests",
    "Help me navigate the website",
  ],
  auditor: [
    "Where is the audit log?",
    "Show latest requests",
    "Help me navigate the website",
    "How do I reset my password?",
  ],
};

function suggestionsFor(role?: string): string[] {
  return (role && ROLE_SUGGESTIONS[role]) || [
    "How do I submit a request?",
    "Help me navigate the website",
    "How do I reset my password?",
  ];
}
type Link = { label: string; href: string };
type Reply = { answer: string; suggestions?: string[]; links?: Link[] };


const ROLE_PAGES: Record<string, [string, string, string][]> = {
  requester: [
    ["/app/requester", "Dashboard", "see your overview and active requests"],
    ["/app/requester/new", "New Request", "report a new emergency"],
    ["/app/requester/history", "History", "look back at your past requests"],
    ["/app/requester/notifications", "Notifications", "read updates about your requests"],
    ["/app/requester/profile", "Profile", "manage your personal details"],
    ["/app/requester/settings", "Settings", "change your preferences"],
  ],
  dispatcher: [
    ["/app/dispatcher", "Dashboard", "see your overview"],
    ["/app/dispatcher/requests", "Requests", "review incoming requests and assign responders"],
    ["/app/dispatcher/resources", "Resources", "see available responders and resources"],
    ["/app/dispatcher/activity", "Activity", "follow recent dispatch activity"],
    ["/app/dispatcher/profile", "Profile", "manage your personal details"],
  ],
  responder: [
    ["/app/responder", "Dashboard", "see the requests assigned to you"],
    ["/app/responder/history", "History", "look back at your completed work"],
    ["/app/responder/profile", "Profile", "manage your personal details"],
  ],
  admin: [
    ["/app/admin", "Dashboard", "see the system overview"],
    ["/app/admin/users", "Users", "manage user accounts"],
    ["/app/admin/organisations", "Organisations", "manage organisations"],
    ["/app/admin/audit", "Audit", "review audit records"],
    ["/app/admin/settings", "Settings", "change system settings"],
    ["/app/admin/profile", "Profile", "manage your personal details"],
  ],
  auditor: [
    ["/app/auditor", "Dashboard", "see the audit overview"],
    ["/app/auditor/incidents", "Incidents", "review incident records"],
    ["/app/auditor/audit", "Audit", "review audit logs"],
    ["/app/auditor/application", "Application", "review the application"],
    ["/app/auditor/integration", "Integration", "review integrations"],
    ["/app/auditor/security", "Security", "review security information"],
    ["/app/auditor/profile", "Profile", "manage your personal details"],
  ],
};

const PUBLIC_PAGES: Record<string, string> = {
  "/": "Home",
  "/login": "Login",
  "/register": "Register",
  "/forgot-password": "Forgot Password",
  "/reset-password": "Reset Password",
  "/verify-email": "Verify Email",
  "/terms-and-conditions": "Terms and Conditions",
};

function currentPageName(pathname: string): string | null {
  for (const [role, pages] of Object.entries(ROLE_PAGES)) {
    const hit = pages.find(([href]) => href === pathname);
    if (hit) {
      const roleName = role.charAt(0).toUpperCase() + role.slice(1);
      return hit[1] === "Dashboard" ? `${roleName} Dashboard` : `${hit[1]} page`;
    }
  }
  if (pathname.startsWith("/app/requester/track/")) return "Track Request page";
  if (pathname.startsWith("/app/dispatcher/requests/")) return "Request Details page";
  return PUBLIC_PAGES[pathname] ? `${PUBLIC_PAGES[pathname]} page` : null;
}

function localAnswer(message: string, pathname = "/", role?: string): Reply {
  const text = message.toLowerCase().trim();
  const has = (re: RegExp) => re.test(text);
  const MAIN_SUGGESTIONS = suggestionsFor(role);

  if (has(/\bthank(s| you)\b|^(thx|ty|cheers)\b|much appreciated/)) {
    return { answer: "You're welcome. Is there anything else I can help you with?" };
  }

  if (has(/^(bye|goodbye|see you|that's all|that is all|no thanks|nothing else)\b/)) {
    return { answer: "Goodbye. Come back any time you need help with LIVE." };
  }

  if (has(/^(hi+|hello+|hey+|good morning|good afternoon|good evening)\b/)) {
    return {
      answer: "Hello, I'm LIVE Assistant. What would you like help with?",
      suggestions: MAIN_SUGGESTIONS,
    };
  }

  if (has(/\b(who are you|what are you|your name)\b/)) {
    return {
      answer: "I'm LIVE Assistant. I answer questions about using the LIVE website. I cannot dispatch emergency services.",
      suggestions: MAIN_SUGGESTIONS,
    };
  }

  if (role && role !== "requester" && has(/\b(submit|create|new request|make a request|send a request)\b/)) {
    return {
      answer: "Emergency requests are submitted by requesters. In your role you work with the incoming requests. Open the page below to see them.",
      links: [
        {
          label: role === "dispatcher" ? "Requests" : "Dashboard",
          href: role === "dispatcher" ? "/app/dispatcher/requests" : `/app/${role}`,
        },
      ],
    };
  }

  if (has(/\b(assign|assigned|assignment|assignments)\b/)) {
    if (role === "dispatcher") {
      return {
        answer: "Open Requests, select a request to see its details, and assign a responder from there. The Resources page shows who is available.",
        links: [
          { label: "Requests", href: "/app/dispatcher/requests" },
          { label: "Resources", href: "/app/dispatcher/resources" },
        ],
      };
    }
    if (role === "responder") {
      return {
        answer: "Requests assigned to you appear on your dashboard. Open one to see its details and progress.",
        links: [{ label: "Dashboard", href: "/app/responder" }],
      };
    }
  }

  if (role === "admin" && has(/\b(manage users|users|organisations?|organizations?)\b/)) {
    return {
      answer: "Use Users to manage accounts and Organisations to manage organisations.",
      links: [
        { label: "Users", href: "/app/admin/users" },
        { label: "Organisations", href: "/app/admin/organisations" },
      ],
    };
  }

  if ((role === "admin" || role === "auditor") && has(/\b(audit|logs?)\b/)) {
    return {
      answer: "The audit page lists the recorded activity on the platform.",
      links:
        role === "auditor"
          ? [
              { label: "Audit", href: "/app/auditor/audit" },
              { label: "Incidents", href: "/app/auditor/incidents" },
            ]
          : [{ label: "Audit", href: "/app/admin/audit" }],
    };
  }
  if (has(/\b(submit|create|report|new request|make a request|send a request|request help|need help urgently)\b/)) {
    const links: Link[] | undefined =
      role === "requester"
        ? [{ label: "Open New Request", href: "/app/requester/new" }]
        : role
          ? undefined
          : [{ label: "Go to login", href: "/login" }];
    return {
      answer: "To report an emergency, open New Request from your requester dashboard. Enter the incident details and location, review them, then submit. If someone is in immediate danger, contact local emergency services directly, because this chatbot cannot dispatch responders.",
      links,
    };
  }

  if (has(/\b(status|track|tracking|progress|where is my|update on)\b/)) {
    return {
      answer: "Sign in and ask me \"Check my request status\" and I will list your latest requests. You can also open your dashboard or request history.",
      suggestions: ["Check my request status"],
      links: role ? undefined : [{ label: "Go to login", href: "/login" }],
    };
  }

  if (has(/\b(forgot|reset|change)\b.*\bpassword\b|\bpassword\b.*\b(forgot|reset|change)\b/)) {
    return {
      answer: "On the login page, choose Forgot Password and follow the steps. Never share your password or verification codes in this chat.",
      links: [{ label: "Forgot password", href: "/forgot-password" }],
    };
  }

  if (has(/\b(login|log in|sign in|signin|sign up|register|account)\b/)) {
    return {
      answer: "Open the Login page to sign in. If you do not have an account, use Register. Never share your password in this chat.",
      links: [
        { label: "Login", href: "/login" },
        { label: "Register", href: "/register" },
      ],
    };
  }

  if (has(/\b(navigate|navigation|page|pages|menu|find|where|dashboard|history|profile|settings)\b/)) {
    const here = currentPageName(pathname);
    const pages = role ? ROLE_PAGES[role] : undefined;
    if (role && pages) {
      const article = /^[aeiou]/.test(role) ? "an" : "a";
      const lines = pages.map(([, label, what]) => `- ${label}: ${what}`).join("\n");
      return {
        answer: `${here ? `You are on the ${here}. ` : ""}As ${article} ${role} you can:\n${lines}\n\nTap a button below to go to a page.`,
        links: pages.map(([href, label]) => ({ label, href })),
      };
    }
    return {
      answer: `${here ? `You are on the ${here}. ` : ""}Without signing in you can open the pages below. Sign in to see your dashboard pages.`,
      links: [
        { label: "Login", href: "/login" },
        { label: "Register", href: "/register" },
        { label: "Forgot password", href: "/forgot-password" },
        { label: "Terms and Conditions", href: "/terms-and-conditions" },
      ],
    };
  }

  if (has(/\b(help|what can you|faq|options)\b/)) {
    return {
      answer: "Here is what I can help with. Tap one to get started:",
      suggestions: MAIN_SUGGESTIONS,
    };
  }

  return {
    answer: "I'm not sure I understood that. Try one of these:",
    suggestions: MAIN_SUGGESTIONS,
  };
}
export const POST = createHandler(
  {
    name: "chatbot.message",
    auth: "optional",
    body: bodySchema,
    rateLimit: {
      limit: 20,
      windowMs: 60_000,
      by: "ip",
    },
  },
  async (ctx) => {
    const { message, pathname = "/" } = ctx.body;
    const lower = message.toLowerCase();

    // Detect requests to list existing emergency records.
    const asksToListRequests =
      /\b(show|list|display|get|find|view)\b/i.test(lower) &&
      /\b(requests|emergencies)\b/i.test(lower) &&
      /\b(latest|recent|all|my|authorised|authorized|manage|reference|status|statuses)\b/i.test(
        lower
      );

    // Detect questions about the status of existing requests.
    const asksRequestStatus =
      /\b(status|statuses|track|tracking)\b/i.test(lower) &&
      /\b(request|requests|emergency|emergencies|my)\b/i.test(lower);

    // Also recognise common singular status questions.
    const asksAboutMyRequest =
      /\b(my request|my emergency|request status|emergency status)\b/i.test(
        lower
      );

    if (
      asksToListRequests ||
      asksRequestStatus ||
      asksAboutMyRequest
    ) {
      if (!ctx.auth) {
        return {
          answer:
            "Please sign in first so I can securely check the requests linked to your account.",
          action: {
            label: "Go to login",
            href: "/login",
          },
        };
      }

      try {
        const { items } = await listRequests(ctx.auth, {
          scope: ctx.auth.role === "requester" ? "mine" : "all",
          limit: 10,
          offset: 0,
        });

        if (!items.length) {
          return {
            answer:
              "I couldn't find any requests available to your account yet. If you recently submitted one, refresh your dashboard or contact your dispatcher.",
          };
        }

        return {
          answer:
            "Here are the latest requests your account is authorised to view:",
          requests: items.slice(0, 10).map((item) => ({
            reference: item.reference,
            category: item.category,
            status: item.currentStatus,
            submittedAt: item.submittedAt,
          })),
        };
      } catch (error) {
        console.error(
          "[LIVE chatbot] Request-status lookup failed:",
          error
        );

        return {
          answer:
            "I couldn't retrieve request statuses right now. Please open your dashboard or request history and try again.",
        };
      }
    }

    // Never let AI responses delay urgent emergency action.
    if (
      /\b(cpr|not breathing|stopped breathing|someone is dying|heart attack|fire right now|immediate danger)\b/i.test(
        message
      )
    ) {
      return {
        answer:
          "If there is immediate danger, contact local emergency services now. This chatbot cannot dispatch responders and must not delay emergency action. Follow instructions from the emergency operator.",
      };
    }

    if (/\b(thank|thanks|thx|bye|goodbye|help|navigate|navigation|menu|pages?|submit|password|register)\b|^\s*(hi+|hello+|hey+)\b|where (do|can) i find|what can you|new request|assign|manage users|audit|log ?in|sign ?in/i.test(message)) {
      return {
        ...localAnswer(message, pathname, ctx.auth?.role),
        model: "local-rules",
      };
    }
    // Ollama configuration.
    const baseUrl = (
      process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
    ).replace(/\/+$/, "");

    const model = process.env.OLLAMA_MODEL || "gemma3:1b-it-q4_K_M";

    const prompt = [
      "You are LIVE Assistant, a helpful chatbot for the LIVE emergency request and response website.",
      "Answer only the question the user actually asked.",
      "Do not add unrelated information or unsolicited instructions.",
      "For general knowledge questions, answer directly.",
      "Use plain language and a maximum of two short sentences unless more detail is requested.",
      "Never claim to dispatch emergency services or submit, change, or cancel a request.",
      "Never invent website features or emergency phone numbers.",
      "Never reveal private information about users or their requests.",
      "For questions about existing emergency requests, do not invent records or statuses. The application handles authenticated request lookups.",
      "If there is immediate danger, tell the user to contact local emergency services immediately.",
      `Current page: ${pathname}`,
      `User question: ${message}`,
      "Answer the user question now. Include nothing unrelated to that question.",
    ].join("\n");

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 220,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const details = await response.text();

        throw new Error(
          `Ollama returned HTTP ${response.status}: ${details.slice(0, 300)}`
        );
      }

      const payload = (await response.json()) as {
        response?: string;
        error?: string;
      };

      if (payload.error) {
        throw new Error(payload.error);
      }

      const answer = payload.response?.trim();

      if (!answer) {
        throw new Error("Ollama returned an empty response.");
      }

      return {
        answer,
        model,
      };
    } catch (error) {
      console.error("[LIVE chatbot] Ollama request failed:", error);

      return {
        ...localAnswer(message, pathname, ctx.auth?.role),
        model: "local-faq-fallback",
      };
    }
  }
);
