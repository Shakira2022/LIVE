
"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronDown, MessageCircle, Mic, MicOff, Send, ShieldCheck, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

type RequestStatus = {
  reference?: string;
  category?: string;
  status?: string;
  submittedAt?: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  requests?: RequestStatus[];
  action?: { label: string; href: string };
  suggestions?: string[];
  links?: { label: string; href: string }[];
};

type ChatPayload = {
  data?: {
    answer?: string;
    requests?: RequestStatus[];
    action?: { label: string; href: string };
  suggestions?: string[];
  links?: { label: string; href: string }[];
  };
  answer?: string;
  requests?: RequestStatus[];
  action?: { label: string; href: string };
  suggestions?: string[];
  links?: { label: string; href: string }[];
  error?: { message?: string };
};

const quickActions = [
  { label: "FAQs", message: "What can you help me with?" },
  { label: "Find a page", message: "Help me navigate the website." },
  { label: "Check my request status", message: "Check my request status." },
];

export function LiveChatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi! I’m LIVE Assistant. I can answer FAQs, help you navigate the website, and check request status when you’re signed in.",
    },
  ]);

  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const w = window as any;
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const w = window as any;
    const SpeechRecognitionApi = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) return;

    const recognition = new SpeechRecognitionApi();
    recognition.lang = "en-ZA";
    recognition.interimResults = true;
    recognition.continuous = false;

    const existing = input.trim();

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput((existing ? existing + " " : "") + transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, busy, open]);

  useEffect(() => {
  setMessages([
    {
      role: "assistant",
      text: "Hi! I’m LIVE Assistant. I can answer FAQs, help you navigate the website, and check request status when you’re signed in.",
    },
  ]);
  setInput("");
  setBusy(false);
}, [user?.id]);

  async function sendMessage(value: string) {
    recognitionRef.current?.stop();
    const message = value.trim();

    if (!message || busy) return;

    setInput("");
    setMessages((current) => [
      ...current,
      { role: "user", text: message },
    ]);
    setBusy(true);

    try {
      const response = await fetch("/api/chatbot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, pathname }),
      });

      const payload = (await response.json()) as ChatPayload;

      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            "Chat is temporarily unavailable. Please try again."
        );
      }

      const data = payload.data ?? payload;

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            data.answer ||
            "I couldn’t form a response. Please try again.",
          requests: data.requests,
          action: data.action,
          suggestions: data.suggestions,
          links: data.links,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "Chat is temporarily unavailable. Please try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close LIVE Assistant" : "Open LIVE Assistant"}
        aria-expanded={open}
        className="fixed bottom-20 right-4 z-[100] flex h-14 items-center gap-2 rounded-full bg-[#0f5b67] px-4 text-sm font-semibold text-white shadow-xl transition hover:bg-[#0b4650] focus:outline-none focus:ring-4 focus:ring-[#0f5b67]/25 md:bottom-6 md:right-6"
      >
        {open ? (
          <ChevronDown className="h-5 w-5" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
        <span>{open ? "Close chat" : "LIVE Assistant"}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="LIVE Assistant chat"
            aria-modal="false"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[101] flex max-h-[min(680px,calc(100dvh-8rem))] flex-col overflow-hidden rounded-2xl border border-[#dfe7ec] bg-white shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[390px] md:bottom-24"
          >
            <header className="flex shrink-0 items-center justify-between bg-[#102b3f] px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                  <Bot className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold">LIVE Assistant</p>
                  <p className="text-xs text-white/70">
                    FAQs · Navigation · Request status
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 hover:bg-white/10"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex shrink-0 items-center gap-2 border-b border-[#e8eef1] bg-[#f7fafb] px-4 py-2 text-[11px] text-[#526773]">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[#0f5b67]" />
              <span>
                {user
                  ? `Signed in as ${user.role}. Status lookup uses your account permissions.`
                  : "Sign in to securely check request status."}
              </span>
            </div>
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[#e8eef1] bg-white px-3 py-2">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendMessage(action.message)}
                  className="shrink-0 whitespace-nowrap rounded-full border border-[#cddde2] px-3 py-1.5 text-xs font-semibold text-[#0f5b67] hover:bg-[#eff6f7] disabled:opacity-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f6f8fb] p-3"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {messages.map((message, index) => (
                <div
                  key={`${index}-${message.role}`}
                  className={`flex ${
                    message.role === "user"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
                      message.role === "user"
                        ? "rounded-br-md bg-[#0f5b67] text-white"
                        : "rounded-bl-md border border-[#e1e9ed] bg-white text-[#203947]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.text}</p>

                    {message.requests?.length ? (
                      <div className="mt-2 space-y-2">
                        {message.requests.map((request, requestIndex) => (
                          <div
                            key={`${request.reference}-${requestIndex}`}
                            className="rounded-lg border border-[#dfe7ec] bg-[#f7fafb] p-2.5 text-xs text-[#203947]"
                          >
                            <p className="font-bold">
                              {request.reference || "Emergency request"}
                            </p>
                            <p className="mt-1">
                              {request.category || "Request"} ·{" "}
                              <span className="font-semibold">
                                {request.status || "Status unavailable"}
                              </span>
                            </p>
                            {request.submittedAt ? (
                              <p className="mt-1 text-[#647784]">
                                Submitted:{" "}
                                {new Date(
                                  request.submittedAt
                                ).toLocaleString()}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {message.links?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.links.map((link) => (
                          <button
                            key={link.href}
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              router.push(link.href);
                            }}
                            className="rounded-lg bg-[#0f5b67] px-3 py-2 text-xs font-semibold text-white"
                          >
                            {link.label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.suggestions?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            disabled={busy}
                            onClick={() => void sendMessage(suggestion)}
                            className="rounded-full border border-[#cddde2] px-3 py-1.5 text-xs font-semibold text-[#0f5b67] hover:bg-[#eff6f7] disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {message.action ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(message.action!.href);
                        }}
                        className="mt-2 rounded-lg bg-[#0f5b67] px-3 py-2 text-xs font-semibold text-white"
                      >
                        {message.action.label}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="w-fit rounded-xl border border-[#e1e9ed] bg-white px-3 py-2 text-xs text-[#617582]">
                  LIVE Assistant is thinking…
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={submit}
              className="flex shrink-0 items-end gap-2 border-t border-[#dfe7ec] bg-white p-3"
            >
              <label className="sr-only" htmlFor="live-chat-message">
                Message LIVE Assistant
              </label>
              <textarea
                id="live-chat-message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
                rows={1}
                maxLength={600}
                placeholder="Ask a question…"
                className="max-h-24 min-h-10 flex-1 resize-y rounded-xl border border-[#d7e2e7] px-3 py-2.5 text-sm text-[#203947] outline-none placeholder:text-[#8999a2] focus:border-[#0f5b67] focus:ring-2 focus:ring-[#0f5b67]/15"
              />
              {voiceSupported ? (
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={busy}
                  aria-label={listening ? "Stop voice input" : "Start voice input"}
                  title={listening ? "Stop listening" : "Speak your question"}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border disabled:opacity-40 ${
                    listening
                      ? "animate-pulse border-red-500 bg-red-50 text-red-600"
                      : "border-[#cddde2] bg-white text-[#0f5b67] hover:bg-[#eff6f7]"
                  }`}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send message"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0f5b67] text-white hover:bg-[#0b4650] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>

            <p className="shrink-0 bg-white px-3 pb-3 text-[10px] leading-4 text-[#758792]">
              AI responses can be wrong. This assistant does not dispatch
              emergency services. In immediate danger, contact local emergency
              services directly.
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
