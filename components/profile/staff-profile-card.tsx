"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardList, KeyRound, Mail, Pencil, Phone, UserRound, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { api } from "@/lib/middleware/client/api";

type Assignment = { status: string };
const detailClass = "flex gap-3 px-5 py-4 sm:px-6";

export function StaffProfileCard() {
  const { user, refresh } = useAuth();
  const isDispatcher = user?.role === "dispatcher";
  const isResponder = user?.role === "responder";
  const isAuditor = user?.role === "auditor";
  const profileRole = isDispatcher ? "dispatcher" : isResponder ? "responder" : "auditor";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", phone: "" });
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordCodeSent, setPasswordCodeSent] = useState(false);
  const [passwordCodeVerified, setPasswordCodeVerified] = useState(false);
  const [passwordSheetOpen, setPasswordSheetOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    if (!passwordMessage) return;
    const timeout = window.setTimeout(() => setPasswordMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [passwordMessage]);

  useEffect(() => {
    if (!isResponder) return;
    let active = true;
    void api<{ assignments?: Array<{ assignment?: Assignment } | Assignment> }>("/api/responder/history")
      .then((result) => {
        if (active) setAssignments((result.assignments ?? []).map((item) => "assignment" in item && item.assignment ? item.assignment : item as Assignment));
      })
      .catch(() => { if (active) setAssignments([]); });
    return () => { active = false; };
  }, [isResponder]);

  const stats = useMemo(() => ({
    total: assignments.length,
    active: assignments.filter((item) => ["assigned", "acknowledged", "en_route", "arrived"].includes(item.status)).length,
    completed: assignments.filter((item) => item.status === "completed").length,
    cancelled: assignments.filter((item) => item.status === "cancelled").length,
    rejected: assignments.filter((item) => item.status === "rejected").length,
  }), [assignments]);

  if (!user) return null;

  function startEditing() {
    setDraft({ name: user!.name, phone: user!.phone });
    setError("");
    setEditing(true);
  }

  async function saveProfile() {
    if (draft.name.trim().length < 2 || !/^\+?[0-9][0-9\s-]{6,18}$/.test(draft.phone.trim())) {
      setError("Enter a name and a valid callback number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const profileEndpoint = isDispatcher ? "/api/dispatcher/profile" : isAuditor ? "/api/auditor/profile" : "/api/responder/profile";
      await api(profileEndpoint, { method: "PATCH", body: { name: draft.name, phone: draft.phone } });
      await refresh();
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile. Try again.");
    } finally { setSaving(false); }
  }

  async function sendPasswordCode() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      await api("/api/requester/profile/password-code", { method: "POST", body: {} });
      setPasswordCodeSent(true);
      setPasswordCodeVerified(false);
      setPasswordMessage("A verification code was sent.");
    } catch (requestError) {
      setPasswordError(requestError instanceof Error ? requestError.message : "Unable to send a verification code.");
    } finally { setPasswordBusy(false); }
  }

  async function verifyPasswordCode() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      await api("/api/requester/profile/password-code/verify", { method: "POST", body: { code: passwordCode } });
      setPasswordCodeVerified(true);
      setPasswordMessage("Code verified. You can now choose a new password.");
    } catch (verificationError) {
      setPasswordCodeVerified(false);
      setPasswordError(verificationError instanceof Error ? verificationError.message : "That code could not be verified.");
    } finally { setPasswordBusy(false); }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError("Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api("/api/requester/profile/password", { method: "POST", body: { code: passwordCode, newPassword } });
      setPasswordCodeVerified(false);
      setPasswordCodeSent(false);
      setPasswordCode("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordMessage("Your password was changed successfully.");
    } catch (changeError) {
      setPasswordCodeVerified(false);
      setPasswordError(changeError instanceof Error ? changeError.message : "Unable to change your password.");
    } finally { setPasswordBusy(false); }
  }

  const fields = [
    { icon: <Mail className="h-5 w-5" />, label: "Email", value: user.email || "Email not provided" },
    { icon: <Phone className="h-5 w-5" />, label: "Callback number", value: user.phone || "Phone not provided" },
    { icon: <UserRound className="h-5 w-5" />, label: "Organisation", value: user.organisationName || "No organisation assigned" },
  ];

  return <div className="grid gap-3 sm:gap-5">
    {typeof document !== "undefined" ? createPortal(<div className="pointer-events-none fixed inset-x-0 top-4 z-[10000] flex flex-col items-center gap-2 px-4"><AnimatePresence>{passwordMessage ? <motion.div key="responder-password-success" role="status" aria-live="polite" initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.2, ease: "easeOut" }} className="pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-xl"><p>{passwordMessage}</p><button type="button" onClick={() => setPasswordMessage("")} aria-label="Dismiss" className="-mr-1 -mt-1 rounded-full p-1 hover:bg-emerald-100"><X className="h-5 w-5"/></button></motion.div> : null}</AnimatePresence></div>, document.body) : null}
    <div className="hidden lg:block"><div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-[#102b3f]">{profileRole[0].toUpperCase() + profileRole.slice(1)} profile</h1><p className="mt-1 text-sm text-[#667b89]">{isResponder ? "Your contact details and response activity." : `Your contact details and ${profileRole} account.`}</p></div><Button variant="outline" onClick={startEditing}><Pencil className="h-4 w-4"/>Edit profile</Button></div></div>
    <div className={`grid gap-3 sm:gap-5 ${isResponder ? "lg:grid-cols-[.72fr_1.28fr]" : ""}`}>
      <Panel className="border-0 bg-transparent lg:border-x lg:bg-white">
        <div className="relative flex items-center gap-0 px-4 py-5 text-left sm:block sm:px-6 sm:py-6 sm:text-center">
          <div className="relative -ml-2 flex w-2/5 shrink-0 justify-center after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-gradient-to-b after:from-transparent after:via-[#102b3f] after:to-transparent sm:ml-0 sm:block sm:w-auto sm:after:hidden"><span className="grid h-28 w-28 place-items-center rounded-full bg-[#102b3f] text-lg font-semibold text-white sm:mx-auto sm:h-16 sm:w-16">{user.initials}</span></div>
          <div className="box-border min-w-0 w-3/5 pl-3 sm:w-auto sm:pl-0"><h2 className="truncate text-xl font-semibold text-[#102b3f] sm:mt-4">{user.name}</h2><div className="mt-2 grid gap-1 text-sm text-[#667b89] sm:hidden"><p className="truncate">{user.phone || "Phone not provided"}</p><p className="truncate">{user.email || "Email not provided"}</p><p className="truncate">{user.organisationName || "No organisation assigned"}</p><p className="truncate text-xs">ID: {user.id}</p></div></div>
        </div>
        <div className="hidden divide-y divide-[#e2e8ed] border-t border-[#e2e8ed] sm:block">{fields.map((field) => <div key={field.label} className={detailClass}><span className="mt-0.5 shrink-0 text-[#0f6872]">{field.icon}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">{field.label}</p><p className="mt-1 break-words text-sm font-medium text-[#102b3f]">{field.value}</p></div></div>)}</div>
      </Panel>
      <div className="relative -mt-1 flex justify-center pt-3 lg:hidden"><span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#9aabb5] to-transparent"/><Button className="relative z-10 min-w-44 justify-center px-6" onClick={startEditing}><Pencil className="h-4 w-4"/>Edit profile</Button></div>
      {isResponder ? <Panel className="border-0 bg-transparent lg:border-x lg:bg-white"><PanelHeader className="border-b-0 px-5 pb-5 pt-8 sm:px-6 sm:pt-6" title="Response activity" description="Your assigned work across all recorded missions."/><div className="grid grid-cols-2 divide-x divide-y divide-[#e2e8ed] sm:grid-cols-3 sm:divide-y-0">{[["Total tasks", stats.total], ["Active", stats.active], ["Completed", stats.completed], ["Cancelled", stats.cancelled], ["Declined", stats.rejected]].map(([label, value]) => <div key={label} className="flex items-center gap-3 px-4 py-5 sm:px-5"><ClipboardList className="h-5 w-5 shrink-0 text-[#0f6872]"/><div><p className="text-2xl font-semibold text-[#102b3f]">{value}</p><p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">{label}</p></div></div>)}</div></Panel> : null}
    </div>
    <Sheet open={editing} onOpenChange={(open) => { if (!saving && !passwordBusy) setEditing(open); }} title="Edit profile" description={`Update your ${profileRole} contact details.`} side="right" dismissible={!saving && !passwordBusy} className="h-[100dvh] max-h-[100dvh] max-w-xl">
      <div className="flex min-h-full flex-col"><div className="grid flex-1 content-start gap-5 p-5 sm:p-6">
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">Full name<input autoFocus disabled={saving} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] disabled:opacity-50"/></label>
        <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">Phone<input type="tel" disabled={saving} value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} className="min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] disabled:opacity-50"/></label>
        <div className="rounded-xl border border-[#e2e8ed] p-4 text-sm text-[#667b89]">Email addresses cannot be changed here.<p className="mt-1 font-medium text-[#102b3f]">{user.email || "Email not provided"}</p></div>
        <section className="grid gap-4 border-t border-[#e2e8ed] pt-5"><div><h3 className="flex items-center gap-2 font-semibold text-[#102b3f]"><KeyRound className="h-4 w-4 text-[#0f6872]"/>Change password</h3><p className="mt-1 text-sm leading-6 text-[#667b89]">We will email a one-time code to your account email. Verify it before entering a new password.</p></div><Button onClick={() => { setPasswordError(""); setPasswordMessage(""); setPasswordSheetOpen(true); }} disabled={!user.email || saving || passwordBusy} className="mx-auto min-h-11 min-w-48 justify-center">Change password</Button></section>
      </div><div className="sticky bottom-0 border-t border-[#e2e8ed] bg-white pb-[calc(env(safe-area-inset-bottom)+1rem)]"><div className="flex gap-3 p-4 sm:p-5"><Button variant="outline" className="flex-1" onClick={() => setEditing(false)} disabled={saving || passwordBusy}><X className="h-4 w-4"/>Cancel</Button><Button className="flex-1" onClick={() => void saveProfile()} disabled={saving || passwordBusy}><Check className="h-4 w-4"/>{saving ? "Saving..." : "Save profile"}</Button></div></div></div>
    </Sheet>
    <Sheet open={passwordSheetOpen} onOpenChange={(open) => { if (!passwordBusy) setPasswordSheetOpen(open); }} title="Change password" description="Verify your email before choosing a new password." side="center" dismissible={!passwordBusy}>
      <div className="grid gap-4 p-5 sm:p-6">
        {passwordError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{passwordError}</p> : null}
        <Button variant="outline" onClick={() => void sendPasswordCode()} disabled={passwordBusy} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? "Sending..." : passwordCodeSent ? "Resend code" : "Send verification code"}</Button>
        {passwordCodeSent ? <>
          <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">Email verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={passwordCode} onChange={(event) => { setPasswordCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setPasswordCodeVerified(false); }} disabled={passwordCodeVerified || passwordBusy} placeholder="000000" className="min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-lg tracking-[.35em] outline-none focus:border-b-2 focus:border-[#0f6872] disabled:opacity-60"/></label>
          {!passwordCodeVerified ? <Button variant="outline" onClick={() => void verifyPasswordCode()} disabled={passwordBusy || passwordCode.length !== 6} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? "Verifying..." : "Verify code"}</Button> : null}
          <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">New password<input type="password" autoComplete="new-password" disabled={!passwordCodeVerified || passwordBusy} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Type in here" className="animated-placeholder min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] focus:ring-0 disabled:opacity-50"/></label>
          <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">Confirm new password<input type="password" autoComplete="new-password" disabled={!passwordCodeVerified || passwordBusy} value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Type in here" className="animated-placeholder min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] focus:ring-0 disabled:opacity-50"/></label>
          <p className="text-xs leading-5 text-[#667b89]">Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.</p>
          <Button onClick={() => void changePassword()} disabled={!passwordCodeVerified || passwordBusy || !newPassword || !confirmNewPassword} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? "Changing..." : "Change password"}</Button>
        </> : null}
      </div>
    </Sheet>
  </div>;
}
