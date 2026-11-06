"use client";

/**
 * LIVE ASSISTANT CHATBOT   (Frontend - AI chatbot interface)
 *
 * A floating "Ask LIVE" button on every page that opens a chat panel with:
 *   - a role-aware greeting and suggested questions (quick replies)
 *   - answers from /api/assistant/chat, with follow-up suggestions and
 *     one-tap links to the right screen
 *   - a compact text input with an inline send control
 *   - an always-visible emergency strip with tap-to-call numbers
 *   - clear loading, error and retry states
 *
 * Talks to the server only through lib/middleware/client/api.ts, so the
 * standard envelope, token refresh and error codes are handled in one place.
 * Conversation history lives in memory only and is cleared on sign-out or
 * when a different user signs in.
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, LoaderCircle, MessageCircleQuestion, Phone, RotateCcw, Send, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { api, ApiClientError } from "@/lib/middleware/client/api";
import { cn } from "@/lib/utils";
import type { AssistantAction, AssistantReply, AssistantWelcome } from "@/lib/assistant/knowledge-base";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  quickReplies?: string[];
  actions?: AssistantAction[];
  urgent?: boolean;
  error?: boolean;
}

const MAX_INPUT = 500;

/**
 * Mid-emergency screens with their own bottom controls and their own help
 * (the request form and live tracking, which has the emergency AI helper).
 * On phones the floating button would cover form content there, so it is
 * hidden on small screens only.
 */
const HIDDEN_ON_MOBILE = ["/app/requester/new", "/app/requester/track"];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
}

/* ---------------------------- message rendering ---------------------------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-[#102b3f]">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}

export function AssistantText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ type: "p" | "ul" | "ol"; items: string[] }> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ type: "p", items: [] });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const type = bullet ? "ul" : numbered ? "ol" : "p";
    const value = bullet?.[1] ?? numbered?.[1] ?? line;
    const last = blocks.at(-1);
    if (last && last.type === type && type !== "p") last.items.push(value);
    else blocks.push({ type, items: [value] });
  }
  return (
    <div className="space-y-2">
      {blocks.filter((b) => b.items.length).map((block, i) =>
        block.type === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
        ) : block.type === "ol" ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ol>
        ) : (
          <p key={i}>{inline(block.items[0])}</p>
        ),
      )}
    </div>
  );
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "RATE_LIMITED") return "You're sending messages quickly. Please wait a moment and try again.";
    if (error.code === "VALIDATION_FAILED") return Object.values(error.fieldErrors).flat()[0] ?? error.message;
    if (error.status >= 500) return "The assistant had a problem answering. Please try again.";
    return error.message;
  }
  if (error instanceof TypeError) return "You appear to be offline. Check your connection and try again.";
  return "The assistant is unavailable right now. Please try again.";
}

/* --------------------------------- widget --------------------------------- */

export function AssistantWidget() {
  const { user } = useAuth();
  const pathname = usePathname() ?? "/";
  const role = user?.role ?? "guest";
  const conversationKey = user?.id ?? "guest";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingWelcome, setLoadingWelcome] = useState(false);
  const welcomeKeyRef = useRef<string | null>(null);
  const lastQuestionRef = useRef<string>("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // New user (or sign-out) -> fresh conversation.
  useEffect(() => {
    setMessages([]);
    welcomeKeyRef.current = null;
  }, [conversationKey]);

  const loadWelcome = useCallback(async () => {
    if (welcomeKeyRef.current === conversationKey) return;
    welcomeKeyRef.current = conversationKey;
    setLoadingWelcome(true);
    try {
      const welcome = await api<AssistantWelcome>("/api/assistant/chat");
      const name = user?.firstName ? `, ${user.firstName}` : "";
      setMessages([{ id: newId(), role: "assistant", text: welcome.greeting.replace(/^Hi!/, `Hi${name}!`), quickReplies: welcome.suggestions }]);
    } catch {
      // The chat still works without the welcome call; offer safe defaults.
      setMessages([
        {
          id: newId(),
          role: "assistant",
          text: "Hi! I'm the LIVE assistant. Ask me how to use LIVE. If someone is in danger right now, call **10177** or **112** first.",
          quickReplies: ["What can you do?", "Emergency phone numbers"],
        },
      ]);
    } finally {
      setLoadingWelcome(false);
    }
  }, [conversationKey, user?.firstName]);

  useEffect(() => {
    if (!open) return;
    void loadWelcome();
    const t = window.setTimeout(() => inputRef.current?.focus(), 120);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loadWelcome]);

  // Return focus to the launcher when the panel closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim().slice(0, MAX_INPUT);
    if (!question || busy) return;
    lastQuestionRef.current = question;
    setInput("");

    const history = messages
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));

    setMessages((current) => [...current.map((m) => ({ ...m, quickReplies: undefined })), { id: newId(), role: "user", text: question }]);
    setBusy(true);
    try {
      const reply = await api<AssistantReply>("/api/assistant/chat", {
        method: "POST",
        body: { message: question, history, page: pathname.slice(0, 200) },
      });
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", text: reply.reply, quickReplies: reply.quickReplies, actions: reply.actions, urgent: reply.urgent },
      ]);
    } catch (error) {
      setMessages((current) => [...current, { id: newId(), role: "assistant", text: friendlyError(error), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setMessages((current) => {
      const trimmed = [...current];
      while (trimmed.length && (trimmed.at(-1)?.error || trimmed.at(-1)?.role === "user")) trimmed.pop();
      return trimmed;
    });
    void send(lastQuestionRef.current);
  }

  const inApp = pathname.startsWith("/app");
  const hideOnMobile = HIDDEN_ON_MOBILE.some((prefix) => pathname.startsWith(prefix));
  const latest = messages.at(-1);

  function openAssistant() {
    // The requester home already owns the translated, persistent LIVE AI sheet.
    // Open that existing flow instead of creating a second requester chat.
    if (role === "requester" && pathname === "/app/requester") {
      window.dispatchEvent(new CustomEvent("live:requester-voice-action", { detail: { action: "open-ai" } }));
      return;
    }
    setOpen(true);
  }

  return (
    <>
      {!open ? (
        <button
          ref={launcherRef}
          type="button"
          onClick={openAssistant}
          aria-haspopup="dialog"
          aria-label="Open the LIVE assistant"
          className={cn(
            "fixed right-4 z-[90] inline-flex h-10 items-center gap-1.5 rounded-full bg-[#102b3f] pl-3 pr-3.5 text-xs font-semibold text-white shadow-[0_10px_28px_rgba(16,43,63,.28)] transition hover:bg-[#0b2131] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/35 sm:right-6 sm:h-11 sm:gap-2 sm:pl-3.5 sm:pr-4 sm:text-sm",
            inApp ? "bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] md:bottom-6" : "bottom-5 sm:bottom-6",
            hideOnMobile && "max-md:hidden",
          )}
        >
          <MessageCircleQuestion className="h-4 w-4 sm:h-5 sm:w-5" />
          <span>Ask LIVE</span>
        </button>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div className="fixed inset-0 z-[125] sm:inset-auto sm:bottom-6 sm:right-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label="Close the assistant" onClick={() => setOpen(false)} className="absolute inset-0 bg-[#071a29]/40 sm:hidden" />
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="live-assistant-title"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 360, damping: 32 }}
              className="absolute inset-x-0 bottom-0 flex h-[86svh] flex-col overflow-hidden rounded-t-[22px] border border-[#dce5ea] bg-[#f6f8fb] shadow-2xl sm:relative sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-2xl"
            >
              <header className="flex shrink-0 items-center gap-3 border-b border-[#dce5ea] bg-white px-4 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e7f3f4] text-[#0f5b67]"><Bot className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <h2 id="live-assistant-title" className="text-sm font-semibold text-[#102b3f]">LIVE assistant</h2>
                  <p className="text-xs text-[#6b7f8b]">Help using LIVE · not a replacement for emergency services</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-[#536879] transition hover:bg-[#edf2f5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/20">
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#f0d0ce] bg-[#fff4f3] px-4 py-2 text-xs font-semibold text-[#8d2b29]">
                <span>In danger now? Call</span>
                {[
                  ["10177", "Ambulance and fire"],
                  ["10111", "Police"],
                  ["112", "Mobile emergency"],
                ].map(([number, label]) => (
                  <a key={number} href={`tel:${number}`} aria-label={`Call ${label}, ${number}`} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[#b3302e] ring-1 ring-[#f0c8c7] hover:bg-[#ffeded]">
                    <Phone className="h-3 w-3" />{number}
                  </a>
                ))}
              </div>

              <div ref={listRef} className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-relevant="additions">
                {loadingWelcome && messages.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-[#6b7f8b]"><LoaderCircle className="h-4 w-4 animate-spin" />Starting the assistant...</p>
                ) : null}

                {messages.map((message) => (
                  <div key={message.id} className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}>
                    <div
                      className={cn(
                        "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                        message.role === "user"
                          ? "rounded-br-sm bg-[#0f5b67] text-white"
                          : message.error
                            ? "rounded-bl-sm border border-[#f0c8c7] bg-[#ffeded] text-[#8d2b29]"
                            : message.urgent
                              ? "rounded-bl-sm border border-[#f0c8c7] bg-white text-[#3d4f5b]"
                              : "rounded-bl-sm bg-white text-[#3d4f5b] shadow-[0_1px_0_#e2e8ed]",
                      )}
                    >
                      {message.role === "user" ? message.text : <AssistantText text={message.text} />}
                    </div>

                    {message.error && message === latest ? (
                      <button type="button" onClick={retry} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#0f5b67] underline underline-offset-2">
                        <RotateCcw className="h-3 w-3" />Try again
                      </button>
                    ) : null}

                    {message.actions?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                          <Link key={action.href} href={action.href} onClick={() => setOpen(false)} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition", message.urgent ? "bg-[#d53f3d] text-white hover:bg-[#bd3331]" : "bg-[#0f5b67] text-white hover:bg-[#0b4b55]")}>
                            {action.label}<ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        ))}
                      </div>
                    ) : null}

                    {message.quickReplies?.length && message === latest && !busy ? (
                      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
                        {message.quickReplies.map((reply) => (
                          <button key={reply} type="button" onClick={() => void send(reply)} className="min-h-9 rounded-full border border-[#cfdbe1] bg-white px-3 text-left text-xs font-semibold text-[#0f5b67] transition hover:border-[#0f5b67] hover:bg-[#e7f3f4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/20">
                            {reply}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}

                {busy ? (
                  <p className="flex items-center gap-2 text-xs font-semibold text-[#6b7f8b]" role="status">
                    <span className="live-typing" aria-hidden><span /><span /><span /></span>
                    LIVE assistant is typing...
                  </p>
                ) : null}
              </div>

              <form
                className="shrink-0 border-t border-[#dce5ea] bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <div className="relative">
                  <label className="sr-only" htmlFor="live-assistant-input">Your question</label>
                  <input
                    id="live-assistant-input"
                    ref={inputRef}
                    type="text"
                    value={input}
                    maxLength={MAX_INPUT}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void send(input);
                      }
                    }}
                    placeholder="Ask LIVE a question"
                    className="h-12 w-full rounded-xl border border-[#d6e1e6] bg-white py-2.5 pl-4 pr-14 text-sm leading-5 text-[#102b3f] outline-none transition placeholder:text-[#98a7b3] focus:border-[#0f5b67] focus:ring-4 focus:ring-[#0f5b67]/10"
                  />
                  <button type="submit" disabled={!input.trim() || busy} aria-label="Send question" className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg bg-[#0f5b67] text-white transition hover:bg-[#0b4b55] disabled:opacity-45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f5b67]/25">
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
