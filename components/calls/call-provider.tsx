"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PhoneCall, PhoneOff, Mic, MicOff, MapPin, X, LoaderCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/auth-provider";
import { readRequesterPreferences } from "@/lib/requester-preferences";
import { readResponderPreferences } from "@/lib/responder-preferences";
import { LiveResponseMap } from "@/components/maps/live-response-map";

type CallStatus = "idle" | "calling" | "incoming" | "connecting" | "connected" | "error";
type CallRole = "requester" | "dispatcher" | "responder" | "admin" | "auditor";

type CallSession = {
  status: CallStatus;
  roomId: string;
  callId: string;
  remoteName: string;
  remoteRole?: CallRole;
  requestId?: string;
  targetRole?: CallRole;
  targetUserId?: string;
  error?: string;
  isCaller?: boolean;
  startedAt?: number;
};

type PendingIncomingCall = {
  roomId: string;
  callId: string;
  remoteName: string;
  remoteRole?: CallRole;
};

export type DispatcherCallTarget = { userId: string; name: string; requestId?: string };

type DispatcherCallSequence = {
  targets: DispatcherCallTarget[];
  index: number;
  callId: string | null;
};

type Signal = {
  type: "incoming" | "busy" | "accept" | "reject" | "offer" | "answer" | "ice" | "end" | "reconnect-request";
  callId: string;
  fromUserId: string;
  fromName: string;
  fromRole: CallRole;
  targetRole?: CallRole;
  targetUserId?: string;
  requestId?: string;
  candidate?: RTCIceCandidateInit;
  description?: RTCSessionDescriptionInit;
  reason?: string;
};

type CallContextValue = {
  call: CallSession;
  registerRoom: (roomId: string | null | undefined) => void;
  startCall: (roomId: string, remoteName?: string, target?: { targetRole?: CallRole; targetUserId?: string; requestId?: string }) => Promise<void>;
  startCallSequence: (targets: DispatcherCallTarget[]) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  muted: boolean;
  audioBlocked: boolean;
  enableAudio: () => Promise<void>;
  durationSeconds: number;
  pendingIncoming: PendingIncomingCall | null;
  acceptPendingIncoming: () => Promise<void>;
  rejectPendingIncoming: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

const emptyCall: CallSession = {
  status: "idle",
  roomId: "",
  callId: "",
  remoteName: "",
};

const CALL_RECOVERY_KEY = "live-call-recovery-v1";

const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    ...(process.env.NEXT_PUBLIC_TURN_URL && process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_CREDENTIAL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_URL,
          username: process.env.NEXT_PUBLIC_TURN_USERNAME,
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
        }]
      : []),
  ],
};

function createId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function microphoneErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
    return "Microphone access was denied. Choose Allow for this site in your browser microphone settings, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect a microphone and try again.";
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "Microphone access is blocked here. Use localhost or HTTPS, then try again.";
  }
  return error instanceof Error ? error.message : "Microphone access was not available.";
}

function roleLabel(role?: CallRole): string {
  if (role === "responder") return "Responder";
  if (role === "requester") return "Requester";
  if (role === "dispatcher") return "Dispatcher";
  if (role === "admin") return "Administrator";
  if (role === "auditor") return "Auditor";
  return "User";
}

function isCallRole(role: string | undefined): role is CallRole {
  return role === "requester" || role === "dispatcher" || role === "responder" || role === "admin" || role === "auditor";
}

function announceDispatcherMessage(message: string, userId?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!readRequesterPreferences(userId).voiceGuidance || !("speechSynthesis" in window)) {
      resolve();
      return;
    }

    const synthesis = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(message);
    let finished = false;
    let timeout: number | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeout !== null) window.clearTimeout(timeout);
      window.removeEventListener("live:requester-preferences-changed", onPreferencesChanged);
      resolve();
    };
    const onPreferencesChanged = () => {
      if (readRequesterPreferences(userId).voiceGuidance) return;
      synthesis.cancel();
      finish();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.addEventListener("live:requester-preferences-changed", onPreferencesChanged);
    timeout = window.setTimeout(() => {
      synthesis.cancel();
      finish();
    }, 10_000);
    synthesis.cancel();
    synthesis.speak(utterance);
  });
}

function announceDispatcherSwitch(userId?: string) {
  return announceDispatcherMessage("This dispatcher is unavailable. Switching to the next dispatcher.", userId);
}

function announceNoDispatchersAvailable(userId?: string) {
  return announceDispatcherMessage("No dispatchers are available.", userId);
}

async function recordCallStart(input: { callId: string; roomId: string; calleeUserId?: string; targetRole?: CallRole; remoteName?: string; requestId?: string }) {
  const payload = JSON.stringify({ ...input, calleeUserId: input.calleeUserId ?? null });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (response.ok) return;
    } catch {
      // Retry once below; signaling must still continue if persistence is unavailable.
    }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

async function recordCallStatus(callId: string, status: "accepted" | "declined" | "missed" | "ended" | "failed", durationSeconds?: number, reason?: string) {
  const body = JSON.stringify({
    status,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(reason ? { reason } : {}),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (response.ok) return;
    } catch {
      // Retry once; persistence must not interrupt the call controls.
    }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [call, setCall] = useState<CallSession>(emptyCall);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [pendingIncoming, setPendingIncoming] = useState<PendingIncomingCall | null>(null);
  const callRef = useRef(call);
  const pendingIncomingRef = useRef<PendingIncomingCall | null>(null);
  const channelsRef = useRef(new Map<string, ReturnType<typeof supabase.channel>>());
  const channelReadyRef = useRef(new Map<string, Promise<void>>());
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const registeredRoomsRef = useRef(new Set<string>());
  const ringTimerRef = useRef<number | null>(null);
  const connectionLostTimerRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const restartCallRef = useRef<(() => Promise<void>) | null>(null);
  const declinedCallIdsRef = useRef(new Set<string>());
  const recoveryAttemptedRef = useRef(false);
  const dispatcherSequenceRef = useRef<DispatcherCallSequence | null>(null);
  const announcedIncomingCallRef = useRef("");
  const dispatcherRetryTimerRef = useRef<number | null>(null);
  const advanceDispatcherSequenceRef = useRef<((reason: "timeout" | "declined", callId?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    if (!user) return;
    if (call.status === "idle" || call.status === "error") {
      // On a fresh mount, wait for the recovery effect to inspect storage
      // before treating the idle state as a deliberate call end.
      if (recoveryAttemptedRef.current) {
        window.sessionStorage.removeItem(CALL_RECOVERY_KEY);
      }
      return;
    }

    window.sessionStorage.setItem(CALL_RECOVERY_KEY, JSON.stringify({
      userId: user.id,
      call,
    }));
  }, [call, user]);

  const setCurrentCall = useCallback((next: CallSession) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const setPendingCall = useCallback((next: PendingIncomingCall | null) => {
    pendingIncomingRef.current = next;
    setPendingIncoming(next);
  }, []);

  const cleanupPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    remoteStreamRef.current = null;
    if (connectionLostTimerRef.current !== null) {
      window.clearTimeout(connectionLostTimerRef.current);
      connectionLostTimerRef.current = null;
    }
    setAudioBlocked(false);
    setMuted(false);
    setDurationSeconds(0);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const stopRinging = useCallback(() => {
    if (ringTimerRef.current !== null) {
      window.clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  const clearDispatcherSequence = useCallback(() => {
    dispatcherSequenceRef.current = null;
    if (dispatcherRetryTimerRef.current !== null) {
      window.clearTimeout(dispatcherRetryTimerRef.current);
      dispatcherRetryTimerRef.current = null;
    }
  }, []);

  const sendSignal = useCallback(async (roomId: string, signal: Omit<Signal, "fromUserId" | "fromName" | "fromRole">) => {
    const channel = channelsRef.current.get(roomId);
    if (!channel || !user || !isCallRole(user.role)) return;
    await channelReadyRef.current.get(roomId);
    try {
      await channel.send({
        type: "broadcast",
        event: "call-signal",
        payload: {
          ...signal,
          fromUserId: user.id,
          fromName: user.name,
          fromRole: user.role,
        } satisfies Signal,
      });
    } catch {
      // A transient signaling failure is handled by the call state and
      // should not create an unhandled promise rejection.
    }
  }, [user]);

  // Cancellation signals are sent through an already subscribed channel and
  // must not wait on a reconnecting readiness promise.
  const sendCancellationSignal = useCallback(async (roomId: string, signal: Omit<Signal, "fromUserId" | "fromName" | "fromRole">) => {
    const channel = channelsRef.current.get(roomId);
    if (!channel || !user || !isCallRole(user.role)) return;
    try {
      await channel.send({
        type: "broadcast",
        event: "call-signal",
        payload: {
          ...signal,
          fromUserId: user.id,
          fromName: user.name,
          fromRole: user.role,
        } satisfies Signal,
      });
    } catch {
      // The local call has already ended; remote notification is best effort.
    }
  }, [user]);

  const createPeer = useCallback(async (roomId: string, callId: string) => {
    if (peerRef.current) return peerRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone calls.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    const peer = new RTCPeerConnection(rtcConfiguration);
    peerRef.current = peer;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => {
      const remoteStream = remoteStreamRef.current ?? new MediaStream();
      remoteStreamRef.current = remoteStream;
      const incomingTracks = event.streams[0]?.getTracks() ?? [event.track];
      incomingTracks.forEach((track) => {
        if (!remoteStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        void remoteAudioRef.current.play()
          .then(() => setAudioBlocked(false))
          .catch(() => setAudioBlocked(true));
      }
    };
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal(roomId, {
          type: "ice",
          callId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    const markConnectionLost = () => {
      if (callRef.current.callId !== callId) return;
      const status = callRef.current.status;
      if (status === "connected" || status === "connecting") {
        if (reconnectingRef.current) return;
        if (reconnectAttemptsRef.current >= 3) {
          setCurrentCall({ ...callRef.current, status: "error", error: "The network connection was lost. End the call and try again." });
          return;
        }
        reconnectAttemptsRef.current += 1;
        reconnectingRef.current = true;
        setCurrentCall({ ...callRef.current, status: "connecting", error: "Reconnecting call..." });
        if (callRef.current.isCaller) void restartCallRef.current?.();
        else void sendSignal(roomId, { type: "reconnect-request", callId });
      }
    };
    const handleConnectionState = () => {
      if (peer.connectionState === "connected") {
        if (connectionLostTimerRef.current !== null) {
          window.clearTimeout(connectionLostTimerRef.current);
          connectionLostTimerRef.current = null;
        }
        return;
      }
      if (peer.connectionState === "failed") {
        markConnectionLost();
        return;
      }
      if (peer.connectionState === "disconnected" && connectionLostTimerRef.current === null) {
        connectionLostTimerRef.current = window.setTimeout(() => {
          connectionLostTimerRef.current = null;
          if (peer.connectionState !== "connected") markConnectionLost();
        }, 5000);
      }
    };
    peer.onconnectionstatechange = handleConnectionState;
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "failed") markConnectionLost();
    };
    return peer;
  }, [sendSignal, setCurrentCall]);

  const flushCandidates = useCallback(async (peer: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current.splice(0);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }, []);

  const handleSignal = useCallback(async (signal: Signal, roomId: string) => {
    if (!user || !isCallRole(user.role) || signal.fromUserId === user.id) return;
    const current = callRef.current;

    if (signal.type === "incoming") {
      if (declinedCallIdsRef.current.has(signal.callId)) return;
      if (signal.targetUserId && signal.targetUserId !== user.id) return;
      if (signal.targetRole && signal.targetRole !== user.role) return;
      // The caller repeats the incoming signal while ringing, and a delayed
      // retry can arrive just after the same call connects. It is still the
      // current call, never a second incoming call or a busy-call warning.
      if (current.callId === signal.callId && current.status !== "idle") return;

      const isActiveCall = current.status === "calling" ||
        current.status === "connecting" ||
        current.status === "connected";

      if (isActiveCall) {
        const pending = {
          roomId,
          callId: signal.callId,
          remoteName: signal.fromName || "LIVE user",
          remoteRole: signal.fromRole,
        } satisfies PendingIncomingCall;
        setPendingCall(pending);
        void sendSignal(roomId, { type: "busy", callId: signal.callId, reason: "busy" });
        return;
      }

      // If two different calls arrive while the user is still only on the
      // incoming screen, show the newest real incoming call normally. The
      // user is not yet connected, so this is not a busy-call situation.
      if (current.status === "incoming" && current.callId !== signal.callId) {
        void sendCancellationSignal(current.roomId, {
          type: "reject",
          callId: current.callId,
          reason: "replaced_by_new_incoming_call",
        });
      }

      setCurrentCall({
        status: "incoming",
        roomId,
        callId: signal.callId,
        remoteName: signal.fromName || "LIVE user",
        remoteRole: signal.fromRole,
        requestId: signal.requestId,
      });
      return;
    }

    if (signal.type === "busy" && signal.callId === current.callId) {
      // A busy response is not a microphone failure and must not end the
      // outgoing call. Keep ringing so the recipient can finish their
      // current call and accept this one.
      setCurrentCall({
        ...current,
        status: "calling",
        error: `${roleLabel(signal.fromRole)} is on another call. Still calling...`,
      });
      return;
    }

    if (
      (signal.type === "reject" || signal.type === "end") &&
      pendingIncomingRef.current?.callId === signal.callId
    ) {
      setPendingCall(null);
      return;
    }

    if (signal.callId !== current.callId) return;

    if (signal.type === "accept" && current.isCaller && dispatcherSequenceRef.current &&
      (!dispatcherSequenceRef.current.callId || dispatcherSequenceRef.current.callId === current.callId)) {
      clearDispatcherSequence();
    }

    if (signal.type === "accept" && current.status === "calling") {
      try {
        stopRinging();
        setCurrentCall({ ...current, status: "connecting", error: undefined });
        const peer = await createPeer(current.roomId, current.callId);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await sendSignal(current.roomId, { type: "offer", callId: current.callId, description: offer });
      } catch (error) {
        setCurrentCall({ ...current, status: "error", error: microphoneErrorMessage(error) });
      }
      return;
    }

    if (signal.type === "offer" && (current.status === "connecting" || current.status === "connected")) {
      try {
        const peer = await createPeer(current.roomId, current.callId);
        if (signal.description) await peer.setRemoteDescription(signal.description);
        await flushCandidates(peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await sendSignal(current.roomId, { type: "answer", callId: current.callId, description: answer });
        reconnectingRef.current = false;
        reconnectAttemptsRef.current = 0;
        setCurrentCall({ ...current, status: "connected", error: undefined, startedAt: current.startedAt || Date.now() });
      } catch (error) {
        setCurrentCall({ ...current, status: "error", error: microphoneErrorMessage(error) });
      }
      return;
    }

    if (signal.type === "answer" && current.status === "connecting") {
      try {
        if (peerRef.current && signal.description) {
          await peerRef.current.setRemoteDescription(signal.description);
          await flushCandidates(peerRef.current);
          reconnectingRef.current = false;
          reconnectAttemptsRef.current = 0;
          setCurrentCall({ ...current, status: "connected", error: undefined, startedAt: current.startedAt || Date.now() });
        }
      } catch (error) {
        setCurrentCall({ ...current, status: "error", error: microphoneErrorMessage(error) });
      }
      return;
    }

    if (signal.type === "reconnect-request" && current.isCaller && (current.status === "connected" || current.status === "connecting")) {
      reconnectingRef.current = true;
      setCurrentCall({ ...current, status: "connecting", error: "Reconnecting call..." });
      void restartCallRef.current?.();
      return;
    }

    if (signal.type === "ice" && signal.candidate) {
      if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(signal.candidate);
      else pendingCandidatesRef.current.push(signal.candidate);
      return;
    }

    if (signal.type === "reject" || signal.type === "end") {
      const sequence = dispatcherSequenceRef.current;
      if (current.isCaller && sequence && (!sequence.callId || sequence.callId === signal.callId)) {
        await advanceDispatcherSequenceRef.current?.("declined", signal.callId);
        return;
      }
      stopRinging();
      cleanupPeer();
      void recordCallStatus(
        signal.callId,
        signal.type === "reject" ? "declined" : current.status === "incoming" ? "missed" : "ended",
        signal.type === "end" && current.startedAt
          ? Math.floor((Date.now() - current.startedAt) / 1000)
          : undefined,
        signal.reason,
      );
      setCurrentCall(emptyCall);
    }
  }, [clearDispatcherSequence, cleanupPeer, createPeer, flushCandidates, sendSignal, setCurrentCall, setPendingCall, stopRinging, user]);

  const registerRoom = useCallback((roomId: string | null | undefined) => {
    if (!roomId || !user || !isCallRole(user.role) || registeredRoomsRef.current.has(roomId)) return;
    registeredRoomsRef.current.add(roomId);
    const channel = supabase
      .channel(`live-call:${roomId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "call-signal" }, ({ payload }) => {
        void handleSignal(payload as Signal, roomId);
      });
    channelsRef.current.set(roomId, channel);
    const ready = new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve();
      });
    });
    channelReadyRef.current.set(roomId, ready);
  }, [handleSignal, user]);

  useEffect(() => {
    if (user?.role === "responder" || user?.role === "dispatcher") registerRoom(`${user.role}:${user.id}`);
  }, [registerRoom, user]);

  const startCall = useCallback(async (roomId: string, remoteName = "Requester", target?: { targetRole?: CallRole; targetUserId?: string; requestId?: string }) => {
    if (!user || !isCallRole(user.role) || callRef.current.status !== "idle") return;
    reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    registerRoom(roomId);
    const callId = createId();
    const signalTarget = { targetRole: target?.targetRole, targetUserId: target?.targetUserId, requestId: target?.requestId };
    const nextCall: CallSession = {
      status: "calling",
      roomId,
      callId,
      remoteName,
      remoteRole: target?.targetRole,
      requestId: target?.requestId,
      targetRole: target?.targetRole,
      targetUserId: target?.targetUserId,
      isCaller: true,
    };
    const sequence = dispatcherSequenceRef.current;
    if (target?.targetRole === "dispatcher" && sequence && !sequence.callId) sequence.callId = callId;
    setCurrentCall(nextCall);
    try {
      await createPeer(roomId, callId);
    } catch (error) {
      cleanupPeer();
      void recordCallStatus(callId, "failed", undefined, microphoneErrorMessage(error));
      setCurrentCall({ ...nextCall, status: "error", error: microphoneErrorMessage(error) });
      return;
    }
    await recordCallStart({ callId, roomId, calleeUserId: target?.targetUserId, targetRole: target?.targetRole, remoteName, requestId: target?.requestId });
    await channelReadyRef.current.get(roomId);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await sendSignal(roomId, { type: "incoming", callId, ...signalTarget });
    ringTimerRef.current = window.setInterval(() => {
      void sendSignal(roomId, { type: "incoming", callId, ...signalTarget });
    }, 1500);
  }, [cleanupPeer, createPeer, registerRoom, sendSignal, setCurrentCall, user]);

  const dialDispatcherTarget = useCallback(async (sequence: DispatcherCallSequence, index: number) => {
    if (dispatcherSequenceRef.current !== sequence || sequence.index + 1 !== index) return;
    const target = sequence.targets[index];
    if (!target) return;

    sequence.index = index;
    sequence.callId = null;
    setCurrentCall(emptyCall);
    await startCall(`dispatcher:${target.userId}`, target.name, {
      targetRole: "dispatcher",
      targetUserId: target.userId,
      requestId: target.requestId,
    });

    if (dispatcherSequenceRef.current !== sequence || sequence.index !== index) return;
    const current = callRef.current;
    if (current.status !== "calling" || !current.callId) {
      clearDispatcherSequence();
      return;
    }

    sequence.callId = current.callId;
    dispatcherRetryTimerRef.current = window.setTimeout(() => {
      void advanceDispatcherSequenceRef.current?.("timeout", current.callId);
    }, 15_000);
  }, [clearDispatcherSequence, setCurrentCall, startCall]);

  const advanceDispatcherSequence = useCallback(async (reason: "timeout" | "declined", callId?: string) => {
    const sequence = dispatcherSequenceRef.current;
    if (!sequence || (callId && sequence.callId && sequence.callId !== callId)) return;
    if (dispatcherRetryTimerRef.current !== null) {
      window.clearTimeout(dispatcherRetryTimerRef.current);
      dispatcherRetryTimerRef.current = null;
    }

    const current = callRef.current;
    const completedCallId = sequence.callId ?? callId;
    if (current.isCaller && completedCallId && current.callId === completedCallId) {
      stopRinging();
      void recordCallStatus(completedCallId, reason === "declined" ? "declined" : "missed", undefined, reason);
      void sendCancellationSignal(current.roomId, { type: "end", callId: completedCallId, reason: "dispatcher_attempt_finished" });
      cleanupPeer();
    }

    sequence.callId = null;
    const nextIndex = sequence.index + 1;
    if (nextIndex >= sequence.targets.length) {
      clearDispatcherSequence();
      setCurrentCall({
        status: "error",
        roomId: "",
        callId: "",
        remoteName: "Dispatchers",
        error: "No dispatcher is available right now. Please try again later.",
      });
      await announceNoDispatchersAvailable(user?.role === "requester" ? user.id : undefined);
      return;
    }

    setCurrentCall({
      status: "calling",
      roomId: "",
      callId: "",
      remoteName: "Dispatcher",
      remoteRole: "dispatcher",
      isCaller: true,
      error: "This dispatcher is unavailable. Switching to the next dispatcher...",
    });
    await announceDispatcherSwitch(user?.role === "requester" ? user.id : undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    if (dispatcherSequenceRef.current !== sequence) return;
    await dialDispatcherTarget(sequence, nextIndex);
  }, [cleanupPeer, clearDispatcherSequence, dialDispatcherTarget, sendCancellationSignal, setCurrentCall, stopRinging, user]);

  advanceDispatcherSequenceRef.current = advanceDispatcherSequence;

  const startCallSequence = useCallback(async (targets: DispatcherCallTarget[]) => {
    if (!user || !isCallRole(user.role) || callRef.current.status !== "idle") return;
    clearDispatcherSequence();
    const sequence: DispatcherCallSequence = { targets: targets.slice(0, 3), index: -1, callId: null };
    if (!sequence.targets.length) {
      setCurrentCall({
        status: "error",
        roomId: "",
        callId: "",
        remoteName: "Dispatchers",
        error: "No dispatcher is available right now. Please try again later.",
      });
      await announceNoDispatchersAvailable(user.role === "requester" ? user.id : undefined);
      return;
    }
    dispatcherSequenceRef.current = sequence;
    await dialDispatcherTarget(sequence, 0);
  }, [clearDispatcherSequence, dialDispatcherTarget, setCurrentCall, user]);

  const restartCall = useCallback(async () => {
    const current = callRef.current;
    if (!current.callId || !current.roomId || !current.isCaller) return;
    cleanupPeer();
    try {
      const peer = await createPeer(current.roomId, current.callId);
      const offer = await peer.createOffer({ iceRestart: true });
      await peer.setLocalDescription(offer);
      await sendSignal(current.roomId, { type: "offer", callId: current.callId, description: offer });
      reconnectingRef.current = false;
    } catch (error) {
      reconnectingRef.current = false;
      setCurrentCall({ ...current, status: "error", error: `Reconnect failed: ${microphoneErrorMessage(error)}` });
    }
  }, [cleanupPeer, createPeer, sendSignal, setCurrentCall]);

  useEffect(() => {
    restartCallRef.current = restartCall;
    return () => { restartCallRef.current = null; };
  }, [restartCall]);

  // A full page refresh destroys the browser's WebRTC objects, but the other
  // participant can stay connected. Restore the visible call state from this
  // tab's session storage and renegotiate immediately. If restoration cannot
  // obtain audio, explicitly end the call instead of leaving one side stuck.
  useEffect(() => {
    if (!user || recoveryAttemptedRef.current) return;
    recoveryAttemptedRef.current = true;

    let saved: { userId?: string; call?: CallSession } | null = null;
    try {
      const raw = window.sessionStorage.getItem(CALL_RECOVERY_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      window.sessionStorage.removeItem(CALL_RECOVERY_KEY);
      return;
    }

    const savedCall = saved?.userId === user.id ? saved.call : null;
    if (!savedCall?.roomId || !savedCall.callId || savedCall.status === "idle" || savedCall.status === "error") {
      if (saved) window.sessionStorage.removeItem(CALL_RECOVERY_KEY);
      return;
    }

    let cancelled = false;
    const restore = async () => {
      registerRoom(savedCall.roomId);
      await channelReadyRef.current.get(savedCall.roomId);
      if (cancelled) return;

      if (savedCall.status === "incoming") {
        setCurrentCall({ ...savedCall, error: undefined });
        return;
      }

      const restoredCall: CallSession = {
        ...savedCall,
        status: savedCall.status === "calling" ? "calling" : "connecting",
        error: "Restoring call…",
      };
      setCurrentCall(restoredCall);

      try {
        const peer = await createPeer(restoredCall.roomId, restoredCall.callId);
        if (cancelled) return;

        if (restoredCall.status === "calling") {
          await sendSignal(restoredCall.roomId, {
            type: "incoming",
            callId: restoredCall.callId,
            targetRole: restoredCall.targetRole,
            targetUserId: restoredCall.targetUserId,
          });
          ringTimerRef.current = window.setInterval(() => {
            void sendSignal(restoredCall.roomId, {
              type: "incoming",
              callId: restoredCall.callId,
              targetRole: restoredCall.targetRole,
              targetUserId: restoredCall.targetUserId,
            });
          }, 1500);
          setCurrentCall({ ...restoredCall, error: undefined });
          return;
        }

        if (restoredCall.isCaller) {
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          await sendSignal(restoredCall.roomId, { type: "offer", callId: restoredCall.callId, description: offer });
        } else {
          await sendSignal(restoredCall.roomId, { type: "reconnect-request", callId: restoredCall.callId });
        }
      } catch {
        cleanupPeer();
        setCurrentCall(emptyCall);
        window.sessionStorage.removeItem(CALL_RECOVERY_KEY);
        void sendCancellationSignal(savedCall.roomId, { type: "end", callId: savedCall.callId, reason: "page_refresh_recovery_failed" });
      }
    };

    void restore();
    return () => { cancelled = true; };
  }, [cleanupPeer, createPeer, registerRoom, sendCancellationSignal, sendSignal, setCurrentCall, user]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== "incoming" && current.status !== "error") return;
    try {
      setCurrentCall({ ...current, status: "connecting" });
      await recordCallStatus(current.callId, "accepted");
      await createPeer(current.roomId, current.callId);
      await sendSignal(current.roomId, { type: "accept", callId: current.callId });
    } catch (error) {
      void recordCallStatus(current.callId, "failed", undefined, microphoneErrorMessage(error));
      setCurrentCall({ ...current, status: "error", error: microphoneErrorMessage(error) });
    }
  }, [createPeer, sendSignal, setCurrentCall]);

  const rejectCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== "incoming") return;
    stopRinging();
    declinedCallIdsRef.current.add(current.callId);
    void recordCallStatus(current.callId, "declined", undefined, "declined");
    setCurrentCall(emptyCall);
    void sendCancellationSignal(current.roomId, { type: "reject", callId: current.callId, reason: "declined" });
  }, [sendCancellationSignal, setCurrentCall, stopRinging]);

  const endCall = useCallback(async () => {
    const current = callRef.current;
    clearDispatcherSequence();
    stopRinging();
    const shouldNotifyRemote = current.status !== "idle" && Boolean(current.callId && current.roomId);
    if (shouldNotifyRemote) {
      void recordCallStatus(
        current.callId,
        current.isCaller && current.status === "calling" ? "missed" : "ended",
        current.startedAt ? Math.floor((Date.now() - current.startedAt) / 1000) : undefined,
        current.isCaller && current.status === "calling" ? "caller_cancelled_before_answer" : "ended",
      );
    }
    cleanupPeer();
    reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    setCurrentCall(emptyCall);
    if (shouldNotifyRemote) {
      void sendCancellationSignal(current.roomId, { type: "end", callId: current.callId });
    }
  }, [cleanupPeer, clearDispatcherSequence, sendCancellationSignal, setCurrentCall, stopRinging]);

  const acceptPendingIncoming = useCallback(async () => {
    const pending = pendingIncomingRef.current;
    if (!pending) return;
    setPendingCall(null);
    await endCall();

    const nextCall: CallSession = {
      status: "connecting",
      roomId: pending.roomId,
      callId: pending.callId,
      remoteName: pending.remoteName,
      remoteRole: pending.remoteRole,
    };
    setCurrentCall(nextCall);
    try {
      await createPeer(pending.roomId, pending.callId);
      await recordCallStatus(pending.callId, "accepted");
      await sendSignal(pending.roomId, { type: "accept", callId: pending.callId });
    } catch (error) {
      void recordCallStatus(pending.callId, "failed", undefined, microphoneErrorMessage(error));
      setCurrentCall({ ...nextCall, status: "error", error: microphoneErrorMessage(error) });
    }
  }, [createPeer, endCall, sendSignal, setCurrentCall, setPendingCall]);

  const rejectPendingIncoming = useCallback(async () => {
    const pending = pendingIncomingRef.current;
    if (!pending) return;
    setPendingCall(null);
    declinedCallIdsRef.current.add(pending.callId);
    await sendCancellationSignal(pending.roomId, {
      type: "reject",
      callId: pending.callId,
      reason: "declined",
    });
  }, [sendCancellationSignal, setPendingCall]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const enableAudio = useCallback(async () => {
    if (!remoteAudioRef.current) return;
    try {
      await remoteAudioRef.current.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  }, []);

  useEffect(() => () => {
    stopRinging();
    clearDispatcherSequence();
    if (connectionLostTimerRef.current !== null) window.clearTimeout(connectionLostTimerRef.current);
    cleanupPeer();
    channelsRef.current.forEach((channel) => void supabase.removeChannel(channel));
    channelsRef.current.clear();
    channelReadyRef.current.clear();
    registeredRoomsRef.current.clear();
  }, [cleanupPeer, clearDispatcherSequence, stopRinging]);

  useEffect(() => {
    document.body.dataset.liveCallActive = call.status === "idle" ? "false" : "true";
    return () => { delete document.body.dataset.liveCallActive; };
  }, [call.status]);

  useEffect(() => {
    if (call.status !== "connected" || !call.startedAt) {
      setDurationSeconds(0);
      return;
    }
    const update = () => setDurationSeconds(Math.max(0, Math.floor((Date.now() - call.startedAt!) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [call.startedAt, call.status]);

  useEffect(() => {
    if (!user || (call.status !== "incoming" && call.status !== "calling")) return;
    const playIncomingAlert = () => {
      try {
        const stored = window.localStorage.getItem(`live-hci-preferences:${user.id}`);
        const preferences = stored ? JSON.parse(stored) as { notificationsMuted?: boolean; notificationVolume?: number } : {};
        if (preferences.notificationsMuted || preferences.notificationVolume === 0) return;
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
        const volume = ((preferences.notificationVolume ?? 70) / 100) * 0.08;
        const ringtone = call.status === "incoming" ? [660, 880, 660] : [440, 520];
        ringtone.forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + index * 0.18;
          oscillator.frequency.value = frequency;
          oscillator.type = "sine";
          gain.gain.setValueAtTime(volume, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.15);
        });
        window.setTimeout(() => void context.close(), 700);
      } catch {
        // Browser audio permissions may prevent an automatic call ringtone.
      }
    };
    void playIncomingAlert();
    const timer = window.setInterval(playIncomingAlert, 3_000);
    return () => window.clearInterval(timer);
  }, [call.status, user]);

  useEffect(() => {
    if (call.status !== "incoming" || !user) {
      announcedIncomingCallRef.current = "";
      return;
    }
    const announce = () => {
      const enabled = user.role === "responder"
        ? readResponderPreferences(user.id).voiceGuidance
        : readRequesterPreferences(user.id).voiceGuidance;
      if (!enabled || !("speechSynthesis" in window) || announcedIncomingCallRef.current === call.callId) return;
      announcedIncomingCallRef.current = call.callId;
      const utterance = new SpeechSynthesisUtterance(`Incoming call from ${call.remoteName || "a LIVE user"}, ${roleLabel(call.remoteRole)}. Open the call controls to answer or decline.`);
      utterance.lang = "en-ZA";
      utterance.rate = 0.96;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    const sync = () => {
      const enabled = user.role === "responder"
        ? readResponderPreferences(user.id).voiceGuidance
        : readRequesterPreferences(user.id).voiceGuidance;
      if (!enabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        announcedIncomingCallRef.current = "";
        return;
      }
      announce();
    };
    sync();
    window.addEventListener("live:requester-preferences-changed", sync);
    window.addEventListener("live:responder-preferences-changed", sync);
    return () => {
      window.removeEventListener("live:requester-preferences-changed", sync);
      window.removeEventListener("live:responder-preferences-changed", sync);
    };
  }, [call.callId, call.remoteName, call.remoteRole, call.status, user]);

  const value = useMemo<CallContextValue>(() => ({
    call,
    registerRoom,
    startCall,
    startCallSequence,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    muted,
    audioBlocked,
    enableAudio,
    durationSeconds,
    pendingIncoming,
    acceptPendingIncoming,
    rejectPendingIncoming,
  }), [acceptCall, acceptPendingIncoming, audioBlocked, call, durationSeconds, enableAudio, endCall, muted, pendingIncoming, registerRoom, rejectCall, rejectPendingIncoming, startCall, startCallSequence, toggleMute]);

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />
      <CallOverlay />
    </CallContext.Provider>
  );
}

function CallOverlay() {
  const { user } = useAuth();
  const {
    call,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    muted,
    audioBlocked,
    enableAudio,
    durationSeconds,
    pendingIncoming,
    acceptPendingIncoming,
    rejectPendingIncoming,
  } = useCall();
  const [endCallConfirmOpen, setEndCallConfirmOpen] = useState(false);
  const [pendingIncomingConfirmOpen, setPendingIncomingConfirmOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [trackCallerOpen, setTrackCallerOpen] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    setPopupPosition(null);
    dragRef.current = null;
    setDragging(false);
    setTrackCallerOpen(false);
    setEndCallConfirmOpen(false);
    setPendingIncomingConfirmOpen(false);
  }, [call.callId]);

  useEffect(() => {
    if (!pendingIncoming) setPendingIncomingConfirmOpen(false);
  }, [pendingIncoming]);

  useEffect(() => {
    if (call.status === "idle") setEndCallConfirmOpen(false);
    const handleVoiceInput = (event: Event) => {
      const detail = (event as CustomEvent<{ transcript?: string; consumed?: boolean; isFinal?: boolean }>).detail;
      if (!detail || !detail.isFinal) return;
      const spoken = (detail.transcript ?? "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const affirmative = /^(?:yes|yeah|yep|confirm|confirmed|end it|end (?:the|this|my|a|an) call|do it|go ahead|yes end (?:(?:the|this|my|a|an) )?call)$/.test(spoken);
      const negative = /^(?:no|nope|cancel|keep call|keep (?:the|this|my|a|an|current) call|keep calling|stay on the call|go back|close)$/.test(spoken);
      const accept = /^(?:answer|accept|pick up)(?: (?:(?:the|my|this|a|an)))?(?: (?:incoming|live))? call$/.test(spoken) || /^(?:answer|accept|pick up)$/.test(spoken);
      const decline = /^(?:decline|reject|ignore)(?: (?:(?:the|my|this|a|an)))?(?: (?:incoming|live))? call$/.test(spoken) || /^(?:decline|reject)$/.test(spoken);
      const end = /^(?:end|hang up|disconnect|finish|stop)(?: the| this| my| a| an)?(?: incoming| live)? call$/.test(spoken) || /^(?:hang up|disconnect)$/.test(spoken);
      const confirmAnswer = affirmative || accept || /^(?:answer and switch|yes answer (?:(?:the|this|my|a|an) )?call)$/.test(spoken);

      if (pendingIncomingConfirmOpen) {
        if (!confirmAnswer && !negative && !decline) return;
        detail.consumed = true;
        setPendingIncomingConfirmOpen(false);
        if (confirmAnswer) void acceptPendingIncoming();
        else if (decline) void rejectPendingIncoming();
        return;
      }
      if (endCallConfirmOpen) {
        if (!affirmative && !negative) return;
        detail.consumed = true;
        if (affirmative) void endCall();
        setEndCallConfirmOpen(false);
        return;
      }
      if (pendingIncoming && (accept || decline)) {
        detail.consumed = true;
        if (accept) setPendingIncomingConfirmOpen(true);
        else void rejectPendingIncoming();
        return;
      }
      if (call.status === "incoming" && (accept || decline)) {
        detail.consumed = true;
        if (accept) void acceptCall();
        else void rejectCall();
        return;
      }
      if (call.status !== "idle" && call.status !== "incoming" && end) {
        detail.consumed = true;
        setEndCallConfirmOpen(true);
      }
    };
    const handleVoiceAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "end-call" && call.status !== "idle" && call.status !== "incoming") {
        setEndCallConfirmOpen(true);
      }
    };
    window.addEventListener("live:requester-voice-input", handleVoiceInput);
    window.addEventListener("live:requester-voice-action", handleVoiceAction);
    return () => {
      window.removeEventListener("live:requester-voice-input", handleVoiceInput);
      window.removeEventListener("live:requester-voice-action", handleVoiceAction);
    };
  }, [acceptCall, acceptPendingIncoming, call.status, endCall, endCallConfirmOpen, pendingIncoming, pendingIncomingConfirmOpen, rejectCall, rejectPendingIncoming]);

  if (call.status === "idle") return null;

  const incoming = call.status === "incoming";
  const active = call.status === "calling" || call.status === "connecting" || call.status === "connected";
  const duration = `${String(Math.floor(durationSeconds / 60)).padStart(2, "0")}:${String(durationSeconds % 60).padStart(2, "0")}`;
  const statusText = call.status === "calling"
    ? call.error || `Calling ${roleLabel(call.remoteRole)}...`
    : call.status === "connecting"
      ? "Connecting call..."
      : call.status === "connected"
        ? `Connected · ${duration}`
        : call.error || "Call ended";

  function startDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (window.innerWidth < 640) return;
    const card = event.currentTarget.parentElement;
    const rect = card?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPopupPosition({ left: rect.left, top: rect.top });
    setDragging(true);
  }

  function dragPopup(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.min(
      Math.max(8, drag.startLeft + event.clientX - drag.startX),
      Math.max(8, window.innerWidth - drag.width - 8),
    );
    const top = Math.min(
      Math.max(8, drag.startTop + event.clientY - drag.startY),
      Math.max(8, window.innerHeight - drag.height - 8),
    );
    setPopupPosition({ left, top });
  }

  function stopDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[1300] flex items-start justify-center bg-transparent p-3 pt-3 sm:justify-start sm:p-5 sm:pt-5">
      <div
        className="pointer-events-auto mx-auto w-full sm:fixed sm:left-5 sm:top-5 sm:mx-0 sm:w-[360px]"
        style={popupPosition ? { left: popupPosition.left, top: popupPosition.top } : undefined}
      >
        {pendingIncoming ? (
          <section className="mb-3 overflow-hidden rounded-2xl border border-[#e6c98e]/80 bg-[#fffaf0]/85 shadow-[0_20px_55px_rgba(16,43,63,0.20)] backdrop-blur-2xl" role="alertdialog" aria-live="assertive" aria-label="Incoming call while already on a call">
            <div className="border-b border-[#eadfca] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9a6a18]">Incoming call</p>
              <h2 className="mt-1 text-sm font-bold text-[#102b3f]">
                {roleLabel(pendingIncoming.remoteRole)} {pendingIncoming.remoteName} is calling
              </h2>
              <p className="mt-1 text-xs text-[#6f6045]">You are already on another call.</p>
              <p className="mt-1 text-xs font-semibold text-[#6f6045]">Answering will end your current call.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-3">
              <button type="button" data-live-voice-option onClick={() => void rejectPendingIncoming()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#e1c8c5] px-3 text-sm font-bold text-[#a9443d] transition hover:bg-[#fff6f5]">
                <PhoneOff className="h-4 w-4" /> Decline
              </button>
              <button type="button" data-live-voice-option onClick={() => setPendingIncomingConfirmOpen(true)} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                <PhoneCall className="h-4 w-4" /> Answer and end current
              </button>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-white/75 bg-white/55 shadow-[0_20px_55px_rgba(16,43,63,0.20)] backdrop-blur-2xl" role={incoming ? "alertdialog" : "dialog"} aria-live={incoming ? "assertive" : "polite"} aria-label="Call">
        <div
          className={`flex select-none items-center gap-2.5 border-b border-[#dce5e9]/80 px-4 py-3 sm:cursor-grab ${dragging ? "sm:cursor-grabbing" : ""}`}
          onPointerDown={startDragging}
          onPointerMove={dragPopup}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          title="Drag to move call"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e4f1f2] text-[#0f6872]">
            <PhoneCall className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f6872]">{incoming ? `Incoming ${roleLabel(call.remoteRole)} call` : "Calling"}</p>
            <h2 className="truncate text-sm font-bold text-[#102b3f]">{incoming ? `From ${call.remoteName}` : statusText}</h2>
          </div>
        </div>

        <div className="grid gap-2.5 p-4">
          {incoming ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" data-live-voice-option onClick={() => void rejectCall()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#e1c8c5] px-3 text-sm font-bold text-[#a9443d] transition hover:bg-[#fff6f5]">
                  <PhoneOff className="h-4 w-4" /> Decline
                </button>
                <button type="button" data-live-voice-option onClick={() => void acceptCall()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                  <PhoneCall className="h-4 w-4" /> Accept call
                </button>
              </div>
              {user?.role === "dispatcher" && (call.remoteRole === "requester" || call.remoteRole === "responder") ? (
                <button
                  type="button"
                  onClick={() => setTrackCallerOpen(true)}
                  disabled={!call.requestId}
                  title={!call.requestId ? "This call has no active request location." : undefined}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f] transition hover:bg-[#f5f8f9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MapPin className="h-4 w-4 text-[#0f6872]" /> Track caller
                </button>
              ) : null}
            </>
          ) : active ? (
            <div className="grid gap-3">
              {audioBlocked && call.status === "connected" ? (
                <button type="button" onClick={() => void enableAudio()} className="flex min-h-10 items-center justify-center rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                  Enable audio
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={toggleMute} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f] transition hover:bg-[#f5f8f9]">
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {muted ? "Unmute" : "Mute"}
              </button>
              <button type="button" data-live-voice-option onClick={() => setEndCallConfirmOpen(true)} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#c75546] px-3 text-sm font-bold text-white transition hover:bg-[#ad4539]">
                <PhoneOff className="h-4 w-4" /> End call
              </button>
              </div>
              {user?.role === "dispatcher" && (call.remoteRole === "requester" || call.remoteRole === "responder") ? (
                <button
                  type="button"
                  onClick={() => setTrackCallerOpen(true)}
                  disabled={!call.requestId}
                  title={!call.requestId ? "This call has no active request location." : undefined}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f] transition hover:bg-[#f5f8f9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MapPin className="h-4 w-4 text-[#0f6872]" /> Track caller
                </button>
              ) : null}
            </div>
          ) : call.status === "error" ? (
            <div className="grid gap-3">
              {call.remoteRole ? (
                <button type="button" onClick={() => void acceptCall()} className="flex min-h-10 items-center justify-center rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                  Try microphone again
                </button>
              ) : null}
              <button type="button" onClick={() => void endCall()} className="flex min-h-10 items-center justify-center rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f] transition hover:bg-[#f5f8f9]">Close</button>
            </div>
          ) : (
            <button type="button" onClick={() => void endCall()} className="flex min-h-10 items-center justify-center rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">Close</button>
          )}
        </div>
        </section>
      </div>
      {pendingIncomingConfirmOpen && pendingIncoming ? (
        <div className="pointer-events-auto fixed inset-0 z-[1400] grid place-items-center bg-[#071a29]/45 p-4 backdrop-blur-[2px]">
          <section role="alertdialog" aria-modal="true" aria-labelledby="pending-call-confirm-title" aria-describedby="pending-call-confirm-description" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#dce5ea] bg-white shadow-2xl">
            <header className="border-b border-[#dce5ea] px-5 py-4">
              <h2 id="pending-call-confirm-title" className="font-semibold text-[#102b3f]">Answer this call?</h2>
              <p id="pending-call-confirm-description" className="mt-1 text-sm leading-6 text-[#667b89]">Answering {pendingIncoming.remoteName}'s call will end your current call. Confirm to switch calls, or keep your current call active.</p>
            </header>
            <div className="grid grid-cols-2 gap-3 p-4">
              <button type="button" data-live-voice-option aria-label="Close answer call confirmation" onClick={() => setPendingIncomingConfirmOpen(false)} className="min-h-11 rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f]">Keep current call</button>
              <button type="button" data-live-voice-option onClick={() => { setPendingIncomingConfirmOpen(false); void acceptPendingIncoming(); }} className="min-h-11 rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white">Answer and switch</button>
            </div>
          </section>
        </div>
      ) : null}
      {endCallConfirmOpen ? (
        <div className="pointer-events-auto fixed inset-0 z-[1400] grid place-items-center bg-[#071a29]/45 p-4 backdrop-blur-[2px]">
          <section role="alertdialog" aria-modal="true" aria-labelledby="end-call-confirm-title" aria-describedby="end-call-confirm-description" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#dce5ea] bg-white shadow-2xl">
            <header className="border-b border-[#dce5ea] px-5 py-4">
              <h2 id="end-call-confirm-title" className="font-semibold text-[#102b3f]">End this call?</h2>
              <p id="end-call-confirm-description" className="mt-1 text-sm leading-6 text-[#667b89]">The LIVE call with {call.remoteName || "the other person"} will end. Confirm to hang up, or keep the call active.</p>
            </header>
            <div className="grid grid-cols-2 gap-3 p-4">
              <button type="button" data-live-voice-option aria-label="Close end call confirmation" onClick={() => setEndCallConfirmOpen(false)} className="min-h-11 rounded-xl border border-[#d6e0e5] px-3 text-sm font-bold text-[#102b3f]">Keep call</button>
              <button type="button" data-live-voice-option onClick={() => { setEndCallConfirmOpen(false); void endCall(); }} className="min-h-11 rounded-xl bg-[#c75546] px-3 text-sm font-bold text-white">End call</button>
            </div>
          </section>
        </div>
      ) : null}
      {user?.role === "dispatcher" && (call.remoteRole === "requester" || call.remoteRole === "responder") ? (
        <CallerLocationDialog
          open={trackCallerOpen}
          onClose={() => setTrackCallerOpen(false)}
          callId={call.callId}
          callerName={call.remoteName}
          callerRole={call.remoteRole}
        />
      ) : null}
    </div>
  );
}

type TrackedCallerLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  address: string | null;
  capturedAt: string | null;
};

function CallerLocationDialog({
  open,
  onClose,
  callId,
  callerName,
  callerRole,
}: {
  open: boolean;
  onClose: () => void;
  callId: string;
  callerName: string;
  callerRole: "requester" | "responder";
}) {
  const [location, setLocation] = useState<TrackedCallerLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      setLocation(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let nextPoll: number | null = null;
    const loadLocation = async () => {
      if (!hasLoadedRef.current) setLoading(true);
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/location`, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({})) as {
          data?: { location?: TrackedCallerLocation | null };
          location?: TrackedCallerLocation | null;
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(payload.error?.message || "Could not load the caller's location.");
        if (cancelled) return;
        const data = payload.data ?? payload;
        setLocation(data.location ?? null);
        setError("");
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the caller's location.");
      } finally {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setLoading(false);
          if (callerRole === "responder") nextPoll = window.setTimeout(loadLocation, 5000);
        }
      }
    };

    void loadLocation();
    return () => {
      cancelled = true;
      if (nextPoll !== null) window.clearTimeout(nextPoll);
    };
  }, [callId, callerRole, open, refreshKey]);

  if (!open) return null;

  const locationLabel = callerRole === "responder" ? "Live responder location" : "Requester emergency location";
  const formattedUpdate = location?.capturedAt && Number.isFinite(Date.parse(location.capturedAt))
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(location.capturedAt))
    : null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-[140] flex items-center justify-center bg-[#071a29]/70 p-3 backdrop-blur-sm sm:p-6">
      <section className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#d6e0e5] bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={`Track ${callerName}`}>
        <header className="flex shrink-0 items-start gap-4 border-b border-[#e0e7ec] px-4 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-[-.02em] text-[#102b3f]">Track caller</h2>
            <p className="mt-1 text-sm text-[#687b89]">{callerName} · {locationLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#617582] transition hover:bg-[#f1f5f7]" aria-label="Close caller tracking">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading && !location ? (
            <div className="grid h-[48dvh] min-h-[280px] place-items-center rounded-xl border border-[#dce5ea] bg-[#f5f8f9] text-sm font-semibold text-[#526977]">
              <span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-[#0f6872]" />Loading caller location...</span>
            </div>
          ) : location ? (
            <LiveResponseMap
              previewLocation={{
                lat: location.latitude,
                lng: location.longitude,
                address: location.address ?? undefined,
                accuracy: location.accuracyMeters ?? undefined,
              }}
              previewLocationLabel={callerRole === "responder" ? "Responder location" : "Requester location"}
              previewLocationMarker={callerRole === "responder" ? "responder" : "requester"}
              showMyLocation={false}
              hideMapStatus
              className="h-[48dvh] min-h-[280px] rounded-xl sm:h-[58dvh] sm:min-h-[400px]"
            />
          ) : (
            <div className="grid h-[48dvh] min-h-[280px] place-items-center rounded-xl border border-[#dce5ea] bg-[#f5f8f9] px-6 text-center text-sm text-[#526977]">
              {error || "The caller has not shared a location for this active request."}
            </div>
          )}
          {error && location ? <p role="status" className="mt-3 rounded-lg border border-[#efcdca] bg-[#fff6f5] px-3 py-2 text-sm text-[#a9443d]">{error} Showing the last available location.</p> : null}
          {location ? (
            <p className="mt-3 text-xs text-[#687b89]">
              {callerRole === "responder" ? "Live location" : "Request location"}
              {formattedUpdate ? ` · Updated ${formattedUpdate}` : " · Update time unavailable"}
              {callerRole === "requester" ? " · This is the location attached to the request." : ""}
            </p>
          ) : null}
          {!location && !loading ? (
            <button type="button" onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }} className="mt-3 min-h-10 rounded-lg bg-[#0f6872] px-4 text-sm font-bold text-white transition hover:bg-[#0c5962]">
              Try again
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCall must be used inside CallProvider");
  return context;
}

export function useCallRoom(roomId: string | null | undefined) {
  const { registerRoom } = useCall();
  useEffect(() => {
    registerRoom(roomId);
  }, [registerRoom, roomId]);
}
