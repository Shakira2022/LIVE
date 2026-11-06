"use client";

import { Check, Mic, MicOff, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { requesterText } from "@/lib/requester-ui";
import type { RequesterLanguage } from "@/lib/requester-language";
import { readRequesterPreferences, saveRequesterPreferences } from "@/lib/requester-preferences";
import { useAuth } from "@/components/auth/auth-provider";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };
type RecognitionEvent = Event & { results: ArrayLike<RecognitionResult>; resultIndex: number };
type RecognitionErrorEvent = Event & { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionConstructor = new () => Recognition;

type ServiceRequestAction = "request-medical" | "request-fire" | "request-police";
type VoiceAction = "home" | "help" | "open-help" | "request-form" | "history" | "notifications" | "profile" | "edit-profile" | "settings" | "tracking" | "ai" | "navigation" | "page-help" | "open-accessibility" | "open-account-menu" | "open-unread-request" | "open-history-request" | "open-notification" | "read-notifications" | "cancel-request" | "call-driver" | "call-dispatcher" | "undo" | "cancel" | ServiceRequestAction;
type NavigationAction = Exclude<VoiceAction, "navigation" | "open-help" | "edit-profile" | "page-help" | "open-accessibility" | "open-account-menu" | "open-unread-request" | "open-history-request" | "open-notification" | "read-notifications" | "cancel-request" | "call-driver" | "call-dispatcher" | "undo" | "cancel" | ServiceRequestAction>;
type SafeInterimAction = NavigationAction | "open-help" | "edit-profile" | "navigation" | "page-help" | "open-accessibility" | "open-account-menu" | "cancel-request" | ServiceRequestAction;
type Proposal = { transcript: string; action: VoiceAction };

const LANGUAGE_TAG: Record<RequesterLanguage, string> = {
  English: "en-ZA", Afrikaans: "af-ZA", isiZulu: "zu-ZA", isiXhosa: "xh-ZA", Sesotho: "st-ZA",
  Setswana: "tn-ZA", Sepedi: "nso-ZA", siSwati: "ss-ZA", Tshivenda: "ve-ZA", isiNdebele: "nr-ZA", XiTsonga: "ts-ZA",
};

function normalizeCommand(value: string) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

const BLIND_VOICEOVER_STOP_COMMAND = /^(?:please )?(?:stop|stop speaking|stop reading|be quiet|pause reading|quiet)$/;
const BLIND_VOICEOVER_RESULT_COOLDOWN_MS = 500;

function isBlindVoiceoverPlaying(userId?: string) {
  if (typeof window === "undefined" || !readRequesterPreferences(userId).blindVoiceGuidance || !("speechSynthesis" in window)) return false;
  return window.speechSynthesis.speaking || window.speechSynthesis.pending;
}

type DialogVoiceCommand = { kind: "next" | "previous" | "select" | "close" | "scroll-up" | "scroll-down" | "scroll-top" | "scroll-bottom" | "activate-label"; index?: number; label?: string };

const SPOKEN_NUMBERS: Record<string, number> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5,
  six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
  eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14,
  fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18,
  nineteen: 19, nineteenth: 19, twenty: 20, twentieth: 20,
};

function numberedButtonIndex(spoken: string) {
  const match = spoken.match(/^(?:(?:please )?(?:click(?: on)?|press|tap|open|activate|select|choose) )?(?:the )?(?:button|action|item|option|choice) (?:number )?(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth|eleven|eleventh|twelve|twelfth|thirteen|thirteenth|fourteen|fourteenth|fifteen|fifteenth|sixteen|sixteenth|seventeen|seventeenth|eighteen|eighteenth|nineteen|nineteenth|twenty|twentieth|[1-9]|1[0-9]|20)$/);
  return match ? SPOKEN_NUMBERS[match[1]] ?? Number(match[1]) : null;
}

function getTopmostVoiceDialog() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]',
  ))
    .filter((dialog) => dialog.getClientRects().length > 0);
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
  dialogs.sort((left, right) => {
    const layerDifference = layer(right) - layer(left);
    if (layerDifference) return layerDifference;
    const priorityDifference = Number(right.getAttribute("role") === "alertdialog") - Number(left.getAttribute("role") === "alertdialog");
    if (priorityDifference) return priorityDifference;
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return dialogs.at(-1) ?? null;
}

function getDialogVoiceControls(dialog: HTMLElement) {
  const isUsable = (element: HTMLElement) => element.getClientRects().length > 0
    && !element.matches(":disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !element.closest('[aria-hidden="true"]');
  const focusable = Array.from(new Set(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="radio"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [tabindex]:not([tabindex="-1"]), [data-live-voice-option]',
  ))).filter(isUsable);
  const getLabel = (element: HTMLElement) => voiceControlLabel(element);
  const closeControls = focusable.filter((element) => /\b(?:close|dismiss|cancel dialog)\b/.test(getLabel(element)));
  const priorityOptions = focusable.filter((element) => element.matches("[data-live-voice-option]"));
  const controls = [...priorityOptions, ...focusable.filter((element) => !priorityOptions.includes(element) && !closeControls.includes(element)), ...closeControls];
  return Array.from(new Set(controls));
}

function voiceControlLabel(element: HTMLElement) {
  const associatedLabels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? Array.from(element.labels ?? []).map((label) => label.textContent ?? "").join(" ")
    : "";
  return normalizeCommand(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${associatedLabels} ${element.textContent ?? ""}`);
}

function dictateToFocusedField(transcript: string) {
  const text = transcript.trim();
  const element = document.activeElement;
  if (!text || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element.disabled || element.readOnly || element.closest('[aria-hidden="true"]')) return false;
  if (element instanceof HTMLInputElement && !["text", "search", "tel", "email", "url", "number"].includes(element.type)) return false;

  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  const nextValue = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
  const setter = element instanceof HTMLInputElement
    ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    : Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, nextValue);
  element.setSelectionRange(start + text.length, start + text.length);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function selectNativeOption(spoken: string, scope: ParentNode = document) {
  const requested = normalizeCommand(spoken.replace(/^(?:please )?(?:select|choose|pick|set|use) (?:the )?(?:option )?/, ""));
  if (!requested) return false;
  const selects = Array.from(scope.querySelectorAll<HTMLSelectElement>("select:not([disabled])"))
    .filter((select) => select.getClientRects().length > 0 && select.getAttribute("aria-disabled") !== "true");
  const matches = selects.flatMap((select) => Array.from(select.options)
    .filter((option) => !option.disabled && option.value !== "")
    .map((option) => ({ select, option, label: normalizeCommand(option.textContent ?? "") }))
    .filter(({ label }) => label === requested || label.includes(requested) || requested.includes(label)));
  const exact = matches.filter(({ label }) => label === requested);
  const match = exact.length === 1 ? exact[0] : exact.length === 0 && matches.length === 1 ? matches[0] : null;
  if (!match) return false;
  match.select.value = match.option.value;
  match.select.dispatchEvent(new Event("input", { bubbles: true }));
  match.select.dispatchEvent(new Event("change", { bubbles: true }));
  match.select.focus({ preventScroll: true });
  return true;
}

function activateVoiceToggle(control: HTMLElement, spoken: string) {
  if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
    const phrase = normalizeCommand(spoken);
    const desired = /\b(?:uncheck|disable|turn off|switch off)\b/.test(phrase) ? false
      : /\b(?:check|enable|turn on|switch on)\b/.test(phrase) ? true : null;
    if (desired === null || control.checked !== desired) control.click();
    return;
  }
  control.focus({ preventScroll: true });
  control.click();
}

function adjustVoiceRange(spoken: string, scope: ParentNode = document) {
  const match = spoken.match(/^(?:please )?(increase|raise|brighten|decrease|lower|dim|set|make) (?:the )?(.+?)(?: to (\d{1,3})(?: percent|%)?)?$/);
  if (!match) return false;
  const [, verb, requestedRaw, amount] = match;
  const requested = normalizeCommand(requestedRaw.replace(/\s+(?:slider|range|control)$/, ""));
  const ranges = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="range"]'))
    .filter((range) => range.getClientRects().length > 0 && !range.disabled && range.getAttribute("aria-disabled") !== "true");
  const matches = ranges.filter((range) => {
    const label = voiceControlLabel(range);
    return label === requested || label.includes(requested) || requested.includes(label);
  });
  if (matches.length !== 1) return false;
  const range = matches[0];
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const step = Number(range.step || 1);
  let next = amount != null ? min + (max - min) * (Number(amount) / 100)
    : Number(range.value) + (verb === "increase" || verb === "raise" || verb === "brighten" ? step : -step);
  next = Math.min(max, Math.max(min, next));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(range, String(next));
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  range.focus({ preventScroll: true });
  return true;
}

function namedVoiceTarget(spoken: string) {
  const match = spoken.match(/^(?:please )?(click(?: on)?|press|tap|activate|open|call|phone|contact|edit|select|choose|use|save|cancel|submit|continue|check|uncheck|enable|disable|turn on|turn off) (?:the )?(?:(?:button|tab|link|option|control|field|input) )?(?:(?:called|named|that says) )?(.+)$/);
  if (!match?.[2]) return null;
  const verb = match[1].replace(" on", "");
  const label = match[2].trim().replace(/\s+(?:button|tab|link|option|control|field|input)$/, "");
  return ["edit", "save", "cancel", "submit", "continue", "check", "uncheck", "enable", "disable", "turn on", "turn off"].includes(verb) ? `${verb} ${label}` : label;
}

function voiceTargetLabel(target: string) {
  return normalizeCommand(target.replace(/^(?:edit|save|cancel|submit|continue|check|uncheck|enable|disable|turn on|turn off) /, ""));
}

function clearGeneratedDialogVoiceNumbers() {
  document.querySelectorAll<HTMLElement>('[data-live-voice-dialog-control="true"]').forEach((control) => {
    if (control.dataset.liveVoiceHadNumber === "true") control.dataset.liveVoiceNumber = control.dataset.liveVoiceOriginalNumber ?? "";
    else delete control.dataset.liveVoiceNumber;
    delete control.dataset.liveVoiceOriginalNumber;
    delete control.dataset.liveVoiceHadNumber;
    delete control.dataset.liveVoiceDialogNumber;
    delete control.dataset.liveVoiceDialogControl;
  });
  document.querySelectorAll<HTMLElement>('[data-live-voice-dialog-number="true"]').forEach((control) => {
    delete control.dataset.liveVoiceDialogNumber;
    delete control.dataset.liveVoiceNumber;
  });
}

function dialogVoiceCommand(spoken: string): DialogVoiceCommand | null {
  if (/^(?:go back|back|keep (?:the )?request active|close|dismiss|close it|close this|close details|close request details|close notification details|close (?:the )?(?:account )?menu|dismiss (?:the )?(?:account )?menu|hide (?:the )?(?:account )?menu)$/.test(spoken)
    || /^(?:(?:please )?(?:click(?: on)?|press|tap|select|choose) )?(?:the )?(?:close|x|cross)(?: button)?$/.test(spoken)) return { kind: "close" };
  if (/^(?:please )?(?:close|dismiss|exit) (?:this )?(?:dialog|sheet|pop up|popup|window)$/.test(spoken)
    || /^(?:please )?(?:close|dismiss|exit) (?:the )?(?:dialog|sheet|pop up|popup|window)$/.test(spoken)) return { kind: "close" };
  if (/^(?:please )?(?:scroll )?(?:to )?(?:the )?(?:top|start)(?: of (?:the )?(?:page|sheet|list|content))?$/.test(spoken)
    || /^(?:please )?scroll up(?: more| a little| one page)?$/.test(spoken)) return { kind: spoken.includes("scroll up") ? "scroll-up" : "scroll-top" };
  if (/^(?:please )?(?:scroll )?(?:to )?(?:the )?(?:bottom|end)(?: of (?:the )?(?:page|sheet|list|content))?$/.test(spoken)
    || /^(?:please )?scroll down(?: more| a little| one page)?$/.test(spoken)) return { kind: spoken.includes("scroll down") ? "scroll-down" : "scroll-bottom" };
  if (/^(?:next|next option|next choice|next item|move down|move to next option)$/.test(spoken)) return { kind: "next" };
  if (/^(?:previous|previous option|previous choice|previous item|last option|move up|move to previous option)$/.test(spoken)) return { kind: "previous" };
  const buttonIndex = numberedButtonIndex(spoken);
  if (buttonIndex) return { kind: "select", index: buttonIndex };
  const namedTarget = namedVoiceTarget(spoken);
  if (namedTarget) return { kind: "activate-label", label: namedTarget };
  const numberPattern = "one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth|eleven|eleventh|twelve|twelfth|thirteen|thirteenth|fourteen|fourteenth|fifteen|fifteenth|sixteen|sixteenth|seventeen|seventeenth|eighteen|eighteenth|nineteen|nineteenth|twenty|twentieth|[1-9]|1[0-9]|20";
  const ordinal = spoken.match(new RegExp(`^(?:(?:select|choose|pick|activate) (?:the )?)?(?:option|choice|answer) (?:number )?(${numberPattern})$`))
    ?? spoken.match(new RegExp(`^(?:select|choose|pick|activate) (?:the )?(${numberPattern}) (?:option|choice|answer|one)$`))
    ?? spoken.match(new RegExp(`^(?:the )?(${numberPattern}) (?:option|choice|answer|one)$`))
    ?? spoken.match(new RegExp(`^(?:select|choose|pick|activate) (${numberPattern})$`))
    ?? spoken.match(new RegExp(`^(${numberPattern})$`));
  if (ordinal) return { kind: "select", index: SPOKEN_NUMBERS[ordinal[1]] ?? Number(ordinal[1]) };
  if (/^(?:select|choose|pick|activate)$/.test(spoken)) return { kind: "select" };
  return null;
}

const NAVIGATION_ALIASES: Record<NavigationAction, string[]> = {
  home: ["home", "home page", "homepage", "main", "main page", "main screen", "start page", "dashboard", "requester home"],
  help: ["help", "help me", "i need help", "i need emergency help", "request help", "emergency", "emergency form", "help form", "request form", "emergency help", "emergency assistance", "request emergency help", "request emergency assistance", "get help", "get emergency help", "ask for help", "new request", "new emergency", "new emergency request", "create request", "create a request", "make a request", "start a request", "report an emergency", "send an emergency request"],
  "request-form": ["request form", "emergency request form", "request assistance"],
  history: ["history", "request history", "my history", "my request history", "past request history", "requests", "my requests", "request list", "request records", "past requests", "previous request", "previous requests", "previous emergency requests", "old requests"],
  notifications: ["notification", "notifications", "my notifications", "alerts", "my alerts", "updates", "my updates", "messages"],
  profile: ["profile", "my profile", "account", "my account", "account details", "personal details", "personal info", "my details"],
  settings: ["settings", "my settings", "preferences", "my preferences", "options", "voice settings", "voice controls"],
  tracking: ["tracking", "request tracking", "track request", "track my request", "track my emergency", "follow my request", "follow my responder", "where is my driver", "where is my responder", "my tracking", "current request", "active request", "request status", "current request status", "check status", "live map", "live location", "map"],
  ai: ["ai", "open ai", "open live ai", "open ai assistant", "open live ai assistant", "live ai", "ask live ai", "ai assistant", "assistant", "ask ai", "chat with ai", "talk to ai", "speak to ai", "live assistant", "start ai", "start live ai"],
};

function navigationTarget(value: string) {
  let target = normalizeCommand(value);

  // Ignore polite lead-ins and common spoken control verbs. Each verb routes
  // to the same destination as opening its matching on-screen control.
  const politeLeadIn = /^(?:(?:please|kindly)\s+|(?:(?:can|could|would|will) you|(?:can|could|would) i|(?:can|could) we|how do i|how can i|how could i)\s+|(?:i want to|i need to|i would like to|i d like to|i wanna|i want you to|i need you to)\s+)/;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const withoutPoliteness = target.replace(politeLeadIn, "");
    if (withoutPoliteness === target) break;
    target = withoutPoliteness;
  }

  target = target.replace(/^(?:please|kindly)\s+/, "");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const withoutActionVerb = target.replace(/^(?:open(?:\s+up)?|go(?:\s+(?:to|back(?:\s+to)?))?|head(?:\s+to)?|navigate(?:\s+to)?|take me(?:\s+to)?|bring me(?:\s+to)?|get me to|show(?:\s+me)?|bring up|pull up|see|check|view|visit|access|switch(?:\s+to)?|move(?:\s+to)?|click(?:\s+on)?|press|tap|select|choose|return(?:\s+to)?|back to|display)\s+/, "");
    if (withoutActionVerb === target) break;
    target = withoutActionVerb;
  }

  target = target.replace(/^(?:the|my|me)\s+/, "");
  target = target.replace(/^(?:button|tab|page|screen|menu|section|link|option)(?:\s+(?:(?:that\s+)?(?:says|is|called|named|labelled|labeled|for|to)\s+))?/, "");
  target = target.replace(/\s+(?:please|kindly|now|for me|button|tab|page|screen|menu|section|link|option|icon|control|tile|item|navigation)$/, "");
  target = target.replace(/^(?:the|my|me)\s+/, "");
  return target.trim();
}

function classifyCommand(value: string, language: RequesterLanguage): VoiceAction | null {
  const text = normalizeCommand(value);
  if (/^(?:please )?(?:(?:open|show|display|turn on|bring up) )?(?:the )?(?:accessibility|accessibility settings|accessibility preferences|accessibility and notification preferences|accessibility popup|accessibility pop up)$/.test(text)) return "open-accessibility";
  if (/^(?:please )?(?:(?:open|show|display|bring up) )?(?:the )?(?:account|account menu|profile menu|account popup|account pop up)$/.test(text)) return "open-account-menu";
  if (/^(?:please )?(?:(?:open|show|start|make|place) )?(?:(?:a )?call (?:to|with) )?(?:the )?(?:dispatcher|dispatch|dispatch team|dispatch centre|dispatch center)$/.test(text)
    || /^(?:please )?(?:call|phone|contact|speak to|talk to) (?:the )?(?:dispatcher|dispatch|dispatch team|dispatch centre|dispatch center)$/.test(text)) return "call-dispatcher";
  if (/^(?:please )?(?:(?:open|show|display|bring up) )?(?:the )?help (?:sheet|popup|pop up|guide)$/.test(text)
    || /^(?:please )?(?:open|show|display|bring up) (?:the )?help$/.test(text)) return "open-help";
  if (/^(?:please )?(?:the )?requester (?:needs? )?help$/.test(text)) return "help";
  if (/^(?:please )?(?:(?:click|press|tap) )?(?:(?:open|edit|change|update) )?(?:my )?profile(?: details)?(?: for editing)?$/.test(text)
    && /\b(?:edit|change|update)\b/.test(text)) return "edit-profile";
  if (/^(?:please )?(?:page help|help with this page|how do i use (?:this )?(?:page|screen)|how do i navigate (?:this )?(?:page|screen)|how can i navigate (?:this )?(?:page|screen)|show page help|open page help)$/.test(text)) return "page-help";
  if (/^(?:please )?(?:(?:open|show|go to|navigate to|visit) )?(?:the )?(?:request help page|help request page|help page|detailed request form|request form|emergency form|incident form)$/.test(text)
    || /^(?:please )?(?:open|show|go to|navigate to|visit) (?:the )?request help$/.test(text)) return "request-form";
  if (/^(?:please )?(?:(?:open|show|list|display) )?(?:my )?(?:navigation|navigation options|navigation tabs|main navigation|main tabs|tabs)$/.test(text)) return "navigation";
  if (/\b(?:open|show)\b.*\b(?:cancellation|cancel)\b.*\b(?:request|confirmation|dialog|sheet)\b/.test(text)) return "cancel-request";
  if (/^(?:please )?(?:read(?: out)?|tell me|announce|speak)(?: me)? (?:the |my )?(?:(?:unread|new|latest|all) )?(?:notifications|alerts)$/.test(text)
    || /^(?:please )?(?:read|tell me|announce|speak) (?:the )?(?:unread|new|latest|all) notifications$/.test(text)) return "read-notifications";
  if (/^(?:please )?(?:open|show|view|read) (?:the )?(?:(?:unread|latest|first) )?notifications?$/.test(text)) return "open-notification";
  if (/^(?:please )?(?:open|show|view) (?:the )?(?:(?:first|latest|most recent|unread) )?(?:request|emergency request)(?: (?:in|from) (?:my )?history)?$/.test(text)
    || /^(?:please )?(?:open|show|view) (?:a )?request (?:in|from) (?:my )?history$/.test(text)) return "open-history-request";
  if (/\b(?:open|show|view|read|check)\b.*\b(?:unread|new)\b.*\b(?:request|emergency|notification)\b/.test(text)
    || /\b(?:unread|new)\s+(?:emergency\s+)?request\b/.test(text)) return "open-unread-request";
  if (/\b(?:cancel|withdraw|stop)\b.*\b(?:(?:my|this|the|an?)\s+)?(?:emergency\s+)?request\b/.test(text)
    || /\b(?:cancel|withdraw)\b.*\b(?:emergency|help)\b/.test(text)) return "cancel-request";
  const requestIntent = /\b(?:request|ask for|get|need|send|start|create|call)\b/.test(text);
  if ((requestIntent || /\bhelp\b/.test(text)) && /\b(?:fire|firefighting|firefighter|fire fighter|fire department|smoke|burning|flames)\b/.test(text)) return "request-fire";
  if ((requestIntent || /\bhelp\b/.test(text)) && /\b(?:police|law enforcement|police department|personal safety|unsafe|being followed)\b/.test(text)) return "request-police";
  if ((requestIntent || /\bhelp\b/.test(text)) && /\b(?:medical|medicine|ambulance|doctor|health|injured|injury|not breathing|unconscious)\b/.test(text)) return "request-medical";
  if (/\b(?:request|ask for|get|need|send|start|create)\b.*\b(?:help|emergency|medical|fire|firefighting|police)\b/.test(text)
    || /\b(?:medical|fire|firefighting|police) help\b/.test(text)) return "help";
  if (/^(?:please )?go back(?: please)?$/.test(text) || /^(?:please )?go back (?:one step|to the previous page|to the last page)(?: please)?$/.test(text)) return "undo";
  if (/\b(undo|reverse|cancel that|cancel the action)\b/.test(text)) return "undo";
  if (/\b(cancel|never mind|nevermind|stop that)\b/.test(text)) return "cancel";
  const localized: Array<[NavigationAction, string]> = [
    ["home", "Home"], ["help", "Request help"], ["history", "History"], ["notifications", "Notifications"],
    ["profile", "Profile"], ["settings", "System settings"], ["tracking", "Open tracking"], ["ai", "Ask LIVE AI"],
  ];
  const target = navigationTarget(value);
  for (const [action, label] of localized) {
    const alias = normalizeCommand(requesterText(language, label));
    if (alias && (target === alias || text === alias)) return action;
    if (NAVIGATION_ALIASES[action].includes(target)) return action;
  }
  if (/\b(request|start|create|get|make|send)\b.*\b(an? )?emergency\b/.test(text)) return "help";
  if (/\b(call|phone|ring|contact)\b.*\b(driver|responder|response team)\b/.test(text) || /\b(?:connect me to|put me through to)\b.*\b(driver|responder|response team)\b/.test(text)) return "call-driver";
  return null;
}

const ACTION_LABELS: Record<VoiceAction, string> = {
  home: "Home", help: "Choose an emergency type", "request-form": "Open the detailed request form", history: "History", notifications: "Notifications", profile: "Profile",
  "edit-profile": "Edit profile",
  settings: "System settings", tracking: "Open tracking", ai: "Open LIVE AI", "call-driver": "Call the assigned responder", "call-dispatcher": "Open dispatcher call options",
  navigation: "Show navigation choices",
  "page-help": "Open page help",
  "open-help": "Open help",
  "open-accessibility": "Open accessibility preferences",
  "open-account-menu": "Open the account menu",
  "open-unread-request": "Open unread request", "open-history-request": "Open a request from history", "open-notification": "Open a notification", "read-notifications": "Read notifications",
  "cancel-request": "Open cancellation confirmation",
  "request-medical": "Request medical help", "request-fire": "Request firefighting help", "request-police": "Request police help",
  undo: "Undo the last action", cancel: "Cancel this command",
};

const ROUTES: Partial<Record<VoiceAction, string>> = {
  home: "/app/requester", help: "/app/requester", "request-form": "/app/requester/new?flow=details", history: "/app/requester/history",
  notifications: "/app/requester/notifications", profile: "/app/requester/settings?section=profile", settings: "/app/requester/settings",
};

const REQUESTER_NAVIGATION_OPTIONS = [
  { label: "Home", href: "/app/requester", aliases: ["home", "home page"] },
  { label: "Request help", href: "/app/requester/new?flow=details", aliases: ["request help", "request help page", "help page", "request form"] },
  { label: "History", href: "/app/requester/history", aliases: ["history", "request history"] },
  { label: "Notifications", href: "/app/requester/notifications", aliases: ["notifications", "notification", "alerts"] },
] as const;

function dispatchRequesterVoiceAction(action: string, extra: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent("live:requester-voice-action", { detail: { action, ...extra } }));
}

export function RequesterVoiceCommands({ language }: { language: RequesterLanguage }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceActive, setVoiceActive] = useState(true);
  const [wakePromptVisible, setWakePromptVisible] = useState(false);
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [navigationChoicesOpen, setNavigationChoicesOpen] = useState(false);
  const [navigationFocusIndex, setNavigationFocusIndex] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [completed, setCompleted] = useState<{ label: string; previousPath: string; action: VoiceAction } | null>(null);
  const [modalVoiceFocus, setModalVoiceFocus] = useState(false);
  const [micButtonPosition, setMicButtonPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [voicePanelPosition, setVoicePanelPosition] = useState({ top: 72, right: 8 });
  const [voicePanelHost, setVoicePanelHost] = useState<HTMLElement | null>(null);
  const micAnchorRef = useRef<HTMLSpanElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const manualPauseRef = useRef(false);
  const unmountedRef = useRef(false);
  const blockedRef = useRef(false);
  const lastStartRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const interimCommandTimerRef = useRef<number | null>(null);
  const lastHandledCommandRef = useRef<{ action: VoiceAction; utteranceKey: string; source: "interim" | "final" } | null>(null);
  const lastVoiceInputUtteranceRef = useRef<{ utteranceKey: string; consumed: boolean; isFinal: boolean } | null>(null);
  const recognitionSessionRef = useRef(0);
  const proposalRef = useRef(proposal);
  const completedRef = useRef(completed);
  const pathnameRef = useRef(pathname);
  const languageRef = useRef(language);
  const voiceActiveRef = useRef(voiceActive);
  const blindVoiceoverGuardUntilRef = useRef(0);
  const blindVoiceoverInterruptedRef = useRef(false);
  const blindVoiceoverIdleAfterInterruptRef = useRef(false);
  const activeVoiceDialogRef = useRef<HTMLElement | null>(null);
  const focusedVoiceControlRef = useRef<HTMLElement | null>(null);
  proposalRef.current = proposal;
  completedRef.current = completed;
  pathnameRef.current = pathname;
  languageRef.current = language;
  voiceActiveRef.current = voiceActive;

  useEffect(() => {
    const syncVoiceoverState = () => {
      const speaking = isBlindVoiceoverPlaying(user?.id);
      if (blindVoiceoverInterruptedRef.current) {
        if (!speaking) {
          blindVoiceoverIdleAfterInterruptRef.current = true;
        } else if (blindVoiceoverIdleAfterInterruptRef.current) {
          // A new announcement began after the user interrupted the last one.
          blindVoiceoverInterruptedRef.current = false;
          blindVoiceoverIdleAfterInterruptRef.current = false;
          blindVoiceoverGuardUntilRef.current = Date.now() + BLIND_VOICEOVER_RESULT_COOLDOWN_MS;
        }
        return;
      }
      if (speaking) blindVoiceoverGuardUntilRef.current = Date.now() + BLIND_VOICEOVER_RESULT_COOLDOWN_MS;
      else if (Date.now() >= blindVoiceoverGuardUntilRef.current) blindVoiceoverGuardUntilRef.current = 0;
    };
    const onSpeechControl = (event: Event) => {
      if ((event as CustomEvent<{ action?: string }>).detail?.action !== "stop") return;
      // Keep recognition available so the user can say "stop", then release
      // the gate immediately after the speech queue is cancelled.
      blindVoiceoverInterruptedRef.current = true;
      blindVoiceoverIdleAfterInterruptRef.current = false;
      blindVoiceoverGuardUntilRef.current = 0;
    };
    window.addEventListener("live:blind-speech-control", onSpeechControl);
    syncVoiceoverState();
    const timer = window.setInterval(syncVoiceoverState, 100);
    return () => {
      window.removeEventListener("live:blind-speech-control", onSpeechControl);
      window.clearInterval(timer);
      blindVoiceoverGuardUntilRef.current = 0;
      blindVoiceoverInterruptedRef.current = false;
      blindVoiceoverIdleAfterInterruptRef.current = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let frame = 0;
    const updatePosition = () => {
      const accountMenu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Account menu"]'))
        .find((menu) => menu.getClientRects().length > 0);
      if (!accountMenu) {
        setVoicePanelPosition({ top: 72, right: 8 });
        return;
      }
      const menuBounds = accountMenu.getBoundingClientRect();
      const panelHeight = 132;
      const maxTop = Math.max(16, window.innerHeight - panelHeight - 16);
      setVoicePanelPosition({ top: Math.min(Math.max(72, menuBounds.bottom + 8), maxTop), right: 8 });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!modalVoiceFocus) {
      setVoicePanelHost(null);
      return;
    }
    let frame = 0;
    const syncHost = () => {
      const dialog = getTopmostVoiceDialog();
      const host = dialog?.querySelector<HTMLElement>("[data-live-voice-status-host]") ?? null;
      setVoicePanelHost((current) => current === host ? current : host);
    };
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncHost);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    syncHost();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      setVoicePanelHost(null);
    };
  }, [modalVoiceFocus]);

  // Reset on every mount. In dev (React StrictMode) and on remounts the refs survive
  // the simulated unmount, so a stale manualPause=true used to block auto-start forever.
  useEffect(() => {
    unmountedRef.current = false;
    manualPauseRef.current = false;
    return () => {
      unmountedRef.current = true;
      manualPauseRef.current = true;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      if (interimCommandTimerRef.current !== null) window.clearTimeout(interimCommandTimerRef.current);
      restartTimerRef.current = null;
      interimCommandTimerRef.current = null;
      const current = recognitionRef.current;
      recognitionRef.current = null; // makes every handler of this instance a no-op
      current?.stop();
    };
  }, [user?.id]);

  useEffect(() => {
    const sync = () => {
      const preferences = readRequesterPreferences(user?.id);
      setEnabled(preferences.voiceNavigation || preferences.blindVoiceGuidance);
      setVoiceActive(preferences.voiceCommandsActive);
      voiceActiveRef.current = preferences.voiceCommandsActive;
      if (!preferences.voiceNavigation && !preferences.blindVoiceGuidance) {
        stopListening();
        setTranscript("");
        setProposal(null);
        proposalRef.current = null;
        setError("");
        setCompleted(null);
        completedRef.current = null;
      }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("live:requester-preferences-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("live:requester-preferences-changed", sync);
    };
  }, [user?.id]);

  // Follow the browser's real microphone permission so the button never silently dies.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const apply = () => {
      if (!status || cancelled) return;
      if (status.state === "denied") {
        const preferences = readRequesterPreferences(user?.id);
        if (!preferences.voiceNavigation && !preferences.blindVoiceGuidance) return;
        blockedRef.current = true;
        setBlocked(true);
        setListening(false);
        setError("Microphone is blocked for this site. Click the lock icon in the address bar, allow Microphone, then try again.");
        const current = recognitionRef.current;
        recognitionRef.current = null;
        current?.stop();
        return;
      }
      // granted or prompt: clear a previous block and resume automatically
      if (blockedRef.current) {
        blockedRef.current = false;
        setBlocked(false);
        setError("");
      }
      const preferences = readRequesterPreferences(user?.id);
      if (status.state === "granted" && (preferences.voiceNavigation || preferences.blindVoiceGuidance) && !recognitionRef.current) {
        manualPauseRef.current = false;
        startListening();
      }
    };
    navigator.permissions?.query({ name: "microphone" as PermissionName }).then((result) => {
      if (cancelled) return;
      status = result;
      result.onchange = apply;
      apply();
    }).catch(() => { /* Permissions API not available for microphone in this browser */ });
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!enabled) {
      if (recognitionRef.current || restartTimerRef.current !== null) stopListening();
      return;
    }
    const commandsActive = readRequesterPreferences(user?.id).voiceCommandsActive;
    setVoiceActive(commandsActive);
    voiceActiveRef.current = commandsActive;
    const current = recognitionRef.current;
    if (current && current.lang !== LANGUAGE_TAG[language]) {
      // Switch language only after the old session has really ended. Starting a new
      // recognizer while the old one is still stopping made the browser abort both.
      recognitionRef.current = null;
      current.onresult = null;
      current.onerror = null;
      current.onend = () => scheduleRestart(150);
      current.stop();
      setListening(false);
      return;
    }
    if (shouldAutoRun()) startListening();
  }, [enabled, language, user?.id]);

  useEffect(() => {
    const activate = () => {
      manualPauseRef.current = false;
      const commandsActive = readRequesterPreferences(user?.id).voiceCommandsActive;
      voiceActiveRef.current = commandsActive;
      setVoiceActive(commandsActive);
      setPanelDismissed(false);
      startListening();
    };
    window.addEventListener("live:requester-voice-activate", activate);
    return () => window.removeEventListener("live:requester-voice-activate", activate);
  }, [language, completed, user?.id]);

  useEffect(() => {
    if (voiceActive || !enabled) {
      setWakePromptVisible(false);
      return;
    }
    setWakePromptVisible(true);
    const timer = window.setTimeout(() => setWakePromptVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [voiceActive, enabled]);

  useEffect(() => {
    if (pathname !== "/app/requester" && pathname !== "/app/requester/notifications" && pathname !== "/app/requester/history") return;
    const pending = window.sessionStorage.getItem("live-requester-voice-action-pending");
    if (!pending) return;
    // Let the destination page mount its action listener before dispatching.
    // Route changes can otherwise drop the one-shot command on first render.
    const timer = window.setTimeout(() => {
      if (window.sessionStorage.getItem("live-requester-voice-action-pending") !== pending) return;
      window.sessionStorage.removeItem("live-requester-voice-action-pending");
      window.dispatchEvent(new CustomEvent("live:requester-voice-action", { detail: { action: pending } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // Show button numbers steadily while voice commands are active.
  useEffect(() => {
    const active = enabled && voiceActive && !blocked && !unsupported;
    if (active) document.documentElement.dataset.liveVoiceNumbersVisible = "true";
    else delete document.documentElement.dataset.liveVoiceNumbersVisible;
    return () => { delete document.documentElement.dataset.liveVoiceNumbersVisible; };
  }, [blocked, enabled, unsupported, voiceActive]);

  // Keep voice interaction inside the topmost open sheet or dialog. The same
  // behavior covers shared sheets, confirmation dialogs, and the LIVE AI sheet.
  useEffect(() => {
    if (!navigationChoicesOpen) return;
    const handleNavigationVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail || getTopmostVoiceDialog()) return;
      const spoken = normalizeCommand(detail.transcript ?? "");
      if (!spoken) return;

      const dialogCommand = dialogVoiceCommand(spoken);
      if (dialogCommand?.kind === "next" || dialogCommand?.kind === "previous") {
        detail.consumed = true;
        if (detail.isFinal) {
          setNavigationFocusIndex((index) => (dialogCommand.kind === "next"
            ? (index + 1) % REQUESTER_NAVIGATION_OPTIONS.length
            : (index - 1 + REQUESTER_NAVIGATION_OPTIONS.length) % REQUESTER_NAVIGATION_OPTIONS.length));
        }
        return;
      }
      if (dialogCommand?.kind === "select") {
        detail.consumed = true;
        if (detail.isFinal) {
          const index = (dialogCommand.index ?? navigationFocusIndex + 1) - 1;
          const option = REQUESTER_NAVIGATION_OPTIONS[index];
          if (option) {
            setNavigationChoicesOpen(false);
            router.push(option.href);
          }
        }
        return;
      }

      const numberCommand = spoken.match(/^(?:(?:please )?(?:select|choose|click(?: on)?|press|open) )?(?:(?:navigation )?(?:tab|option|button) )?(one|first|two|second|three|third|four|fourth|[1-4])$/);
      const number = numberCommand ? SPOKEN_NUMBERS[numberCommand[1]] ?? Number(numberCommand[1]) : null;
      if (number !== null) {
        detail.consumed = true;
        if (detail.isFinal) {
          const index = number - 1;
          setNavigationFocusIndex(index);
          const option = REQUESTER_NAVIGATION_OPTIONS[index];
          if (option) {
            setNavigationChoicesOpen(false);
            router.push(option.href);
          }
        }
        return;
      }

      if (/^(?:close|dismiss|hide) (?:the )?navigation(?: options| tabs)?$/.test(spoken)) {
        detail.consumed = true;
        if (detail.isFinal) setNavigationChoicesOpen(false);
        return;
      }

      const target = navigationTarget(spoken);
      const option = REQUESTER_NAVIGATION_OPTIONS.find((candidate) =>
        candidate.aliases.some((alias) => target === alias || target === normalizeCommand(requesterText(language, candidate.label)))
        || target === normalizeCommand(requesterText(language, candidate.label)));
      if (!option) return;
      detail.consumed = true;
      if (detail.isFinal) {
        setNavigationChoicesOpen(false);
        router.push(option.href);
      }
    };
    window.addEventListener("live:requester-voice-input", handleNavigationVoiceInput);
    return () => window.removeEventListener("live:requester-voice-input", handleNavigationVoiceInput);
  }, [language, navigationChoicesOpen, router]);

  useEffect(() => {
    const active = enabled && voiceActive && !blocked && !unsupported;
    if (!active) {
      setModalVoiceFocus(false);
      setMicButtonPosition(null);
      delete document.documentElement.dataset.liveVoiceFocusActive;
      document.querySelectorAll<HTMLElement>("[data-live-voice-focus-active]").forEach((dialog) => {
        delete dialog.dataset.liveVoiceFocusActive;
      });
      focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
      focusedVoiceControlRef.current = null;
      activeVoiceDialogRef.current = null;
      return;
    }

    document.documentElement.dataset.liveVoiceFocusActive = "true";
    let frame = 0;
    const syncFocus = () => {
      const dialog = getTopmostVoiceDialog();
      setModalVoiceFocus(Boolean(dialog));
      if (dialog && micAnchorRef.current) {
        const rect = micAnchorRef.current.getBoundingClientRect();
        const nextPosition = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        setMicButtonPosition((previous) => previous
          && previous.top === nextPosition.top
          && previous.left === nextPosition.left
          && previous.width === nextPosition.width
          && previous.height === nextPosition.height
          ? previous
          : nextPosition);
      } else if (!dialog) {
        setMicButtonPosition(null);
      }
      document.querySelectorAll<HTMLElement>("[data-live-voice-focus-active]").forEach((item) => {
        if (item !== dialog) delete item.dataset.liveVoiceFocusActive;
      });
      if (!dialog) {
        clearGeneratedDialogVoiceNumbers();
        activeVoiceDialogRef.current = null;
        focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
        focusedVoiceControlRef.current = null;
        return;
      }

      document.querySelectorAll<HTMLElement>('[data-live-voice-dialog-number="true"]').forEach((control) => {
        if (!dialog.contains(control)) {
          delete control.dataset.liveVoiceDialogNumber;
          delete control.dataset.liveVoiceNumber;
        }
      });
      document.querySelectorAll<HTMLElement>('[data-live-voice-dialog-control="true"]').forEach((control) => {
        if (!dialog.contains(control)) {
          if (control.dataset.liveVoiceHadNumber === "true") control.dataset.liveVoiceNumber = control.dataset.liveVoiceOriginalNumber ?? "";
          else delete control.dataset.liveVoiceNumber;
          delete control.dataset.liveVoiceOriginalNumber;
          delete control.dataset.liveVoiceHadNumber;
          delete control.dataset.liveVoiceDialogNumber;
          delete control.dataset.liveVoiceDialogControl;
        }
      });

      dialog.dataset.liveVoiceFocusActive = "true";
      if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
      const previousDialog = activeVoiceDialogRef.current;
      if (previousDialog !== dialog) setPanelDismissed(false);
      activeVoiceDialogRef.current = dialog;

      const controls = getDialogVoiceControls(dialog);
      controls.forEach((control, index) => {
        const badgeTarget = control instanceof HTMLInputElement
          ? control.closest<HTMLElement>("label") ?? control
          : control;
        if (badgeTarget.dataset.liveVoiceDialogControl !== "true") {
          badgeTarget.dataset.liveVoiceHadNumber = String(badgeTarget.hasAttribute("data-live-voice-number"));
          if (badgeTarget.hasAttribute("data-live-voice-number")) {
            badgeTarget.dataset.liveVoiceOriginalNumber = badgeTarget.dataset.liveVoiceNumber ?? "";
          }
          badgeTarget.dataset.liveVoiceDialogControl = "true";
        }
        badgeTarget.dataset.liveVoiceDialogNumber = String(index + 6);
        badgeTarget.dataset.liveVoiceNumber = String(index + 6);
      });
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusedControl = controls.find((control) => control === focused || control.contains(focused));
      const markedControl = focusedVoiceControlRef.current;
      if (markedControl && (!dialog.contains(markedControl) || !controls.some((control) => control === markedControl || control.contains(markedControl)))) {
        markedControl.removeAttribute("data-live-voice-option-focused");
        focusedVoiceControlRef.current = null;
      }

      if (!dialog.contains(focused) || previousDialog !== dialog) {
        const initial = controls.find((control) =>
          (control instanceof HTMLInputElement && control.checked)
          || control.getAttribute("aria-checked") === "true"
          || control.getAttribute("aria-selected") === "true",
        ) ?? controls[0];
        if (initial) {
          const target = initial instanceof HTMLInputElement ? initial.closest<HTMLElement>("label") ?? initial : initial;
          focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
          target.dataset.liveVoiceOptionFocused = "true";
          focusedVoiceControlRef.current = target;
          initial.focus({ preventScroll: true });
        } else {
          dialog.focus({ preventScroll: true });
        }
      } else if (focusedControl && focusedVoiceControlRef.current !== focusedControl) {
        const target = focusedControl instanceof HTMLInputElement ? focusedControl.closest<HTMLElement>("label") ?? focusedControl : focusedControl;
        focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
        target.dataset.liveVoiceOptionFocused = "true";
        focusedVoiceControlRef.current = target;
      }
    };
    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncFocus);
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", scheduleSync, true);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);
    syncFocus();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", scheduleSync, true);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      window.cancelAnimationFrame(frame);
      setModalVoiceFocus(false);
      setMicButtonPosition(null);
      delete document.documentElement.dataset.liveVoiceFocusActive;
      document.querySelectorAll<HTMLElement>("[data-live-voice-focus-active]").forEach((dialog) => {
        delete dialog.dataset.liveVoiceFocusActive;
      });
      clearGeneratedDialogVoiceNumbers();
      focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
      focusedVoiceControlRef.current = null;
      activeVoiceDialogRef.current = null;
    };
  }, [blocked, enabled, unsupported, voiceActive]);

  // Settings/profile screens have more controls than the fixed Home actions.
  // Number their visible page controls while voice is active, and let any open
  // dialog take over with its own 6+ numbering.
  useEffect(() => {
    const active = enabled && voiceActive && !blocked && !unsupported
      && (pathname === "/app/requester/settings" || pathname === "/app/requester/profile");
    const restorePageNumbers = () => {
      document.querySelectorAll<HTMLElement>('[data-live-voice-page-control="true"]').forEach((control) => {
        if (control.dataset.liveVoicePageHadNumber === "true") control.dataset.liveVoiceNumber = control.dataset.liveVoicePageOriginalNumber ?? "";
        else delete control.dataset.liveVoiceNumber;
        delete control.dataset.liveVoicePageOriginalNumber;
        delete control.dataset.liveVoicePageHadNumber;
        delete control.dataset.liveVoicePageControl;
      });
    };
    if (!active) {
      restorePageNumbers();
      return;
    }

    let frame = 0;
    const syncPageNumbers = () => {
      const main = document.querySelector<HTMLElement>("main");
      if (!main || getTopmostVoiceDialog()) {
        restorePageNumbers();
        return;
      }
      const controls = Array.from(new Set(main.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])',
      ))).filter((control) => control.getClientRects().length > 0
        && !control.matches(":disabled")
        && control.getAttribute("aria-disabled") !== "true"
        && !control.closest('[aria-hidden="true"]'));
      controls.forEach((control, index) => {
        const badgeTarget = control instanceof HTMLInputElement ? control.closest<HTMLElement>("label") ?? control : control;
        if (badgeTarget.dataset.liveVoicePageControl !== "true") {
          badgeTarget.dataset.liveVoicePageHadNumber = String(badgeTarget.hasAttribute("data-live-voice-number"));
          if (badgeTarget.hasAttribute("data-live-voice-number")) badgeTarget.dataset.liveVoicePageOriginalNumber = badgeTarget.dataset.liveVoiceNumber ?? "";
          badgeTarget.dataset.liveVoicePageControl = "true";
        }
        badgeTarget.dataset.liveVoiceNumber = String(index + 1);
      });
    };
    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncPageNumbers);
    };
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    syncPageNumbers();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      restorePageNumbers();
    };
  }, [blocked, enabled, pathname, unsupported, voiceActive]);

  function saveVoiceCommandsActive(active: boolean) {
    const preferences = readRequesterPreferences(user?.id);
    saveRequesterPreferences({ ...preferences, voiceCommandsActive: active }, user?.id);
    window.dispatchEvent(new Event("live:requester-preferences-changed"));
  }

  function shouldAutoRun() {
    const preferences = readRequesterPreferences(user?.id);
    return !unmountedRef.current && !manualPauseRef.current && !blockedRef.current && (preferences.voiceNavigation || preferences.blindVoiceGuidance);
  }

  function scheduleRestart(delay: number) {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (shouldAutoRun()) startListening();
    }, delay);
  }

  async function requestMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      blockedRef.current = false;
      setBlocked(false);
      manualPauseRef.current = false;
      startListening();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      blockedRef.current = false;
      setBlocked(false);
      setError("");
      manualPauseRef.current = false;
      voiceActiveRef.current = true;
      setVoiceActive(true);
      saveVoiceCommandsActive(true);
      startListening();
    } catch {
      blockedRef.current = true;
      setBlocked(true);
      setPanelDismissed(false);
      setError("Microphone is blocked for this site. Click the lock icon in the address bar, allow Microphone, then try again.");
    }
  }

  function stopListening() {
    manualPauseRef.current = true;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    if (interimCommandTimerRef.current !== null) window.clearTimeout(interimCommandTimerRef.current);
    restartTimerRef.current = null;
    interimCommandTimerRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function pauseVoiceCommands() {
    voiceActiveRef.current = false;
    setVoiceActive(false);
    saveVoiceCommandsActive(false);
    setTranscript("");
    setProposal(null);
    proposalRef.current = null;
    setError("");
    setCompleted(null);
    completedRef.current = null;
    setPanelDismissed(false);
    manualPauseRef.current = false;
    startListening();
  }

  function offerVoiceInput(transcript: string, utteranceKey: string, isFinal: boolean) {
    const previous = lastVoiceInputUtteranceRef.current;
    if (previous?.utteranceKey === utteranceKey && (!isFinal || previous.isFinal)) return previous.consumed;
    const detail = { transcript, utteranceKey, isFinal, consumed: false };
    window.dispatchEvent(new CustomEvent("live:requester-voice-input", { detail }));
    lastVoiceInputUtteranceRef.current = { utteranceKey, consumed: detail.consumed, isFinal };
    return detail.consumed;
  }

  function shouldSuppressBlindVoiceoverInput() {
    if (blindVoiceoverInterruptedRef.current) return false;
    const speaking = isBlindVoiceoverPlaying(user?.id);
    if (speaking) blindVoiceoverGuardUntilRef.current = Date.now() + BLIND_VOICEOVER_RESULT_COOLDOWN_MS;
    return speaking || Date.now() < blindVoiceoverGuardUntilRef.current;
  }

  function handleDialogVoiceCommand(spoken: string, isFinal: boolean) {
    const dialog = activeVoiceDialogRef.current ?? getTopmostVoiceDialog();
    if (!dialog) return false;
    const command = dialogVoiceCommand(spoken);
    if (!command) return false;
    if (!isFinal) return true;

    const controls = getDialogVoiceControls(dialog);
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = controls.findIndex((control) => control === activeElement || control.contains(activeElement));
    const focusControl = (control: HTMLElement, activate: boolean) => {
      const target = control instanceof HTMLInputElement ? control.closest<HTMLElement>("label") ?? control : control;
      focusedVoiceControlRef.current?.removeAttribute("data-live-voice-option-focused");
      target.dataset.liveVoiceOptionFocused = "true";
      focusedVoiceControlRef.current = target;
      control.focus({ preventScroll: false });
      if (activate) control.click();
    };

    if (command.kind === "close") {
      const closeButton = dialog.querySelector<HTMLElement>(
        'button[aria-label="Close"]:not([disabled]), button[aria-label^="Close "]:not([disabled]), button[data-live-voice-close]:not([disabled])',
      );
      const backButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"))
        .find((button) => /^(?:go back|keep request active|close|dismiss)$/i.test(button.textContent?.trim() ?? "")
          || /^(?:close|dismiss|go back)$/i.test(button.getAttribute("aria-label") ?? ""));
      const target = closeButton ?? backButton;
      if (target) focusControl(target, true);
      else setError("I couldn't find a close control in this dialog.");
    } else if (command.kind.startsWith("scroll-")) {
      const scrollTarget = Array.from(dialog.querySelectorAll<HTMLElement>("[data-live-keyboard-scroll-area], [data-live-scroll-area], *"))
        .find((element) => element.scrollHeight > element.clientHeight + 4
          && /(auto|scroll)/.test(window.getComputedStyle(element).overflowY));
      const target = scrollTarget ?? (dialog.scrollHeight > dialog.clientHeight + 4 ? dialog : null);
      if (!target) {
        setTranscript(spoken);
        setError("There is no more content to scroll in this dialog.");
        setPanelDismissed(false);
        return true;
      }
      if (command.kind === "scroll-top") target.scrollTo({ top: 0, behavior: "smooth" });
      else if (command.kind === "scroll-bottom") target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
      else target.scrollBy({ top: (command.kind === "scroll-down" ? 1 : -1) * Math.max(160, target.clientHeight * 0.75), behavior: "smooth" });
    } else if (command.kind === "activate-label") {
      const requested = voiceTargetLabel(command.label ?? "");
      const matches = controls.filter((control) => {
        const label = voiceControlLabel(control);
        return label === requested || label.includes(requested);
      });
      const exact = matches.find((control) => voiceControlLabel(control) === requested);
      const target = exact ?? (matches.length === 1 ? matches[0] : null);
      if (target) activateVoiceToggle(target, spoken);
      else {
        setTranscript(spoken);
        setError(matches.length ? "That label matches more than one control. Say more of its label." : `I couldn't find “${requested}” in this dialog.`);
        setPanelDismissed(false);
        return true;
      }
    } else if (controls.length) {
      const requestedIndex = command.index == null
        ? null
        : command.index >= 6 ? command.index - 6 : command.index - 1;
      const nextIndex = command.kind === "select"
        ? (requestedIndex != null ? requestedIndex : currentIndex >= 0 ? currentIndex : 0)
        : command.kind === "next"
          ? currentIndex < 0 ? 0 : (currentIndex + 1) % controls.length
          : currentIndex < 0 ? controls.length - 1 : (currentIndex - 1 + controls.length) % controls.length;
      const control = controls[nextIndex];
      if (control) focusControl(control, command.kind === "select");
      else {
        setTranscript(spoken);
        setError(`This dialog has ${controls.length} selectable options.`);
        setPanelDismissed(false);
        return true;
      }
    } else {
      setTranscript(spoken);
      setError("There are no selectable options in this dialog.");
      setPanelDismissed(false);
      return true;
    }

    setTranscript(spoken);
    setError("");
    setPanelDismissed(false);
    setProposal(null);
    proposalRef.current = null;
    setCompleted(null);
    completedRef.current = null;
    return true;
  }

  function handleRecognizedCommand(latest: string, isFinal: boolean, utteranceKey: string) {
    const spoken = normalizeCommand(latest);
    if (!spoken) return;

    // While blind guidance is speaking, keep recognition open only as an
    // interrupt channel. Ignore every other result so synthesized speech
    // cannot trigger a command or be dictated into a focused field.
    const stopVoiceover = isFinal && BLIND_VOICEOVER_STOP_COMMAND.test(spoken);
    if (shouldSuppressBlindVoiceoverInput() && !stopVoiceover) return;

    // Microphone control and confirmation commands require a final speech result.
    if (isFinal && /\b(close|stop|turn off|disable)\b.*\b(mic|microphone|voice|listening)\b/.test(spoken)) {
      pauseVoiceCommands();
      return;
    }
    if (isFinal && (/\b(open|start|enable|activate|turn on)\b.*\b(mic|microphone|voice|listening)\b/.test(spoken) || /\b(mic|microphone)\b.*\b(open|on|start|enable|active)\b/.test(spoken))) {
      voiceActiveRef.current = true;
      setVoiceActive(true);
      saveVoiceCommandsActive(true);
      setTranscript(latest);
      setPanelDismissed(false);
      setError("");
      manualPauseRef.current = false;
      return;
    }
    if (isFinal && readRequesterPreferences(user?.id).blindVoiceGuidance) {
      if (BLIND_VOICEOVER_STOP_COMMAND.test(spoken)) {
        window.dispatchEvent(new CustomEvent("live:blind-speech-control", { detail: { action: "stop" } }));
        setTranscript(latest);
        setError("");
        setPanelDismissed(false);
        return;
      }
      if (/^(?:please )?(?:repeat|repeat that|again|say that again|say it again|repeat the instructions|repeat page instructions|repeat the page instructions|read the instructions again|read that again)$/.test(spoken)) {
        window.dispatchEvent(new CustomEvent("live:blind-speech-control", { detail: { action: "repeat" } }));
        setTranscript(latest);
        setError("");
        setPanelDismissed(false);
        return;
      }
    }

    if (!voiceActiveRef.current) return;

    // Modal focus navigation takes priority over app navigation and action
    // prompts. Other spoken phrases still go to the active requester sheet
    // (for example, AI answers and cancellation confirmations).
    const activeDialog = activeVoiceDialogRef.current ?? getTopmostVoiceDialog();
    if (activeDialog && isFinal && classifyCommand(latest, languageRef.current) === "call-dispatcher") {
      executeAction("call-dispatcher");
      return;
    }
    if (activeDialog) {
      if (isFinal && adjustVoiceRange(spoken, activeDialog)) {
        setTranscript(latest); setError(""); setPanelDismissed(false); return;
      }
      if (isFinal && selectNativeOption(spoken, activeDialog)) {
        setTranscript(latest); setError(""); setPanelDismissed(false); return;
      }
      if (handleDialogVoiceCommand(spoken, isFinal)) return;
      if (offerVoiceInput(latest, utteranceKey, isFinal)) return;
      const dialogAction = classifyCommand(latest, languageRef.current);
      if (!dialogAction && isFinal && dictateToFocusedField(latest)) {
        setTranscript(latest);
        setError("");
        setPanelDismissed(false);
        return;
      }
      setTranscript(latest);
      setPanelDismissed(false);
      setError("Voice focus is on this dialog. Say button six, next option, previous option, scroll down, scroll up, or close.");
      return;
    }

    if (proposalRef.current?.action === "help") {
      if (!isFinal) return;
      if (classifyCommand(latest, languageRef.current) === "cancel-request") {
        proposalRef.current = null;
        setProposal(null);
        executeAction("cancel-request");
        return;
      }
      if (/^(yes|yeah|yep|confirm|confirmed|go ahead|do it)$/.test(spoken)) {
        executeAction("help");
      } else if (/^(no|nope|cancel|never mind|nevermind|stop)$/.test(spoken)) {
        proposalRef.current = null;
        setProposal(null);
        setTranscript("");
        setError(requesterText(languageRef.current, "Command cancelled."));
      }
      return;
    }

    // Requester sheets without an aria-modal dialog still get first claim on
    // voice input. Their questions and chat take precedence over navigation.
    if (offerVoiceInput(latest, utteranceKey, isFinal)) return;

    if (isFinal && adjustVoiceRange(spoken)) {
      setTranscript(latest); setError(""); setPanelDismissed(false); return;
    }

    if (isFinal && selectNativeOption(spoken)) {
      setTranscript(latest); setError(""); setPanelDismissed(false); return;
    }

    if (isFinal) {
      const exactControl = Array.from(document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled]), [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]',
      )).filter((control) => control.getClientRects().length > 0
        && control.getAttribute("aria-disabled") !== "true"
        && !control.closest('[aria-hidden="true"]'))
        .find((control) => voiceControlLabel(control) === spoken);
      if (exactControl) {
        activateVoiceToggle(exactControl, spoken);
        setTranscript(latest); setError(""); setPanelDismissed(false); return;
      }
    }

    const requestedControl = namedVoiceTarget(spoken);
    if (requestedControl) {
      const matches = Array.from(document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [role="tab"], [role="menuitem"]',
      )).filter((control) => control.getClientRects().length > 0
        && !control.matches(":disabled")
        && control.getAttribute("aria-disabled") !== "true"
        && !control.closest('[aria-hidden="true"]'))
        .map((control) => ({ control, label: voiceControlLabel(control) }))
        .filter(({ label }) => label === voiceTargetLabel(requestedControl) || label.includes(voiceTargetLabel(requestedControl)));
      const target = matches.find(({ label }) => label === voiceTargetLabel(requestedControl))?.control
        ?? (matches.length === 1 ? matches[0].control : null);
      if (target) {
        setTranscript(latest);
        setError("");
        setPanelDismissed(false);
        activateVoiceToggle(target, spoken);
        return;
      }
      if (matches.length > 1) {
        setTranscript(latest);
        setError("That label matches more than one control. Say more of its label.");
        setPanelDismissed(false);
        return;
      }
    }

    const numberedButton = numberedButtonIndex(spoken);
    if (numberedButton !== null) {
      const target = Array.from(document.querySelectorAll<HTMLElement>(`[data-live-voice-number="${numberedButton}"]`))
        .find((control) => control.getClientRects().length > 0 && !control.matches(":disabled") && control.getAttribute("aria-disabled") !== "true");
      if (target) {
        setTranscript(latest);
        setError("");
        setPanelDismissed(false);
        target.focus({ preventScroll: true });
        target.click();
        return;
      }
      setTranscript(latest);
      setError(`There is no available button ${numberedButton} on this screen.`);
      setPanelDismissed(false);
      return;
    }

    const action = classifyCommand(latest, languageRef.current);
    if (!action && isFinal && dictateToFocusedField(latest)) {
      setTranscript(latest);
      setError("");
      setPanelDismissed(false);
      return;
    }
    if (!action) return;

    // A stable interim result is enough for safe page navigation. Keep actions
    // that change an emergency or place a call behind the browser's final result.
    const safeInterimActions: SafeInterimAction[] = ["home", "help", "open-help", "history", "notifications", "profile", "edit-profile", "settings", "tracking", "ai", "navigation", "page-help", "open-accessibility", "open-account-menu", "cancel-request"];
    if (!isFinal && !safeInterimActions.includes(action as SafeInterimAction)) return;

    // Browsers commonly emit the same utterance once as interim and again as
    // final. Do not navigate twice for that single spoken command.
    const previous = lastHandledCommandRef.current;
    if (isFinal && previous?.source === "interim" && previous.action === action && previous.utteranceKey === utteranceKey) return;
    lastHandledCommandRef.current = { action, utteranceKey, source: isFinal ? "final" : "interim" };

    setTranscript(latest);
    if (action === "help") {
      executeAction("help");
    } else if (action === "cancel") {
      const currentPath = pathnameRef.current;
      const cancelVoiceCommand = /\b(?:cancel|stop)\b.*\b(?:command|voice commands?|action)\b/.test(spoken)
        || /\b(?:never mind|nevermind|stop that)\b/.test(spoken);
      if (!cancelVoiceCommand && (currentPath === "/app/requester" || currentPath.startsWith("/app/requester/track/"))) {
        executeAction("cancel-request");
      } else {
        proposalRef.current = null;
        setProposal(null);
        setTranscript("");
        setError(requesterText(languageRef.current, "Command cancelled."));
      }
    } else if (action === "undo") {
      undoAction();
      proposalRef.current = null;
      setProposal(null);
      setTranscript("");
    } else {
      executeAction(action);
    }
  }

  function startListening() {
    if (unmountedRef.current || recognitionRef.current) return;
    manualPauseRef.current = false;
    setError("");
    const speechWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setUnsupported(true);
      manualPauseRef.current = true;
      return;
    }
    setUnsupported(false);
    const recognition = new SpeechRecognition();
    const sessionId = ++recognitionSessionRef.current;
    recognition.lang = LANGUAGE_TAG[languageRef.current];
    recognition.continuous = true;
    recognition.interimResults = true;
    // Every handler ignores events from a recognizer that is no longer the current one.
    const isCurrent = () => recognitionRef.current === recognition;
    recognition.onresult = (event) => {
      if (!isCurrent()) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const utteranceKey = `${sessionId}:${index}`;
        const latest = result?.[0]?.transcript?.trim() ?? "";
        if (!latest) continue;
        const stopVoiceover = result.isFinal && BLIND_VOICEOVER_STOP_COMMAND.test(normalizeCommand(latest));
        if (shouldSuppressBlindVoiceoverInput() && !stopVoiceover) continue;
        if (voiceActiveRef.current) {
          setTranscript(latest);
          setPanelDismissed(false);
          if (completedRef.current) {
            completedRef.current = null;
            setCompleted(null);
          }
        }
        if (result.isFinal) {
          if (interimCommandTimerRef.current !== null) window.clearTimeout(interimCommandTimerRef.current);
          interimCommandTimerRef.current = null;
          handleRecognizedCommand(latest, true, utteranceKey);
        } else {
          if (interimCommandTimerRef.current !== null) window.clearTimeout(interimCommandTimerRef.current);
          interimCommandTimerRef.current = null;
          const action = classifyCommand(latest, languageRef.current);
          const safeInterimActions: SafeInterimAction[] = ["home", "help", "open-help", "history", "notifications", "profile", "edit-profile", "settings", "tracking", "ai", "navigation", "page-help", "open-accessibility", "open-account-menu", "cancel-request"];
          if (voiceActiveRef.current && action && safeInterimActions.includes(action as SafeInterimAction)) {
            interimCommandTimerRef.current = window.setTimeout(() => {
              interimCommandTimerRef.current = null;
              if (!unmountedRef.current && voiceActiveRef.current) handleRecognizedCommand(latest, false, utteranceKey);
            }, 700);
          } else if (voiceActiveRef.current && !action) {
            interimCommandTimerRef.current = window.setTimeout(() => {
              interimCommandTimerRef.current = null;
              if (!unmountedRef.current && voiceActiveRef.current) handleRecognizedCommand(latest, false, utteranceKey);
            }, 1200);
          }
        }
      }
    };
    recognition.onerror = (event) => {
      if (!isCurrent()) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        blockedRef.current = true;
        recognitionRef.current = null; // later onend of this instance is ignored, no restart loop
        setBlocked(true);
        setListening(false);
        setPanelDismissed(false);
        setError("Microphone is blocked for this site. Click the lock icon in the address bar, allow Microphone, then try again.");
        return;
      }
      if (event.error === "aborted" || event.error === "no-speech") setError("");
      else setError("I couldn't hear that. Try again or use the buttons on screen.");
      // onend fires next and restarts the session
    };
    recognition.onend = () => {
      if (!isCurrent()) return;
      recognitionRef.current = null;
      setListening(false);
      // Back off if the session died almost immediately (e.g. network errors) to avoid a tight loop.
      const lived = Date.now() - lastStartRef.current;
      if (shouldAutoRun()) scheduleRestart(lived < 1000 ? 1500 : 350);
    };
    recognitionRef.current = recognition;
    try {
      lastStartRef.current = Date.now();
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setError("Voice recognition could not start. Try again.");
      setListening(false);
      if (shouldAutoRun()) scheduleRestart(800);
    }
  }

  function confirmAction() {
    if (!proposalRef.current) return;
    executeAction(proposalRef.current.action);
  }

  function executeAction(action: VoiceAction) {
    const currentPath = pathnameRef.current;
    setProposal(null);
    proposalRef.current = null;
    setTranscript("");
    setError("");
    const previousPath = `${currentPath}${window.location.search}`;
    if (action === "edit-profile") {
      router.push("/app/requester/profile?edit=true");
    } else if (action === "open-help") {
      dispatchRequesterVoiceAction(action);
    } else if (action === "page-help") {
      dispatchRequesterVoiceAction(action);
    } else if (action === "open-accessibility" || action === "open-account-menu") {
      dispatchRequesterVoiceAction(action);
    } else if (action === "navigation") {
      setNavigationChoicesOpen(true);
      setNavigationFocusIndex(0);
    } else if (action === "request-medical" || action === "request-fire" || action === "request-police") {
      const category = action === "request-medical" ? "Medical" : action === "request-fire" ? "Firefighting" : "Police";
      if (currentPath === "/app/requester/new") {
        dispatchRequesterVoiceAction("set-emergency-category", { category });
      } else if (currentPath === "/app/requester") {
        dispatchRequesterVoiceAction("request-emergency-immediate", { category });
      } else {
        router.push(`/app/requester/new?category=${encodeURIComponent(category)}&flow=immediate`);
      }
    } else if (action === "help") {
      if (currentPath === "/app/requester") dispatchRequesterVoiceAction("open-emergency-type-chooser");
      else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", "open-emergency-type-chooser");
        router.push("/app/requester");
      }
    } else if (action === "call-dispatcher") {
      dispatchRequesterVoiceAction("call-dispatcher");
    } else if (action === "tracking" || action === "ai" || action === "call-driver") {
      const eventAction = action === "ai" ? "open-ai" : action === "tracking" ? "open-tracking" : action;
      if (currentPath === "/app/requester") dispatchRequesterVoiceAction(eventAction);
      else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", eventAction);
        router.push("/app/requester");
      }
    } else if (action === "open-history-request") {
      if (currentPath === "/app/requester/history") dispatchRequesterVoiceAction(action);
      else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", action);
        router.push("/app/requester/history");
      }
    } else if (action === "open-notification" || action === "read-notifications") {
      if (currentPath === "/app/requester/notifications") dispatchRequesterVoiceAction(action);
      else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", action);
        router.push("/app/requester/notifications");
      }
    } else if (action === "open-unread-request") {
      if (currentPath === "/app/requester/notifications") dispatchRequesterVoiceAction(action);
      else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", action);
        router.push("/app/requester/notifications");
      }
    } else if (action === "cancel-request") {
      if (currentPath === "/app/requester" || currentPath.startsWith("/app/requester/track/")) {
        dispatchRequesterVoiceAction(action);
      } else {
        window.sessionStorage.setItem("live-requester-voice-action-pending", action);
        router.push("/app/requester");
      }
    } else {
      const route = ROUTES[action];
      if (route) router.push(route);
    }
    const nextCompleted = { label: ACTION_LABELS[action], previousPath, action };
    completedRef.current = nextCompleted;
    setCompleted(nextCompleted);
  }

  function undoAction() {
    const lastAction = completedRef.current;
    if (!lastAction) return;
    if (lastAction.action === "ai") {
      dispatchRequesterVoiceAction("close-ai");
      if (lastAction.previousPath.split("?")[0] !== pathnameRef.current) router.replace(lastAction.previousPath);
    }
    else if (lastAction.action === "call-driver") {
      dispatchRequesterVoiceAction("end-call");
      if (lastAction.previousPath.split("?")[0] !== pathnameRef.current) router.replace(lastAction.previousPath);
    }
    else if (lastAction.action === "tracking") router.replace(lastAction.previousPath);
    else router.replace(lastAction.previousPath);
    completedRef.current = null;
    setCompleted(null);
  }

  const heardLabel = requesterText(language, "I heard");
  const showVoicePanel = !panelDismissed && (navigationChoicesOpen || modalVoiceFocus || (listening && (voiceActive || wakePromptVisible)) || transcript || proposal || error || unsupported || completed);
  const micButton = enabled ? <button type="button" onClick={toggleVoiceActive} aria-label={blocked ? "Microphone blocked. Click to allow microphone access" : requesterText(language, voiceActive ? "Pause voice commands" : "Resume voice commands; say open mic")} title={blocked ? "Microphone blocked. Click to allow microphone access" : requesterText(language, voiceActive ? "Pause voice commands" : "Resume voice commands; say open mic")} className={`relative grid h-16 w-10 shrink-0 place-items-center rounded-none border-b-2 bg-transparent transition ${voiceActive && listening ? "border-[#0f6872] text-[#0f6872]" : "border-transparent text-[#71838e] hover:bg-[#eef8f8]"}`}>
    {blocked ? <span className="relative grid h-5 w-5 place-items-center"><MicOff className="h-5 w-5 text-[#b7791f]"/><span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#d53f3d] ring-2 ring-white"/></span> : voiceActive ? <span className="relative grid h-5 w-5 place-items-center"><span className="absolute h-9 w-9 animate-ping rounded-full bg-[#d53f3d]/20"/><span className="absolute -inset-1 rounded-full border border-[#d53f3d]/50 animate-pulse"/><Mic className="relative h-5 w-5 text-[#d53f3d]"/></span> : <MicOff className="h-5 w-5"/>}
  </button> : null;
  const voicePanel = showVoicePanel ? <section role="status" aria-live="polite" style={voicePanelHost ? undefined : { top: voicePanelPosition.top, right: voicePanelPosition.right }} className={voicePanelHost ? "mx-2 my-2 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-[#dce5ea] bg-white p-3 text-[#102b3f] shadow-sm" : "fixed z-[69] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/90 bg-white/95 p-4 text-[#102b3f] shadow-xl backdrop-blur-2xl ring-1 ring-[#102b3f]/5"}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#0f6872]">{!voiceActive && listening ? requesterText(language, "Wake phrase only") : listening ? requesterText(language, "Listening") : completed ? requesterText(language, "Command complete") : requesterText(language, "Voice command")}</p>
        {!voiceActive && listening ? <p className="mt-2 text-sm font-semibold leading-6">{requesterText(language, "Say ‘open mic’ to resume voice commands.")}</p> : listening || transcript ? <p className="mt-2 break-words text-sm font-semibold leading-6">{heardLabel}: {transcript || requesterText(language, "Speak a command...")}</p> : null}
        {proposal ? <p className="mt-1 text-sm text-[#526a78]">{proposal.action === "help" ? requesterText(language, "Say confirm to choose Medical, Fire, or Police, or say cancel.") : <>{requesterText(language, "Do this?")} <strong>{requesterText(language, ACTION_LABELS[proposal.action])}</strong></>}</p> : null}
        {completed ? <p className="mt-2 text-sm font-semibold">{requesterText(language, "Done")}: {requesterText(language, completed.label)}</p> : null}
        {error || unsupported ? <p className="mt-2 text-sm leading-5 text-[#a33a38]">{error || requesterText(language, "Voice commands are not supported by this browser. Try a supported browser or use the on-screen controls.")}</p> : null}
        {navigationChoicesOpen ? <div className="mt-3 border-t border-[#e1e8ec] pt-3">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#758793]">{requesterText(language, "Navigation tabs")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {REQUESTER_NAVIGATION_OPTIONS.map((option, index) => <button
              key={option.label}
              type="button"
              data-live-voice-option-focused={navigationFocusIndex === index ? "true" : undefined}
              onClick={() => { setNavigationChoicesOpen(false); router.push(option.href); }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d6e1e6] bg-white px-2.5 text-left text-xs font-semibold text-[#102b3f] hover:border-[#0f6872] hover:bg-[#f4fafb]"
            ><span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eab308] text-xs font-extrabold text-[#102b3f]">{index + 1}</span>{requesterText(language, option.label)}</button>)}
          </div>
          <p className="mt-2 text-xs leading-5 text-[#687b89]">{requesterText(language, "Say Home, Request help, History, or Notifications; or say next option and select.")}</p>
        </div> : null}
        {!proposal && transcript && !listening && !completed && !error ? <p className="mt-1 text-xs text-[#687b89]">{requesterText(language, "I didn't recognize that command. Try Home, Request help, Open request in history, Open or read notifications, click button one, Cancel request, Tracking, LIVE AI, answer or decline a call, or end call.")}</p> : null}
      </div>
      <button type="button" onClick={() => { setPanelDismissed(true); setTranscript(""); setProposal(null); proposalRef.current = null; setError(""); setCompleted(null); completedRef.current = null; }} aria-label={requesterText(language, "Dismiss voice command")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#667b89] hover:bg-white/70"><X className="h-4 w-4"/></button>
    </div>
    {proposal ? <div className="mt-3 flex justify-end gap-2 border-t border-white/70 pt-3">
      <button type="button" onClick={() => { setProposal(null); proposalRef.current = null; setTranscript(""); setError(requesterText(language, "Command cancelled.")); }} className="rounded-xl border border-[#d4e0e5] bg-white/70 px-3 py-2 text-sm font-semibold">{requesterText(language, "Cancel")}</button>
      <button type="button" onClick={confirmAction} className="inline-flex items-center gap-2 rounded-xl bg-[#0f6872] px-3 py-2 text-sm font-bold text-white"><Check className="h-4 w-4"/>{requesterText(language, "Confirm")}</button>
    </div> : null}
    {completed ? <div className="mt-3 flex justify-end border-t border-white/70 pt-3"><button type="button" onClick={undoAction} className="inline-flex items-center gap-2 rounded-xl border border-[#d4e0e5] bg-white/70 px-3 py-2 text-sm font-semibold"><RotateCcw className="h-4 w-4"/>{requesterText(language, "Undo")}</button></div> : null}
  </section> : null;
  function toggleVoiceActive() {
    setPanelDismissed(false);
    if (blocked || blockedRef.current) {
      void requestMicrophone();
      return;
    }
    if (!enabled) {
      const preferences = readRequesterPreferences(user?.id);
      saveRequesterPreferences({ ...preferences, voiceNavigation: true, voiceCommandsActive: true }, user?.id);
      setEnabled(true);
      window.dispatchEvent(new Event("live:requester-preferences-changed"));
      voiceActiveRef.current = true;
      setVoiceActive(true);
      setTranscript("");
      setError("");
      manualPauseRef.current = false;
      void requestMicrophone();
      return;
    }
    if (voiceActiveRef.current && listening) {
      voiceActiveRef.current = false;
      setVoiceActive(false);
      saveVoiceCommandsActive(false);
      setTranscript("");
      setProposal(null);
      proposalRef.current = null;
      setError("");
      return;
    }
    voiceActiveRef.current = true;
    setVoiceActive(true);
    saveVoiceCommandsActive(true);
    setTranscript("");
    setError("");
    manualPauseRef.current = false;
    startListening();
  }
  return <>
    {enabled ? <span ref={micAnchorRef} aria-hidden={modalVoiceFocus ? true : undefined} className="relative grid h-16 w-10 shrink-0 place-items-center">{!modalVoiceFocus ? micButton : null}</span> : null}
    {modalVoiceFocus && micButton && micButtonPosition && typeof document !== "undefined" ? createPortal(
      <div className="pointer-events-none fixed" style={{ top: micButtonPosition.top, left: micButtonPosition.left, width: micButtonPosition.width, height: micButtonPosition.height, zIndex: 1401 }}>
        <div className="pointer-events-auto h-full w-full">{micButton}</div>
      </div>,
      document.body,
    ) : null}
    {voicePanel ? voicePanelHost && typeof document !== "undefined"
      ? createPortal(voicePanel, voicePanelHost)
      : modalVoiceFocus && typeof document !== "undefined"
      ? createPortal(<div className="pointer-events-auto fixed right-4 top-[4.5rem] z-[80]">{voicePanel}</div>, document.body)
      : voicePanel
      : null}
  </>;
}
