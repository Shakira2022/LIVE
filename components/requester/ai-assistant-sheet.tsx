"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readCached } from "@/lib/client-cache";

type EmergencyContext = {
  id: string;
  category: string;
  severity: string;
  note: string;
  status: string;
  location: { address: string; lat?: number; lng?: number };
};

type ActiveDetailsCache = { answers?: string[] };
type Message = { role: "assistant" | "user"; text: string };
type QuestionAnswer = { question: string; answer: string };

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>,
  );
}

function AssistantText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const blocks: Array<{ type: "paragraph" | "bullet" | "numbered"; items: string[] }> = [];

  for (const line of lines) {
    const bullet = line.match(/^(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const type = bullet ? "bullet" : numbered ? "numbered" : "paragraph";
    const value = bullet?.[1] ?? numbered?.[1] ?? line;
    const previous = blocks.at(-1);

    if (previous?.type === type && type !== "paragraph") previous.items.push(value);
    else blocks.push({ type, items: [value] });
  }

  return <div className="space-y-3">{blocks.map((block, index) => {
    if (block.type === "bullet") return <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ul>;
    if (block.type === "numbered") return <ol key={index} className="list-decimal space-y-1 pl-5">{block.items.map((item) => <li key={item}>{renderInline(item)}</li>)}</ol>;
    return <p key={index}>{renderInline(block.items[0])}</p>;
  })}</div>;
}

function followUpQuestions(context: EmergencyContext) {
  const note = context.note.toLowerCase();
  if (context.category.toLowerCase().includes("medical") || note.includes("accident")) {
    return [
      { question: "Is anyone trapped in a vehicle or unable to move?", options: ["Yes", "No", "I am not sure"] },
      { question: "Is anyone unconscious or not breathing normally?", options: ["Yes", "No", "I am not sure"] },
      { question: "Is there heavy bleeding or another immediate danger?", options: ["Yes", "No", "I am not sure"] },
      { question: "How many people need help?", options: ["One person", "Two people", "Three or more", "I am not sure"] },
      { question: "Is the accident blocking traffic or creating another hazard?", options: ["Yes", "No", "I am not sure"] },
    ];
  }
  if (context.category.toLowerCase().includes("fire")) {
    return [
      { question: "Is anyone trapped inside or unable to leave?", options: ["Yes", "No", "I am not sure"] },
      { question: "Is the fire spreading or producing heavy smoke?", options: ["Yes", "No", "I am not sure"] },
      { question: "Is the area safe for you to remain in?", options: ["Yes", "No", "I am not sure"] },
      { question: "What is burning?", options: ["A building", "A vehicle", "Outside materials", "I am not sure"] },
    ];
  }
  return [
    { question: "Is anyone in immediate danger right now?", options: ["Yes", "No", "I am not sure"] },
    { question: "Is the situation still happening?", options: ["Yes, right now", "Just happened", "I am not sure"] },
    { question: "Is there any information responders should know immediately?", options: ["Yes", "No", "I am not sure"] },
    { question: "How many people are affected?", options: ["One person", "Two people", "Three or more", "I am not sure"] },
    { question: "Is it safe for you to stay where you are?", options: ["Yes", "No", "I am not sure"] },
  ];
}

export function AiAssistantSheet({ open, onOpenChange, emergency }: { open: boolean; onOpenChange: (open: boolean) => void; emergency: EmergencyContext }) {
  const questions = useMemo(() => followUpQuestions(emergency), [emergency]);
  const [answered, setAnswered] = useState<string[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<QuestionAnswer[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationTimerRef = useRef<number | null>(null);
  const generationTokenRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const cached = readCached<ActiveDetailsCache>(`requester-active-details:${emergency.id}`);
    setAnswered(cached?.answers ?? []);
    setQuestionAnswers([]);
    setMessages([{ role: "assistant", text: `I can help you think through this ${emergency.category.toLowerCase()} emergency.` }]);

    return () => {
      generationTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (generationTimerRef.current !== null) {
        window.clearInterval(generationTimerRef.current);
        generationTimerRef.current = null;
      }
    };
  }, [open, emergency.id, emergency.category]);

  function stopGeneration() {
    generationTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (generationTimerRef.current !== null) {
      window.clearInterval(generationTimerRef.current);
      generationTimerRef.current = null;
    }
    setBusy(false);
  }

  function showAnswerProgressively(answer: string) {
    const chunks = answer.match(/\S+\s*/g) ?? [answer];
    const token = ++generationTokenRef.current;
    let index = 0;

    setMessages((current) => [...current, { role: "assistant", text: "" }]);
    generationTimerRef.current = window.setInterval(() => {
      if (token !== generationTokenRef.current) return;

      const partial = chunks.slice(0, index + 1).join("");
      setMessages((current) => current.map((message, messageIndex) =>
        messageIndex === current.length - 1 && message.role === "assistant"
          ? { ...message, text: partial }
          : message,
      ));
      index += 1;

      if (index >= chunks.length) {
        if (generationTimerRef.current !== null) {
          window.clearInterval(generationTimerRef.current);
          generationTimerRef.current = null;
        }
        setBusy(false);
      }
    }, 32);
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setQuestion("");
    const nextMessages = [...messages, { role: "user" as const, text: trimmed }];
    setMessages(nextMessages);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/requester/ai", { method: "POST", credentials: "include", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emergency, question: trimmed, messages: nextMessages, answers: questionAnswers }) });
      const payload = await response.json() as { answer?: string; data?: { answer?: string }; error?: { message?: string } | string };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || "The assistant is unavailable.");
      const answer = payload.data?.answer ?? payload.answer;
      showAnswerProgressively(answer || "Please stay safe and follow the responder's instructions.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessages((current) => [...current, { role: "assistant", text: error instanceof Error ? error.message : "The assistant is unavailable right now." }]);
      setBusy(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const unansweredQuestions = questions.filter((item) => !answered.includes(item.question));
  const currentQuestion = unansweredQuestions[0];
  const questionNumber = questions.length - unansweredQuestions.length + 1;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[120] md:flex md:items-center md:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" aria-label="Close AI help" className="absolute inset-0 z-0 bg-[#071a29]/45" onClick={() => onOpenChange(false)} />
          <motion.section role="dialog" aria-modal="true" aria-label="LIVE AI help" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 330, damping: 34 }} className="absolute inset-x-0 bottom-0 z-10 flex h-[88dvh] max-h-[88dvh] flex-col overflow-hidden rounded-t-[22px] bg-[#f6f8fb] shadow-2xl md:static md:h-[min(820px,88dvh)] md:max-h-[88dvh] md:w-[min(680px,calc(100vw-2rem))] md:translate-x-0 md:translate-y-0 md:rounded-lg">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dce5ea] bg-white px-5 py-4 sm:px-6">
              <div><h2 className="font-semibold text-[#102b3f]">LIVE AI help</h2></div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}><X className="h-5 w-5" /></Button>
            </header>

            <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-6">
          {currentQuestion ? <section><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#758793]">Optional details</p><span className="text-xs font-semibold text-[#758793]">{questionNumber} of {questions.length}</span></div><AnimatePresence mode="wait"><motion.div key={currentQuestion.question} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="mt-4"><h3 className="font-semibold text-[#102b3f]">{currentQuestion.question}</h3><div className="mt-3 divide-y divide-[#dfe7ec]">{currentQuestion.options.map((option, index) => <button key={option} type="button" onClick={() => { setAnswered((current) => [...current, currentQuestion.question]); setQuestionAnswers((current) => [...current, { question: currentQuestion.question, answer: option }]); }} className="group flex w-full items-center gap-3 px-1 py-3 text-left text-sm font-semibold text-[#526a78] transition hover:text-[#0f6872]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e4eaee] text-xs font-semibold text-[#788a95] transition group-hover:bg-[#0f6872] group-hover:text-white">{index + 1}</span><span>{option}</span></button>)}</div><button type="button" onClick={() => { setAnswered((current) => [...current, currentQuestion.question]); setQuestionAnswers((current) => [...current, { question: currentQuestion.question, answer: "Skipped" }]); }} className="mx-auto mt-3 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2">Skip this question</button><button type="button" onClick={() => setAnswered(questions.map((item) => item.question))} className="mx-auto mt-4 block text-center text-xs font-semibold text-[#71838f] underline underline-offset-2">Skip remaining questions</button></motion.div></AnimatePresence></section> : <p className="text-center text-sm font-semibold text-[#526a78]">No more questions. You can now ask LIVE AI about this emergency.</p>}
          <section className="space-y-3">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-8 rounded-2xl rounded-br-sm bg-[#0f6872] px-4 py-3 text-sm leading-6 text-white" : index === 0 ? "mx-auto max-w-lg px-2 py-3 text-center text-sm leading-6 text-[#526a78]" : "mr-4 rounded-2xl rounded-bl-sm bg-[#f1f5f7] px-4 py-3 text-sm leading-6 text-[#526a78]"}><AssistantText text={message.text} /></div>)}{busy ? <div className="flex items-center justify-between text-xs font-semibold text-[#758793]"><span>LIVE AI is thinking...</span><button type="button" onClick={stopGeneration} className="underline underline-offset-2">Stop</button></div> : null}</section>
        </div>
        {!currentQuestion ? <div className="shrink-0 border-t border-[#dce5ea] bg-white p-4 sm:p-5"><div className="flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(question); }} placeholder="Ask about this emergency" className="min-w-0 flex-1 rounded-xl border border-[#d6e1e6] px-3 text-sm outline-none focus:border-[#0f6872]" /><Button type="button" size="icon" disabled={!question.trim() || busy} onClick={() => void ask(question)} aria-label="Ask LIVE AI"><Send className="h-4 w-4" /></Button></div></div> : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
