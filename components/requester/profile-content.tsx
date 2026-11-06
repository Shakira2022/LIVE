"use client";

import { Check, HeartPulse, KeyRound, Pencil, X, Mail, Phone, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { requesterText, useRequesterLanguage } from "@/lib/requester-ui";
import { RequesterPageHelpButton } from "@/components/requester/requester-page-help-button";
import { api } from "@/lib/middleware/client/api";
import { TopValidationAlert } from "@/components/ui/top-validation-alert";
import { loadRequesterPreferences, readRequesterPreferences } from "@/lib/requester-preferences";

type VoiceNameTarget = "full" | "first" | "surname" | "contact";

function spokenNameText(value: string) {
  const letterNames: Record<string, string> = {
    ay: "A", a: "A", bee: "B", be: "B", see: "C", sea: "C", cee: "C", dee: "D", de: "D", ee: "E", e: "E",
    eff: "F", ef: "F", gee: "G", jee: "G", aitch: "H", haitch: "H", eye: "I", i: "I", jay: "J", kay: "K",
    el: "L", ell: "L", em: "M", en: "N", oh: "O", o: "O", pee: "P", cue: "Q", queue: "Q", are: "R", ar: "R",
    ess: "S", es: "S", tee: "T", tea: "T", you: "U", yu: "U", vee: "V", we: "W", doubleyou: "W",
    ex: "X", axe: "X", why: "Y", wai: "Y", zee: "Z", zed: "Z",
  };
  const prepared = value.trim().replace(/\bdouble\s+you\b/gi, "doubleyou");
  const words = prepared.split(/[\s,]+/).filter(Boolean);
  const spelled = words.length > 1 && words.every((word) => /^[a-z]$/i.test(word) || letterNames[word.toLocaleLowerCase()]);
  if (spelled) {
    const letters = words.map((word) => letterNames[word.toLocaleLowerCase()] ?? word.toLocaleUpperCase()).join("").toLocaleLowerCase();
    return letters.charAt(0).toLocaleUpperCase() + letters.slice(1);
  }
  return prepared.replace(/\s+/g, " ").split(" ").map((word) => word.split("-").map((part) =>
    part ? part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase() : part,
  ).join("-")).join(" ");
}

function replaceNamePart(currentName: string, target: VoiceNameTarget, value: string) {
  const nextValue = spokenNameText(value);
  if (!nextValue || target === "full" || target === "contact") return nextValue;
  const parts = currentName.trim().split(/\s+/).filter(Boolean);
  if (target === "first") return [nextValue, ...parts.slice(1)].join(" ");
  return [...parts.slice(0, -1), nextValue].join(" ");
}

function Detail({ icon, label, value, language }: { icon: React.ReactNode; label: string; value: string; language: ReturnType<typeof useRequesterLanguage> }) {
  return (
    <div className="flex gap-3 px-5 py-4 sm:px-6">
      <span className="mt-0.5 shrink-0 text-[#0f6872]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#748693]">{requesterText(language, label)}</p>
        <p className="mt-1 break-words text-sm font-medium text-[#102b3f]">{value}</p>
      </div>
    </div>
  );
}

function MedicalField({
  label,
  value,
  language,
}: {
  label: string;
  value: string;
  language: ReturnType<typeof useRequesterLanguage>;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-semibold text-[#102b3f]">{label}</p>
      <p className="min-w-0 truncate border-b border-[#dce5ea] py-2 text-[#667b89]">
        {value || requesterText(language, "No medical details added")}
      </p>
    </div>
  );
}

export function RequesterProfileContent({ autoEdit = false, showHelpButton = true }: { autoEdit?: boolean; showHelpButton?: boolean }) {
  const { user, refresh } = useAuth();
  const language = useRequesterLanguage(user?.id ?? "");
  const [blindVoiceGuidance, setBlindVoiceGuidance] = useState(false);
  const [blindGuidanceLoaded, setBlindGuidanceLoaded] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileKeyboardOpen, setProfileKeyboardOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [showValidationAlert, setShowValidationAlert] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Partial<Record<"name" | "phone" | "emergencyContactName" | "emergencyContactPhone" | "conditions" | "allergies" | "medications", string>>>({});
  const [profileDraft, setProfileDraft] = useState({ name: "", phone: "", emergencyContactName: "", emergencyContactPhone: "" });
  const [medicalDraft, setMedicalDraft] = useState({ conditions: "", allergies: "", medications: "" });
  const [activeEditSection, setActiveEditSection] = useState("edit-profile-section");
  const pendingVoiceNameTargetRef = useRef<VoiceNameTarget | null>(null);
  const autoEditHandledRef = useRef(false);
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordCodeSent, setPasswordCodeSent] = useState(false);
  const [passwordCodeVerified, setPasswordCodeVerified] = useState(false);
  const [passwordSheetOpen, setPasswordSheetOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [medicalDetails, setMedicalDetails] = useState({
    conditions: "",
    allergies: "",
    medications: "",
  });

  useEffect(() => {
    const syncBlindGuidance = () => setBlindVoiceGuidance(readRequesterPreferences(user?.id).blindVoiceGuidance);
    syncBlindGuidance();
    if (!user?.id) return;
    let cancelled = false;
    void loadRequesterPreferences(user.id).then((preferences) => {
      if (cancelled) return;
      setBlindVoiceGuidance(preferences.blindVoiceGuidance);
      setBlindGuidanceLoaded(true);
    }).catch(() => {
      if (!cancelled) setBlindGuidanceLoaded(true);
    });
    window.addEventListener("storage", syncBlindGuidance);
    window.addEventListener("live:requester-preferences-changed", syncBlindGuidance);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", syncBlindGuidance);
      window.removeEventListener("live:requester-preferences-changed", syncBlindGuidance);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!editingProfile) {
      setProfileKeyboardOpen(false);
      pendingVoiceNameTargetRef.current = null;
      return;
    }

    const viewport = window.visualViewport;
    const virtualKeyboard = (navigator as Navigator & {
      virtualKeyboard?: {
        boundingRect: DOMRect;
        addEventListener?: (type: "geometrychange", listener: () => void) => void;
        removeEventListener?: (type: "geometrychange", listener: () => void) => void;
      };
    }).virtualKeyboard;
    let baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);

    const updateKeyboardVisibility = () => {
      const visibleHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const reportedKeyboardHeight = virtualKeyboard?.boundingRect.height ?? 0;
      const keyboardOpen = reportedKeyboardHeight >= 80 || baselineHeight - visibleHeight >= 150;
      setProfileKeyboardOpen(keyboardOpen);
      if (!keyboardOpen) baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
    };

    const resetForOrientationChange = () => {
      baselineHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
      setProfileKeyboardOpen(false);
    };

    updateKeyboardVisibility();
    viewport?.addEventListener("resize", updateKeyboardVisibility);
    window.addEventListener("resize", updateKeyboardVisibility);
    virtualKeyboard?.addEventListener?.("geometrychange", updateKeyboardVisibility);
    window.screen.orientation?.addEventListener("change", resetForOrientationChange);

    return () => {
      viewport?.removeEventListener("resize", updateKeyboardVisibility);
      window.removeEventListener("resize", updateKeyboardVisibility);
      virtualKeyboard?.removeEventListener?.("geometrychange", updateKeyboardVisibility);
      window.screen.orientation?.removeEventListener("change", resetForOrientationChange);
    };
  }, [editingProfile]);

  useEffect(() => {
    if (!editingProfile) return;
    const handleProfileVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      const raw = detail?.transcript?.trim().replace(/[.!?]+$/, "");
      if (!detail || !raw) return;
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]',
      )).filter((dialog) => dialog.getClientRects().length > 0);
      const layer = (element: HTMLElement) => {
        let highest = 0;
        let current: HTMLElement | null = element;
        while (current) {
          const value = Number.parseInt(window.getComputedStyle(current).zIndex, 10);
          if (Number.isFinite(value)) highest = Math.max(highest, value);
          current = current.parentElement;
        }
        return highest;
      };
      openDialogs.sort((left, right) => {
        const difference = layer(right) - layer(left);
        if (difference) return difference;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      if (!openDialogs.at(-1)?.classList.contains("requester-profile-edit-sheet")) return;
      const typedInto = raw.match(/^(?:please\s+)?(?:type|enter|set|change|update)\s+(.+?)\s+(?:in|into)\s+(?:my\s+)?(full\s+name|first\s+name|surname|last\s+name|contact\s+name)$/i);
      const command = raw.match(/^(?:please\s+)?(?:spell|say|enter|type|set|change|update)\s+(?:my\s+)?(full\s+name|first\s+name|surname|last\s+name|name|contact\s+name)(?:\s+(?:as|to|is))?(?:\s+(.+))?$/i)
        ?? (typedInto ? [typedInto[0], typedInto[2], typedInto[1]] : null)
        ?? raw.match(/^(?:please\s+)?(?:my\s+)?(full\s+name|first\s+name|surname|last\s+name|name|contact\s+name)\s+is\s+(.+)$/i);
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusedTarget: VoiceNameTarget | null = focused?.id === "requester-profile-name" ? "full"
        : focused?.id === "requester-emergency-contact-name" ? "contact" : null;
      let target: VoiceNameTarget | null = command
        ? /contact\s+name/i.test(command[1]) ? "contact"
          : /surname|last\s+name/i.test(command[1]) ? "surname"
            : /first\s+name/i.test(command[1]) ? "first"
              : "full"
        : pendingVoiceNameTargetRef.current ?? focusedTarget;
      if (!target) return;
      if (!command && /^(?:click|press|tap|open|edit|select|choose|close|dismiss|cancel|save|submit|scroll|next|previous|button|option)\b/i.test(raw)) return;
      detail.consumed = true;
      if (!detail.isFinal) return;

      const value = command?.[2]?.trim() || (!command ? raw : "");
      if (!value) {
        pendingVoiceNameTargetRef.current = target;
        if (target === "contact") {
          setActiveEditSection("edit-emergency-section");
          window.setTimeout(() => document.getElementById("requester-emergency-contact-name")?.focus(), 0);
        } else {
          setActiveEditSection("edit-profile-section");
          window.setTimeout(() => document.getElementById("requester-profile-name")?.focus(), 0);
        }
        return;
      }

      pendingVoiceNameTargetRef.current = null;
      if (target === "contact") {
        setProfileDraft((current) => ({ ...current, emergencyContactName: spokenNameText(value) }));
        setActiveEditSection("edit-emergency-section");
      } else {
        setProfileDraft((current) => ({ ...current, name: replaceNamePart(current.name, target!, value) }));
        setActiveEditSection("edit-profile-section");
      }
      window.setTimeout(() => {
        document.getElementById(target === "contact" ? "requester-emergency-contact-name" : "requester-profile-name")?.focus();
      }, 0);
    };
    window.addEventListener("live:requester-voice-input", handleProfileVoiceInput);
    return () => window.removeEventListener("live:requester-voice-input", handleProfileVoiceInput);
  }, [editingProfile]);

  useEffect(() => {
    if (autoEdit && blindGuidanceLoaded && user?.id && !autoEditHandledRef.current) {
      autoEditHandledRef.current = true;
      if (!blindVoiceGuidance) startEditingProfile();
    }
  }, [autoEdit, blindGuidanceLoaded, blindVoiceGuidance, user?.id]);

  useEffect(() => {
    let cancelled = false;
    try {
      const saved = window.localStorage.getItem("live-medical-details-v1");
      if (saved) {
        const cached = JSON.parse(saved);
        setMedicalDetails((current) => ({ ...current, ...cached }));
        setMedicalDraft((current) => ({ ...current, ...cached }));
      }
    } catch {
      // Local profile details are optional and must not block the profile page.
    }
    void api<{ medicalConditions: string; allergies: string; medications: string }>("/api/requester/profile")
      .then((saved) => {
        if (cancelled) return;
        const details = { conditions: saved.medicalConditions, allergies: saved.allergies, medications: saved.medications };
        setMedicalDetails(details);
        setMedicalDraft(details);
        window.localStorage.setItem("live-medical-details-v1", JSON.stringify(details));
      })
      .catch(() => {
        // Keep any locally cached details visible if the server is temporarily unavailable.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showValidationAlert || Object.keys(validationErrors).length === 0) return;
    const timeout = window.setTimeout(() => setShowValidationAlert(false), 6000);
    return () => window.clearTimeout(timeout);
  }, [showValidationAlert, validationErrors]);

  useEffect(() => {
    if (!profileError) return;
    const timeout = window.setTimeout(() => setProfileError(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [profileError]);

  useEffect(() => {
    if (!passwordMessage) return;
    const timeout = window.setTimeout(() => setPasswordMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [passwordMessage]);

  function startEditingProfile() {
    if (!user) return;
    setProfileDraft({ name: user.name, phone: user.phone, emergencyContactName: user.emergencyContactName ?? "", emergencyContactPhone: user.emergencyContactPhone ?? "" });
    setMedicalDraft(medicalDetails);
    setProfileError("");
    setActiveEditSection("edit-profile-section");
    setPasswordCode("");
    setPasswordCodeSent(false);
    setPasswordCodeVerified(false);
    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordMessage("");
    setPasswordError("");
    setEditingProfile(true);
  }

  function goToEditSection(id: string) {
    setActiveEditSection(id);
    const scrollArea = document.getElementById(activeEditSection)?.closest<HTMLElement>("[data-live-keyboard-scroll-area]");
    // A mobile keyboard dismissal can restore its previous scroll snapshot after
    // the tab click. Reset after that restoration so the new section starts at top.
    window.setTimeout(() => {
      window.requestAnimationFrame(() => scrollArea?.scrollTo({ top: 0, behavior: "auto" }));
    }, 300);
  }

  async function sendPasswordCode() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      await api("/api/requester/profile/password-code", { method: "POST", body: {} });
      setPasswordCodeSent(true);
      setPasswordCodeVerified(false);
      setPasswordMessage(requesterText(language, "A verification code was sent."));
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : requesterText(language, "Unable to send a verification code."));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function verifyPasswordCode() {
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordMessage("");
    try {
      await api("/api/requester/profile/password-code/verify", { method: "POST", body: { code: passwordCode } });
      setPasswordCodeVerified(true);
      setPasswordMessage(requesterText(language, "Code verified. You can now choose a new password."));
    } catch (error) {
      setPasswordCodeVerified(false);
      setPasswordError(error instanceof Error ? error.message : requesterText(language, "That code could not be verified."));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError(requesterText(language, "Use at least 10 characters with an uppercase letter, a lowercase letter, and a number."));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(requesterText(language, "The passwords do not match."));
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
      setPasswordMessage(requesterText(language, "Your password was changed successfully."));
    } catch (error) {
      setPasswordCodeVerified(false);
      setPasswordError(error instanceof Error ? error.message : requesterText(language, "Unable to change your password."));
    } finally {
      setPasswordBusy(false);
    }
  }

  function clearValidationError(field: keyof typeof validationErrors) {
    setValidationErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function saveProfile() {
    const nextErrors: typeof validationErrors = {};
    if (profileDraft.name.trim().length < 2) nextErrors.name = requesterText(language, "Full name");
    if (!profileDraft.phone.trim() || !/^\+?[0-9][0-9\s-]{6,18}$/.test(profileDraft.phone.trim())) nextErrors.phone = requesterText(language, "Phone");
    const hasContactName = Boolean(profileDraft.emergencyContactName.trim());
    const hasContactPhone = Boolean(profileDraft.emergencyContactPhone.trim());
    if (!hasContactName) nextErrors.emergencyContactName = requesterText(language, "Contact name");
    if (!hasContactPhone) nextErrors.emergencyContactPhone = requesterText(language, "Contact number");
    if (!medicalDraft.conditions.trim()) nextErrors.conditions = requesterText(language, "Medical conditions");
    if (!medicalDraft.allergies.trim()) nextErrors.allergies = requesterText(language, "Allergies");
    if (!medicalDraft.medications.trim()) nextErrors.medications = requesterText(language, "Current medication");
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setProfileError("");
      setShowValidationAlert(true);
      setActiveEditSection(nextErrors.name || nextErrors.phone ? "edit-profile-section" : "edit-emergency-section");
      return;
    }
    setSavingProfile(true);
    setProfileError("");
    try {
      await api("/api/requester/profile", {
        method: "PATCH",
        body: {
          ...profileDraft,
          medicalConditions: medicalDraft.conditions,
          allergies: medicalDraft.allergies,
          medications: medicalDraft.medications,
        },
      });
      window.localStorage.setItem("live-medical-details-v1", JSON.stringify(medicalDraft));
      setMedicalDetails(medicalDraft);
      await refresh();
      setEditingProfile(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : requesterText(language, "Could not save your profile. Try again."));
    } finally {
      setSavingProfile(false);
    }
  }

  if (!user) return null;

  const userAddress =
    "address" in user && typeof user.address === "string" && user.address.trim()
      ? user.address
      : requesterText(language, "Address not provided");

  return (
    <div className="grid gap-3 sm:gap-5">
      <TopValidationAlert
        open={showValidationAlert && Object.keys(validationErrors).length > 0}
        onClose={() => setShowValidationAlert(false)}
        items={Object.values(validationErrors)}
      />
      {typeof document !== "undefined" ? createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[10000] flex flex-col items-center gap-2 px-4">
          <AnimatePresence>
            {passwordMessage ? (
              <motion.div key="profile-password-success" role="status" aria-live="polite" initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.2, ease: "easeOut" }} className="pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-xl">
                <p>{passwordMessage}</p>
                <button type="button" onClick={() => setPasswordMessage("")} aria-label={requesterText(language, "Dismiss")} className="-mr-1 -mt-1 rounded-full p-1 hover:bg-emerald-100"><X className="h-5 w-5" /></button>
              </motion.div>
            ) : null}
            {profileError ? (
              <motion.div key="profile-error-alert" role="alert" aria-live="assertive" initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.2, ease: "easeOut" }} className="pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-red-800 shadow-xl">
                <p>{profileError}</p>
                <button type="button" onClick={() => setProfileError("")} aria-label={requesterText(language, "Dismiss")} className="-mr-1 -mt-1 rounded-full p-1 text-[#667b89] hover:bg-[#eef3f5]"><X className="h-5 w-5" /></button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>, document.body,
      ) : null}
      <div className="hidden sm:block">
        <PageHeading
          title={requesterText(language, "Emergency profile")}
          description={requesterText(language, "The contact details below are included automatically with a request, so you do not need to re-enter them in an emergency.")}
          action={
            <div className="flex items-center gap-2">
              {showHelpButton ? <RequesterPageHelpButton page="profile" language={language} /> : null}
              {!blindVoiceGuidance ? <Button variant="outline" onClick={startEditingProfile}>
                <Pencil className="h-4 w-4" />{requesterText(language, "Edit profile")}
              </Button> : null}
            </div>
          }
        />
      </div>

      <div className="grid gap-3 sm:gap-5 lg:grid-cols-[.72fr_1.28fr]">
        <Panel className="border-0 bg-transparent lg:border-x lg:bg-white">
          <div className="relative flex items-center gap-0 px-4 py-5 text-left sm:block sm:px-6 sm:py-6 sm:text-center">
            <div className="relative -ml-2 flex w-2/5 shrink-0 justify-center after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-gradient-to-b after:from-transparent after:via-[#102b3f] after:to-transparent sm:ml-0 sm:block sm:w-auto sm:after:hidden">
              <span className="grid h-28 w-28 place-items-center rounded-full bg-[#102b3f] text-lg font-semibold text-white sm:mx-auto sm:h-16 sm:w-16">{user.initials}</span>
            </div>
            <div className="box-border min-w-0 w-3/5 pl-3 sm:w-auto sm:pl-0">
              <h2 className="mt-0 truncate text-xl font-semibold text-[#102b3f] sm:mt-4">{user.name}</h2>
              <div className="mt-2 grid gap-1 text-sm text-[#667b89] sm:hidden">
                <p className="truncate">{user.phone || requesterText(language, "Phone not provided")}</p>
                <p className="truncate">{user.email || requesterText(language, "Email not provided")}</p>
                <p className="truncate">{userAddress}</p>
                <p className="truncate text-xs">ID: {user.id}</p>
              </div>
            </div>
          </div>
          <div className="hidden divide-y divide-[#e2e8ed] border-t border-[#e2e8ed] sm:block">
            <Detail icon={<Mail className="h-5 w-5" />} label="Email" value={user.email} language={language} />
            <Detail icon={<Phone className="h-5 w-5" />} label="Callback number" value={user.phone} language={language} />
          </div>
        </Panel>

        <div className="relative -mt-1 flex justify-center gap-2 pt-3 md:hidden">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#9aabb5] to-transparent" />
          {showHelpButton ? <RequesterPageHelpButton page="profile" language={language} /> : null}
          {!blindVoiceGuidance ? <Button onClick={startEditingProfile} className="relative z-10 min-w-44 justify-center px-6">
            <Pencil className="h-4 w-4" />{requesterText(language, "Edit profile")}
          </Button> : null}
        </div>

        <Panel className="border-0 bg-transparent lg:border-x lg:bg-white">
          <PanelHeader title={requesterText(language, "Emergency contact")} description={requesterText(language, "Used by the response team when it is appropriate to contact someone on your behalf.")} />
          <div className="divide-y divide-[#e2e8ed]">
            <Detail icon={<UserRound className="h-5 w-5" />} label="Contact name" value={user.emergencyContactName || requesterText(language, "Not provided")} language={language} />
            <Detail icon={<Phone className="h-5 w-5" />} label="Contact number" value={user.emergencyContactPhone || requesterText(language, "Not provided")} language={language} />
          </div>
        </Panel>

        <Panel className="border-0 bg-transparent lg:col-span-2 lg:border-x lg:bg-white">
          <div className="flex gap-3 border-b border-[#e2e8ed] px-5 py-4 sm:px-6">
            <HeartPulse className="mt-0.5 h-5 w-5 shrink-0 text-[#0f6872]" />
            <div>
              <h2 className="font-semibold text-[#102b3f]">{requesterText(language, "Important medical details")}</h2>
              <p className="mt-1 text-sm text-[#667b89]">{requesterText(language, "Optional details that may help responders.")}</p>
            </div>
          </div>
          <div className="grid gap-4 px-5 py-5 pl-16 sm:grid-cols-3 sm:px-6 sm:pl-20">
            <MedicalField language={language} label={requesterText(language, "Medical conditions")} value={medicalDetails.conditions} />
            <MedicalField language={language} label={requesterText(language, "Allergies")} value={medicalDetails.allergies} />
            <MedicalField language={language} label={requesterText(language, "Current medication")} value={medicalDetails.medications} />
          </div>
        </Panel>
      </div>
      <Sheet
        open={editingProfile}
        onOpenChange={(open) => { if (!savingProfile && !passwordBusy) setEditingProfile(open); }}
        title={requesterText(language, "Edit profile")}
        description={requesterText(language, "Update your contact and medical details.")}
        side="right"
        dismissible={!savingProfile && !passwordBusy}
        scrollAreaClassName="pb-0"
        className="requester-profile-edit-sheet h-[100dvh] max-h-[100dvh] max-w-xl"
        footerClassName={profileKeyboardOpen ? "hidden" : "md:hidden"}
        footer={<div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setEditingProfile(false)} disabled={savingProfile || passwordBusy}><X className="h-4 w-4" />{requesterText(language, "Cancel")}</Button>
          <Button className="flex-1" onClick={() => void saveProfile()} disabled={savingProfile || passwordBusy}><Check className="h-4 w-4" />{requesterText(language, savingProfile ? "Saving..." : "Save profile")}</Button>
        </div>}
      >
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-30 shrink-0 border-b border-[#e2e8ed] bg-white">
            <nav aria-label={requesterText(language, "Profile sections")} className="grid grid-cols-2 px-2">
              {[["edit-profile-section", "Profile"], ["edit-emergency-section", "Emergency & medical"]].map(([id, label]) => {
                const isActive = activeEditSection === id;
                return <button key={id} type="button" onClick={() => goToEditSection(id)} disabled={savingProfile || passwordBusy} aria-current={isActive ? "page" : undefined} className={`min-h-12 border-b-2 px-1 pt-2 text-center text-[11px] font-bold transition disabled:opacity-50 ${isActive ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#6e8492]"}`}>{requesterText(language, label)}</button>;
              })}
            </nav>
          </div>
          <div className="grid flex-1 content-start gap-5 px-5 pt-3 pb-5 sm:px-6 sm:pt-4 sm:pb-6">
            <section id="edit-profile-section" className={activeEditSection === "edit-profile-section" ? "grid gap-5 profile-tab-enter" : "hidden"}>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Full name")}<input id="requester-profile-name" autoFocus disabled={savingProfile} aria-invalid={Boolean(validationErrors.name)} value={profileDraft.name} onChange={(event) => { setProfileDraft((current) => ({ ...current, name: event.target.value })); clearValidationError("name"); }} placeholder="Type in here" className={`animated-placeholder min-h-11 rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.name ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /><span className="text-xs font-normal leading-5 text-[#71838e]">Voice tip: say “spell name” or “spell surname”, then speak the name or letters.</span></label>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Phone")}<input type="tel" required disabled={savingProfile} aria-invalid={Boolean(validationErrors.phone)} value={profileDraft.phone} onChange={(event) => { setProfileDraft((current) => ({ ...current, phone: event.target.value })); clearValidationError("phone"); }} placeholder="Type in here" className={`animated-placeholder min-h-11 rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.phone ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
              <div className="rounded-xl border border-[#e2e8ed] p-4 text-sm text-[#667b89]">{requesterText(language, "Email addresses cannot be changed here.")}<p className="mt-1 font-medium text-[#102b3f]">{user.email || requesterText(language, "Email not provided")}</p></div>
              <section className="grid gap-4 border-t border-[#e2e8ed] pt-5">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold text-[#102b3f]"><KeyRound className="h-4 w-4 text-[#0f6872]" />{requesterText(language, "Change password")}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#667b89]">{requesterText(language, "We will email a one-time code to your account email. Verify it before entering a new password.")}</p>
                </div>
                <Button onClick={() => setPasswordSheetOpen(true)} disabled={!user.email || savingProfile || passwordBusy} className="mx-auto min-h-11 min-w-48 justify-center">{requesterText(language, "Change password")}</Button>
              </section>
            </section>
            <section id="edit-emergency-section" className={activeEditSection === "edit-emergency-section" ? "grid gap-5 profile-tab-enter" : "hidden"}>
              <div>
              <h3 className="font-semibold text-[#102b3f]">{requesterText(language, "Emergency contact")}</h3>
              <p className="mt-1 text-sm leading-6 text-[#667b89]">{requesterText(language, "Used by the response team when it is appropriate to contact someone on your behalf.")}</p>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Contact name")}<input id="requester-emergency-contact-name" required disabled={savingProfile} aria-invalid={Boolean(validationErrors.emergencyContactName)} value={profileDraft.emergencyContactName} onChange={(event) => { setProfileDraft((current) => ({ ...current, emergencyContactName: event.target.value })); clearValidationError("emergencyContactName"); }} placeholder="Type in here" className={`animated-placeholder min-h-11 rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.emergencyContactName ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Contact number")}<input type="tel" required disabled={savingProfile} aria-invalid={Boolean(validationErrors.emergencyContactPhone)} value={profileDraft.emergencyContactPhone} onChange={(event) => { setProfileDraft((current) => ({ ...current, emergencyContactPhone: event.target.value })); clearValidationError("emergencyContactPhone"); }} placeholder="Type in here" className={`animated-placeholder min-h-11 rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.emergencyContactPhone ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
            <div className="grid gap-5 border-t border-[#e2e8ed] pt-5">
              <div>
                <h3 className="font-semibold text-[#102b3f]">{requesterText(language, "Important medical details")}</h3>
                <p className="mt-1 text-sm leading-6 text-[#667b89]">{requesterText(language, "Optional details that may help responders.")}</p>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Medical conditions")}<textarea required disabled={savingProfile} aria-invalid={Boolean(validationErrors.conditions)} rows={2} value={medicalDraft.conditions} onChange={(event) => { setMedicalDraft((current) => ({ ...current, conditions: event.target.value })); clearValidationError("conditions"); }} placeholder="Enter details, or type None" className={`resize-y rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.conditions ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Allergies")}<textarea required disabled={savingProfile} aria-invalid={Boolean(validationErrors.allergies)} rows={2} value={medicalDraft.allergies} onChange={(event) => { setMedicalDraft((current) => ({ ...current, allergies: event.target.value })); clearValidationError("allergies"); }} placeholder="Enter details, or type None" className={`resize-y rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.allergies ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
              <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Current medication")}<textarea required disabled={savingProfile} aria-invalid={Boolean(validationErrors.medications)} rows={2} value={medicalDraft.medications} onChange={(event) => { setMedicalDraft((current) => ({ ...current, medications: event.target.value })); clearValidationError("medications"); }} placeholder="Enter details, or type None" className={`resize-y rounded-none border-0 border-b bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:ring-0 disabled:opacity-50 ${validationErrors.medications ? "border-red-500 focus:border-red-500" : "border-[#dce5ea] focus:border-[#0f6872]"}`} /></label>
            </div>
            </section>
          </div>
          <div className="sticky bottom-0 z-30 hidden shrink-0 border-t border-[#e2e8ed] bg-white pb-[calc(env(safe-area-inset-bottom)+1rem)] md:block">
            <div className="flex gap-3 px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
              <Button variant="outline" className="flex-1" onClick={() => setEditingProfile(false)} disabled={savingProfile || passwordBusy}><X className="h-4 w-4" />{requesterText(language, "Cancel")}</Button>
              <Button className="flex-1" onClick={() => void saveProfile()} disabled={savingProfile || passwordBusy}><Check className="h-4 w-4" />{requesterText(language, savingProfile ? "Saving..." : "Save profile")}</Button>
            </div>
          </div>
        </div>
      </Sheet>
      <Sheet
        open={passwordSheetOpen}
        onOpenChange={(open) => { if (!passwordBusy) setPasswordSheetOpen(open); }}
        title={requesterText(language, "Change password")}
        description={requesterText(language, "Verify your email before choosing a new password.")}
        side="center"
        dismissible={!passwordBusy}
      >
        <div className="grid gap-4 p-5 sm:p-6">
          {passwordError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{passwordError}</p> : null}
          <Button variant="outline" onClick={() => void sendPasswordCode()} disabled={passwordBusy} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? requesterText(language, "Sending...") : passwordCodeSent ? requesterText(language, "Resend code") : requesterText(language, "Send verification code")}</Button>
          {passwordCodeSent ? <>
            <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Email verification code")}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={passwordCode} onChange={(event) => { setPasswordCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setPasswordCodeVerified(false); }} disabled={passwordCodeVerified || passwordBusy} placeholder="000000" className="min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-lg tracking-[.35em] outline-none focus:border-b-2 focus:border-[#0f6872] disabled:opacity-60" /></label>
            {!passwordCodeVerified ? <Button variant="outline" onClick={() => void verifyPasswordCode()} disabled={passwordBusy || passwordCode.length !== 6} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? requesterText(language, "Verifying...") : requesterText(language, "Verify code")}</Button> : null}
            <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "New password")}<input type="password" autoComplete="new-password" disabled={!passwordCodeVerified || passwordBusy} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Type in here" className="animated-placeholder min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] focus:ring-0 disabled:opacity-50" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-[#102b3f]">{requesterText(language, "Confirm new password")}<input type="password" autoComplete="new-password" disabled={!passwordCodeVerified || passwordBusy} value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Type in here" className="animated-placeholder min-h-11 rounded-none border-0 border-b border-[#dce5ea] bg-transparent px-0 py-2 text-center text-sm font-normal outline-none focus:border-b-2 focus:border-[#0f6872] focus:ring-0 disabled:opacity-50" /></label>
            <p className="text-xs leading-5 text-[#667b89]">{requesterText(language, "Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.")}</p>
            <Button onClick={() => void changePassword()} disabled={!passwordCodeVerified || passwordBusy || !newPassword || !confirmNewPassword} className="mx-auto min-h-11 min-w-48 justify-center">{passwordBusy ? requesterText(language, "Changing...") : requesterText(language, "Change password")}</Button>
          </> : null}
        </div>
      </Sheet>
    </div>
  );
}
