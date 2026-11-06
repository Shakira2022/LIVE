"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input, Select, Textarea } from "@/components/ui/field";
import { clearClientCache } from "@/lib/client-cache";
import { supportText } from "@/lib/support-ui";
import type { RequesterLanguage } from "@/lib/requester-language";

const categories = ["Account access", "Profile or account details", "Request or incident", "Map or location", "Calls or notifications", "Technical problem", "Other"];

export function SupportContactForm({ workspace = false, language = "English" }: { workspace?: boolean; language?: RequesterLanguage }) {
  const { user, loading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const t = (text: string) => workspace ? supportText(language, text) : text;

  useEffect(() => {
    if (user) { setName(user.name); setEmail(user.email); }
  }, [user]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/support", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, category, message }) });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.error?.message || "Your support request could not be sent. Please try again.");
      if (user?.role === "admin") clearClientCache(`admin-support:${user.id}`);
      setDone(true); setMessage("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your support request could not be sent. Please try again."); }
    finally { setBusy(false); }
  }

  if (workspace && loading) return <p role="status" className="mt-5 text-sm text-[#667b89]">Loading your account…</p>;
  if (done) return <section className="mt-6 border-t border-[#dce5ea] pt-5"><h2 className="text-lg font-bold text-[#102b3f]">{t("Your message has been sent")}</h2><p className="mt-2 text-sm leading-6 text-[#536879]">{workspace ? t("The LIVE support team has received your request.") : `The LIVE support team has received your request. You can expect a response at ${user?.email || email}.`}</p><Button variant="ghost" className="mt-3 px-0" onClick={() => setDone(false)}>{t("Send another message")}</Button></section>;

  return <form onSubmit={submit} className={`${workspace ? "mt-4" : "mt-2 p-1 sm:px-4 sm:py-1"} space-y-8`}>
    {!workspace ? <>
      <div className="border-b border-[#e3eaee] pb-5"><h2 className="font-bold text-[#102b3f]">Contact support</h2><p className="mt-1 text-sm leading-5 text-[#667b89]">{user ? "Your account details are attached to this request." : "Share your contact details so we can reply."}</p></div>
      {!user ? <div className="grid gap-5 sm:grid-cols-2"><label className="block [&>span]:mb-3"><FieldLabel>Your name</FieldLabel><Input className="pb-2" required maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></label><label className="block [&>span]:mb-3"><FieldLabel>Email address</FieldLabel><Input className="pb-2" required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label></div> : null}
    </> : null}
    <label className="block [&>span]:mb-3"><FieldLabel>{t("What do you need help with?")}</FieldLabel><Select data-live-keyboard-scroll-self className="pb-2" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{t(item)}</option>)}</Select></label>
    <label className="block [&>span]:mb-3"><FieldLabel>{t("Tell us more")}</FieldLabel><Textarea className="pb-5" required minLength={10} maxLength={8000} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("Describe what happened and what you were trying to do.")} /></label>
    {error ? <p role="alert" className="rounded-lg border border-[#e8c8c5] bg-[#fff6f5] px-4 py-3 text-sm text-[#a5322e]">{error}</p> : null}
    <div className="flex justify-start border-t border-[#e3eaee] pt-5"><Button type="submit" disabled={busy || (workspace && !user)}>{busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />{t("Sending…")}</> : t("Send to support")}</Button></div>
  </form>;
}
