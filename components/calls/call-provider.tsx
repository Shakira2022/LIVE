"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PhoneCall, PhoneOff, Mic, MicOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/auth-provider";

type CallStatus = "idle" | "calling" | "incoming" | "connecting" | "connected" | "error";
type CallRole = "requester" | "dispatcher" | "responder" | "admin" | "auditor";

type CallSession = {
  status: CallStatus;
  roomId: string;
  callId: string;
  remoteName: string;
  remoteRole?: CallRole;
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

type Signal = {
  type: "incoming" | "busy" | "accept" | "reject" | "offer" | "answer" | "ice" | "end" | "reconnect-request";
  callId: string;
  fromUserId: string;
  fromName: string;
  fromRole: CallRole;
  targetRole?: CallRole;
  targetUserId?: string;
  candidate?: RTCIceCandidateInit;
  description?: RTCSessionDescriptionInit;
  reason?: string;
};

type CallContextValue = {
  call: CallSession;
  registerRoom: (roomId: string | null | undefined) => void;
  startCall: (roomId: string, remoteName?: string, target?: { targetRole?: CallRole; targetUserId?: string }) => Promise<void>;
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
  if (role === "responder") return "Driver";
  if (role === "requester") return "Requester";
  if (role === "dispatcher") return "Dispatcher";
  if (role === "admin") return "Administrator";
  if (role === "auditor") return "Auditor";
  return "User";
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

  const sendSignal = useCallback(async (roomId: string, signal: Omit<Signal, "fromUserId" | "fromName" | "fromRole">) => {
    const channel = channelsRef.current.get(roomId);
    if (!channel || !user) return;
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
    if (!channel || !user) return;
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
    if (!user || signal.fromUserId === user.id) return;
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
      stopRinging();
      cleanupPeer();
      setCurrentCall(emptyCall);
    }
  }, [cleanupPeer, createPeer, flushCandidates, sendSignal, setCurrentCall, setPendingCall, stopRinging, user]);

  const registerRoom = useCallback((roomId: string | null | undefined) => {
    if (!roomId || registeredRoomsRef.current.has(roomId)) return;
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
  }, [handleSignal]);

  const startCall = useCallback(async (roomId: string, remoteName = "Requester", target?: { targetRole?: CallRole; targetUserId?: string }) => {
    if (!user || callRef.current.status !== "idle") return;
    reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    registerRoom(roomId);
    const callId = createId();
    const nextCall: CallSession = {
      status: "calling",
      roomId,
      callId,
      remoteName,
      remoteRole: target?.targetRole,
      targetRole: target?.targetRole,
      targetUserId: target?.targetUserId,
      isCaller: true,
    };
    setCurrentCall(nextCall);
    try {
      await createPeer(roomId, callId);
    } catch (error) {
      cleanupPeer();
      setCurrentCall({ ...nextCall, status: "error", error: microphoneErrorMessage(error) });
      return;
    }
    await channelReadyRef.current.get(roomId);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await sendSignal(roomId, { type: "incoming", callId, ...target });
    ringTimerRef.current = window.setInterval(() => {
      void sendSignal(roomId, { type: "incoming", callId, ...target });
    }, 1500);
  }, [cleanupPeer, createPeer, registerRoom, sendSignal, setCurrentCall, user]);

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
      await createPeer(current.roomId, current.callId);
      await sendSignal(current.roomId, { type: "accept", callId: current.callId });
    } catch (error) {
      setCurrentCall({ ...current, status: "error", error: microphoneErrorMessage(error) });
    }
  }, [createPeer, sendSignal, setCurrentCall]);

  const rejectCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== "incoming") return;
    stopRinging();
    declinedCallIdsRef.current.add(current.callId);
    setCurrentCall(emptyCall);
    void sendCancellationSignal(current.roomId, { type: "reject", callId: current.callId, reason: "declined" });
  }, [sendCancellationSignal, setCurrentCall, stopRinging]);

  const endCall = useCallback(async () => {
    const current = callRef.current;
    stopRinging();
    const shouldNotifyRemote = current.status !== "idle";
    cleanupPeer();
    reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    setCurrentCall(emptyCall);
    if (shouldNotifyRemote) {
      void sendCancellationSignal(current.roomId, { type: "end", callId: current.callId });
    }
  }, [cleanupPeer, sendCancellationSignal, setCurrentCall, stopRinging]);

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
      await sendSignal(pending.roomId, { type: "accept", callId: pending.callId });
    } catch (error) {
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
    if (connectionLostTimerRef.current !== null) window.clearTimeout(connectionLostTimerRef.current);
    cleanupPeer();
    channelsRef.current.forEach((channel) => void supabase.removeChannel(channel));
    channelsRef.current.clear();
    channelReadyRef.current.clear();
    registeredRoomsRef.current.clear();
  }, [cleanupPeer, stopRinging]);

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

  const value = useMemo<CallContextValue>(() => ({
    call,
    registerRoom,
    startCall,
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
  }), [acceptCall, acceptPendingIncoming, audioBlocked, call, durationSeconds, enableAudio, endCall, muted, pendingIncoming, registerRoom, rejectCall, rejectPendingIncoming, startCall, toggleMute]);

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" aria-hidden="true" />
      <CallOverlay />
    </CallContext.Provider>
  );
}

function CallOverlay() {
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
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
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
  }, [call.callId]);

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
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-start justify-center bg-transparent p-3 pt-3 sm:justify-start sm:p-5 sm:pt-5">
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
              <button type="button" onClick={() => void rejectPendingIncoming()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#e1c8c5] px-3 text-sm font-bold text-[#a9443d] transition hover:bg-[#fff6f5]">
                <PhoneOff className="h-4 w-4" /> Decline
              </button>
              <button type="button" onClick={() => void acceptPendingIncoming()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                <PhoneCall className="h-4 w-4" /> Answer and end current
              </button>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-white/75 bg-white/55 shadow-[0_20px_55px_rgba(16,43,63,0.20)] backdrop-blur-2xl" role="dialog" aria-live="polite" aria-label="Call">
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
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => void rejectCall()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#e1c8c5] px-3 text-sm font-bold text-[#a9443d] transition hover:bg-[#fff6f5]">
                <PhoneOff className="h-4 w-4" /> Decline
              </button>
              <button type="button" onClick={() => void acceptCall()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#0f6872] px-3 text-sm font-bold text-white transition hover:bg-[#0c5962]">
                <PhoneCall className="h-4 w-4" /> Accept call
              </button>
            </div>
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
              <button type="button" onClick={() => void endCall()} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#c75546] px-3 text-sm font-bold text-white transition hover:bg-[#ad4539]">
                <PhoneOff className="h-4 w-4" /> End call
              </button>
              </div>
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
