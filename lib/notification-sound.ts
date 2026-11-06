type NotificationSoundPreferences = {
  notificationsMuted?: boolean;
  notificationVolume?: number;
  notificationSound?: "soft" | "alert" | "chime";
};

export function playNotificationSound(userId: string, repetitions = 1) {
  if (typeof window === "undefined") return;

  let preferences: NotificationSoundPreferences = {};
  try {
    const stored = window.localStorage.getItem(`live-hci-preferences:${userId}`);
    if (stored) preferences = JSON.parse(stored) as NotificationSoundPreferences;
  } catch {
    // Use default notification sound settings when preferences are unavailable.
  }

  const volume = preferences.notificationVolume ?? 70;
  if (preferences.notificationsMuted || volume <= 0) return;

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const sound = preferences.notificationSound ?? "soft";
  const frequency = sound === "chime" ? 880 : sound === "alert" ? 540 : 660;
  const gainLevel = (volume / 100) * 0.08;
  const count = Math.max(1, Math.floor(repetitions));

  for (let index = 0; index < count; index += 1) {
    const startAt = context.currentTime + index * 0.55;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = sound === "alert" ? "square" : "sine";
    gain.gain.setValueAtTime(gainLevel, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.36);
  }

  const closeAt = count * 550 + 500;
  window.setTimeout(() => void context.close(), closeAt);
  if (context.state === "suspended") void context.resume().catch(() => undefined);
}
